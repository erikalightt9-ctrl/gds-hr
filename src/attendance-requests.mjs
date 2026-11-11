// Attendance reconsideration requests: forgot time in, forgot time out, failed / incorrect office time in or out, and
// off-site work reconsideration. Employees file them with a reason and optional evidence; nothing changes until HR
// approves. HR may start a review, ask for more information, reject (reason required) or approve (a different time
// than filed needs a remark). Approval writes an HR-approved adjustment through the normal attendance correction
// path, so the original record stays in the correction history and the audit trail.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { date } from './schema.mjs';
import { scheduleOn } from './engine.mjs';
import { getDocument } from './profiles.mjs';

export const CATEGORIES = { 'forgot-in': 'Forgot to time in', 'forgot-out': 'Forgot to time out', failed: 'Failed or incorrect office time in / out', system: 'System error (app, website or server problem)', offsite: 'Off-site work reconsideration', other: 'Other reason' };
// Like a failed time in / out: transaction, requested times and a description of the problem.
export const PROBLEM_CATEGORIES = ['failed', 'system', 'other'];
// "Ends the next day" with a time out later than the time in would be a shift over 24 hours (e.g. 09:00 – 18:05 next day).
function assertShiftLength({ timeIn, timeOut, endNextDay }) {
  if (timeIn && timeOut && endNextDay && timeOut > timeIn) throw new AppError(`${timeIn} – ${timeOut} on the next day is more than 24 hours. Untick "Time out on the next day" unless the work ended after midnight.`);
}
export const STATUS_LABELS = { pending: 'Pending HR approval', review: 'Under review', info: 'Additional information required', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled by employee' };
export const FILING_DAYS = 3;   // a correction is valid only within 3 days of the date to correct
export const REVIEW_HOURS = 48;
const OPEN = ['pending', 'review', 'info'];
const time = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]).default('');
const text = max => z.string().trim().max(max).default('');
const local = now => new Date(now.getTime() + 8 * 3600000).toISOString();

const ensure = store => store.db.exec('CREATE TABLE IF NOT EXISTS attendance_requests (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, status TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL)');
const load = (store, id) => { ensure(store); const row = store.db.prepare('SELECT data FROM attendance_requests WHERE id=?').get(id); if (!row) throw new AppError('Request not found.', 404); return JSON.parse(row.data); };
const save = (store, r) => store.db.prepare('INSERT INTO attendance_requests(id,employee_id,status,date,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(r.id, r.employeeId, r.status, r.date, JSON.stringify(r));
function nextReference(store, prefix, now) {
  const key = `${prefix}-${local(now).slice(0, 4)}`, n = (store.db.prepare('SELECT value FROM hr_counters WHERE key=?').get(key)?.value || 0) + 1;
  store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, n);
  return `${key}-${String(n).padStart(4, '0')}`;
}
export const leaveReference = (store, now = new Date()) => nextReference(store, 'LV', now);
const employeeOf = (store, actor) => {
  if (actor.role !== 'employee' || !actor.employeeId) throw new AppError('Only employees can file attendance requests.', 403);
  const employee = store.read().employees.find(e => e.id === actor.employeeId);
  if (!employee) throw new AppError('Your employee record was not found.', 404);
  return employee;
};
const posted = (state, employeeId, day) => state.runs.some(r => r.status === 'posted' && r.start <= day && r.end >= day && r.rows.some(row => row.employeeId === employeeId));
function checkEvidence(store, actor, ids) {
  for (const id of ids) {
    const doc = getDocument(store, actor, id);
    if (doc.employeeId !== actor.employeeId || doc.uploadedBy !== actor.username || doc.status !== 'Active') throw new AppError('Attach only your own uploaded evidence.');
  }
}
const step = (r, actor, action, note = '', extra = {}) => ({ ...r, ...extra, updatedAt: new Date().toISOString(), history: [...(r.history || []), { at: new Date().toISOString(), by: actor.username, action, note }] });

const submitSchema = z.object({
  category: z.enum(Object.keys(CATEGORIES)), date, timeIn: time, timeOut: time, endNextDay: z.boolean().default(false),
  attendanceType: z.enum(['office', 'offsite']).default('office'), transaction: z.enum(['', 'in', 'out', 'both']).default(''),
  location: text(300), purpose: text(300), reason: z.string().trim().min(5, 'Explain the reason (at least 5 characters).').max(2000), problem: text(2000),
  evidence: z.array(z.string().max(80)).max(5).default([]),
}).strict();

export function submitAttendanceRequest(store, actor, input, now = new Date()) {
  const employee = employeeOf(store, actor), v = submitSchema.parse(input), today = local(now).slice(0, 10);
  const earliest = local(new Date(now.getTime() - FILING_DAYS * 86400000)).slice(0, 10);
  if (v.date > today) throw new AppError('Attendance requests are for today or earlier days.');
  if (v.date < earliest) throw new AppError(`Attendance correction requests are valid only within ${FILING_DAYS} days of the date to correct. Contact HR for older dates.`);
  if (v.category === 'forgot-in' && !v.timeIn) throw new AppError('Enter the time you started work.');
  if (v.category === 'forgot-out' && !v.timeOut) throw new AppError('Enter the time you finished work.');
  if ([...PROBLEM_CATEGORIES, 'offsite'].includes(v.category) && !v.timeIn && !v.timeOut) throw new AppError('Enter the requested time in and / or time out.');
  if (PROBLEM_CATEGORIES.includes(v.category) && !v.problem) throw new AppError('Describe the problem you had when timing in or out.');
  if ((v.category === 'forgot-in' || v.category === 'offsite') && !v.location) throw new AppError('Enter the exact place where you worked.');
  if (v.category === 'offsite' && !v.purpose) throw new AppError('Enter the purpose of the off-site assignment.');
  if (v.timeIn && v.timeOut && !v.endNextDay && v.timeOut <= v.timeIn) throw new AppError('The time out must be after the time in (tick "ends the next day" for overnight work).');
  assertShiftLength(v);
  return store.transaction(() => {
    ensure(store);
    const state = store.read();
    if (posted(state, employee.id, v.date)) throw new AppError('Payroll for that date is already posted. Contact HR.');
    const open = store.db.prepare('SELECT data FROM attendance_requests WHERE employee_id=? AND date=?').all(employee.id, v.date).map(r => JSON.parse(r.data)).find(r => OPEN.includes(r.status) && r.category === v.category);
    if (open) throw new AppError(`You already have an open request for ${v.date} (${open.reference}).`);
    checkEvidence(store, actor, v.evidence);
    const record = state.attendance.find(a => a.employeeId === employee.id && a.date === v.date) || null;
    const at = now.toISOString();
    const request = { id: randomUUID(), reference: nextReference(store, 'AR', now), employeeId: employee.id, employeeName: employee.name, ...v, status: 'pending', submittedBy: actor.username, submittedAt: at, updatedAt: at,
      original: record ? { timeIn: record.timeIn, timeOut: record.timeOut, status: record.status, endNextDay: record.endNextDay } : null, history: [{ at, by: actor.username, action: 'submitted', note: '' }] };
    save(store, request);
    store.log(actor, 'submit', 'attendance-request', request.id, null, request);
    store.notify(employee.id, `Your request ${request.reference} (${CATEGORIES[v.category]}, ${v.date}) was submitted. HR will review it.`);
    store.notify(null, `${employee.id} ${employee.name}: new attendance request ${request.reference} (${CATEGORIES[v.category]}, ${v.date}).`);
    return request;
  });
}

export function ownAttendanceRequests(store, actor) {
  const employee = employeeOf(store, actor); ensure(store);
  return store.db.prepare('SELECT data FROM attendance_requests WHERE employee_id=? ORDER BY rowid DESC').all(employee.id).map(r => JSON.parse(r.data));
}
export function cancelAttendanceRequest(store, actor, id) {
  const employee = employeeOf(store, actor);
  return store.transaction(() => {
    const r = load(store, id);
    if (r.employeeId !== employee.id) throw new AppError('Request not found.', 404);
    if (!OPEN.includes(r.status)) throw new AppError('Only an open request can be cancelled.');
    const next = step(r, actor, 'cancelled', '', { status: 'cancelled' }); save(store, next);
    store.log(actor, 'cancel', 'attendance-request', id, r, next);
    return next;
  });
}
// The employee answers HR's request for more information (and may add evidence); it goes back to HR.
export function replyAttendanceRequest(store, actor, id, input) {
  const employee = employeeOf(store, actor);
  const v = z.object({ note: z.string().trim().min(3, 'Write your answer (at least 3 characters).').max(2000), evidence: z.array(z.string().max(80)).max(5).default([]) }).strict().parse(input);
  return store.transaction(() => {
    const r = load(store, id);
    if (r.employeeId !== employee.id) throw new AppError('Request not found.', 404);
    if (r.status !== 'info') throw new AppError('HR has not asked for more information on this request.');
    checkEvidence(store, actor, v.evidence);
    const next = step(r, actor, 'replied', v.note, { status: 'pending', evidence: [...new Set([...(r.evidence || []), ...v.evidence])] }); save(store, next);
    store.log(actor, 'reply', 'attendance-request', id, r, next);
    store.notify(null, `${employee.id} ${employee.name}: answered HR on ${r.reference} (${r.date}).`);
    return next;
  });
}

// HR / Admin: every request, with the day's attendance record and clock events for review.
export function attendanceRequestsOverview(store, actor) {
  permit(actor, ['admin', 'hr']); ensure(store);
  const state = store.read(), requests = store.db.prepare('SELECT data FROM attendance_requests ORDER BY rowid DESC LIMIT 2000').all().map(r => JSON.parse(r.data));
  const clock = (id, day) => store.db.prepare('SELECT data FROM clock_events WHERE employee_id=? AND work_date=? ORDER BY rowid').all(id, day).map(r => JSON.parse(r.data)).map(e => ({ kind: e.kind, time: e.time, type: e.attendanceType || (e.outOfOffice ? 'offsite' : 'office'), address: e.address || '', hrApproved: !!e.hrApproved }));
  const leaves = state.leaves.filter(l => l.status === 'pending');
  return {
    requests: requests.map(r => ({ ...r, current: state.attendance.find(a => a.employeeId === r.employeeId && a.date === r.date) || null, clock: clock(r.employeeId, r.date) })),
    leave: { pending: leaves.length, needsInfo: leaves.filter(l => l.proofStatus === 'requested').length },
  };
}
const hrAction = (store, actor, id, fn) => { permit(actor, ['admin', 'hr']); return store.transaction(() => fn(load(store, id))); };
export function startReview(store, actor, id) {
  return hrAction(store, actor, id, r => {
    if (r.status !== 'pending') throw new AppError('Only a pending request can be put under review.');
    const next = step(r, actor, 'review', '', { status: 'review' }); save(store, next); store.log(actor, 'review', 'attendance-request', id, r, next);
    store.notify(r.employeeId, `HR is reviewing your request ${r.reference} (${r.date}).`);
    return next;
  });
}
export function requestInformation(store, actor, id, input) {
  const { note } = z.object({ note: z.string().trim().min(3, 'Say what information is needed.').max(2000) }).strict().parse(input);
  return hrAction(store, actor, id, r => {
    if (!['pending', 'review'].includes(r.status)) throw new AppError('This request is not waiting for HR.');
    const next = step(r, actor, 'info', note, { status: 'info' }); save(store, next); store.log(actor, 'request-info', 'attendance-request', id, r, next);
    store.notify(r.employeeId, `HR needs more information on ${r.reference} (${r.date}): ${note}`);
    return next;
  });
}
export function addRemark(store, actor, id, input) {
  const { note } = z.object({ note: z.string().trim().min(2).max(2000) }).strict().parse(input);
  return hrAction(store, actor, id, r => { const next = step(r, actor, 'remark', note); save(store, next); store.log(actor, 'remark', 'attendance-request', id, r, next); return next; });
}
export function rejectAttendanceRequest(store, actor, id, input) {
  const { remarks } = z.object({ remarks: z.string().trim().min(5, 'Give the reason for rejecting (at least 5 characters).').max(2000) }).strict().parse(input);
  return hrAction(store, actor, id, r => {
    if (!OPEN.includes(r.status)) throw new AppError('This request is already decided.');
    const next = step(r, actor, 'rejected', remarks, { status: 'rejected', decision: { by: actor.username, at: new Date().toISOString(), remarks } }); save(store, next);
    store.log(actor, 'reject', 'attendance-request', id, r, next);
    store.notify(r.employeeId, `Your request ${r.reference} (${r.date}) was rejected: ${remarks}. Your attendance record is unchanged.`);
    return next;
  });
}

// Approve: HR may approve other times than filed (remark required). The day's record is created or corrected as an
// HR-approved adjustment; a time in alone for today becomes an approved time in so the employee can time out normally.
export function approveAttendanceRequest(store, actor, id, input, now = new Date()) {
  const v = z.object({ timeIn: time, timeOut: time, endNextDay: z.boolean().optional(), remarks: text(2000) }).strict().parse(input);
  return hrAction(store, actor, id, r => {
    if (!OPEN.includes(r.status)) throw new AppError('This request is already decided.');
    const approved = { timeIn: v.timeIn || r.timeIn, timeOut: v.timeOut || r.timeOut, endNextDay: v.endNextDay ?? r.endNextDay };
    assertShiftLength(approved);
    const changed = approved.timeIn !== r.timeIn || approved.timeOut !== r.timeOut || approved.endNextDay !== r.endNextDay;
    if (changed && v.remarks.length < 5) throw new AppError('Approving a different time than filed needs a remark (at least 5 characters).');
    const state = store.read(), employee = state.employees.find(e => e.id === r.employeeId);
    if (posted(state, r.employeeId, r.date)) throw new AppError('Payroll for that date is posted; the attendance is locked. Reverse the payroll to correct it.');
    const label = `HR-approved adjustment ${r.reference} (${CATEGORIES[r.category]}): ${r.reason}${v.remarks ? ` · HR: ${v.remarks}` : ''}`.slice(0, 1000);
    const record = state.attendance.find(a => a.employeeId === r.employeeId && a.date === r.date);
    const openIn = (state.openClockIns || []).find(c => c.employeeId === r.employeeId && c.workDate === r.date);
    const profile = state.employeeProfiles?.find(p => p.employeeId === r.employeeId && p.section === 'attendance') || {};
    const base = { employeeId: r.employeeId, date: r.date, status: 'present', scheduledIn: scheduleOn(employee, profile, r.date).start || approved.timeIn || '09:00', breaks: [], approved: true, offsetMinutes: 0, exception: false, holidayEligible: false };
    const location = (r.location || '').slice(0, 200);
    let result;
    if (record) {
      result = saveRecord(store, actor, 'attendance', { ...record, timeIn: approved.timeIn || record.timeIn, timeOut: approved.timeOut || record.timeOut, endNextDay: approved.timeOut ? approved.endNextDay : record.endNextDay, status: 'present', approved: true, explanation: label, ...(location ? { location } : {}), correctionReason: label });
    } else if (approved.timeOut && (approved.timeIn || openIn)) {
      result = saveRecord(store, actor, 'attendance', { ...base, id: openIn ? `clock-${openIn.id}` : `req-${r.id}`, timeIn: approved.timeIn || openIn.time, timeOut: approved.timeOut, endNextDay: approved.endNextDay, explanation: label, ...(location ? { location } : {}), correctionReason: label });
    } else if (approved.timeIn && !approved.timeOut && r.date === local(now).slice(0, 10) && !openIn) {
      const event = { id: randomUUID(), employeeId: r.employeeId, kind: 'in', workDate: r.date, time: approved.timeIn, latitude: null, longitude: null, accuracy: null, capturedAt: null, recordedAt: now.toISOString(), synchronizedAt: now.toISOString(), geofence: { status: 'HR-approved adjustment' }, hrApproved: true, requestReference: r.reference, attendanceType: r.attendanceType, address: location || null, clockInId: null };
      store.db.prepare('INSERT INTO clock_events VALUES(?,?,?,?,?)').run(event.id, r.employeeId, 'in', r.date, JSON.stringify(event));
      store.log(actor, 'approved-time-in', 'clock', event.id, null, event);
      result = event;
    } else if (!approved.timeOut) throw new AppError('This day has no time out on record. Enter the approved time out as well.');
    else throw new AppError('This day has no time in on record. Enter the approved time in as well.');
    const decision = { by: actor.username, at: new Date().toISOString(), remarks: v.remarks, approved, requested: { timeIn: r.timeIn, timeOut: r.timeOut, endNextDay: r.endNextDay }, original: record ? { timeIn: record.timeIn, timeOut: record.timeOut, status: record.status, endNextDay: record.endNextDay } : r.original };
    const next = step(r, actor, 'approved', v.remarks, { status: 'approved', decision, attendanceId: result.id }); save(store, next);
    store.log(actor, 'approve', 'attendance-request', id, r, next);
    store.notify(r.employeeId, `Your request ${r.reference} (${r.date}) was approved${changed ? ` with time ${approved.timeIn || '—'} – ${approved.timeOut || '—'}` : ''}.${v.remarks ? ` HR: ${v.remarks}` : ''}`);
    return next;
  });
}

// Hourly: requests waiting for HR longer than the review period get one HR reminder a day.
export function remindOverdueRequests(store, now = new Date(), hours = REVIEW_HOURS) {
  ensure(store);
  const day = local(now).slice(0, 10), sent = [];
  for (const r of store.db.prepare("SELECT data FROM attendance_requests WHERE status IN ('pending','review')").all().map(x => JSON.parse(x.data))) {
    const waiting = (now.getTime() - Date.parse(r.updatedAt || r.submittedAt)) / 3600000, key = `ar-remind:${r.id}:${day}`;
    if (waiting < hours || store.db.prepare('SELECT 1 FROM hr_counters WHERE key=?').get(key)) continue;
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run(key);
    store.notify(null, `Attendance request ${r.reference} (${r.employeeName}, ${r.date}) has waited ${Math.floor(waiting)} hours for HR action.`);
    sent.push(r.reference);
  }
  return sent;
}
export const LABELS = { CATEGORIES, STATUS_LABELS };
export const isOpen = status => OPEN.includes(status);
