import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { date, schemas } from './schema.mjs';
import { leaveBalance, leaveDates, ruleOn, isRest, attendanceMinutes, scheduleOn } from './engine.mjs';
import { getDocument } from './profiles.mjs';

export const clockSchema = z.object({ kind: z.enum(['in', 'out']), requestId: z.string().uuid(), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), accuracy: z.number().finite().min(0).max(100000), capturedAt: z.string().datetime() }).strict();
const note = z.string().trim().min(3).max(2000);
const documentId = z.string().max(80).default('');
const local = now => new Date(now.getTime() + 8 * 3600000).toISOString();
const hhmm = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const fromMinutes = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const rows = (store, table, id) => store.db.prepare(`SELECT data FROM ${table} WHERE employee_id=? ORDER BY rowid DESC`).all(id).map(r => JSON.parse(r.data));
function ownEmployee(store, actor) {
  permit(actor, ['employee']);
  const employee = store.read().employees.find(e => e.id === actor.employeeId);
  if (!employee) throw new AppError('Your account is not connected to an employee record.', 403);
  return employee;
}
export function earlierHistory(store, actor, before) {
  ownEmployee(store, actor);
  const cursor = store.db.prepare('SELECT rowid FROM clock_events WHERE id=? AND employee_id=?').get(before, actor.employeeId);
  if (!cursor) throw new AppError('History cursor not found.', 404);
  return store.db.prepare('SELECT data FROM clock_events WHERE employee_id=? AND rowid<? ORDER BY rowid DESC LIMIT 200').all(actor.employeeId, cursor.rowid).map(r => JSON.parse(r.data));
}
function ready(employee, day) {
  if (employee.draft || !employee.active || !employee.startDate || day < employee.startDate || (employee.endDate && day > employee.endDate)) throw new AppError('HR must complete and activate your employment record before you can record attendance or apply for leave.');
}
function profileOf(state, id, section) { return state.employeeProfiles?.find(p => p.employeeId === id && p.section === section) || {}; }
export function geofence(reading, workplace) {
  if (workplace.latitude == null || workplace.longitude == null || workplace.radiusMeters == null) return { status: 'Not configured', distance: null, radius: null, poorAccuracy: reading.accuracy > 100 };
  const rad = n => n * Math.PI / 180;
  const a = Math.sin(rad(reading.latitude - workplace.latitude) / 2) ** 2 + Math.cos(rad(reading.latitude)) * Math.cos(rad(workplace.latitude)) * Math.sin(rad(reading.longitude - workplace.longitude) / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  const status = distance + reading.accuracy <= workplace.radiusMeters ? 'Within' : distance - reading.accuracy > workplace.radiusMeters ? 'Outside' : 'Uncertain';
  return { status, distance: Math.round(distance), radius: workplace.radiusMeters, poorAccuracy: reading.accuracy > Math.min(100, workplace.radiusMeters) };
}
export function punch(store, actor, input, now = new Date()) {
  const employee = ownEmployee(store, actor), value = clockSchema.parse(input);
  return store.transaction(() => {
    const retry = store.db.prepare('SELECT data,employee_id FROM clock_events WHERE id=?').get(value.requestId);
    if (retry) { if (retry.employee_id !== employee.id || JSON.parse(retry.data).kind !== value.kind) throw new AppError('Clock request does not belong to this employee.', 403); return JSON.parse(retry.data); }
    if (Math.abs(now.getTime() - Date.parse(value.capturedAt)) > 120000) throw new AppError('Location reading is stale. Capture your current location again.');
    const state = store.read(), history = rows(store, 'clock_events', employee.id), latest = history[0], day = local(now).slice(0, 10);
    ready(employee, day);
    const workplace = profileOf(state, employee.id, 'attendance'), employment = profileOf(state, employee.id, 'employment');
    if (['Suspended', 'Resigned', 'Terminated', 'Inactive'].includes(employment.employeeStatus)) throw new AppError('Your employment status requires HR review before attendance can be recorded.');
    let clockIn;
    if (value.kind === 'in') {
      if (latest?.kind === 'in') throw new AppError('You already have an open time-in. Time out or contact HR.');
      if (history.some(e => e.workDate === day && e.kind === 'in') || state.attendance.some(a => a.employeeId === employee.id && a.date === day)) throw new AppError('Attendance already exists for today. Ask HR for a correction.');
      if (state.leaves.some(l => l.employeeId === employee.id && l.status === 'approved' && (l.countedDates || []).includes(day))) throw new AppError('You are on approved leave today. Ask HR to review before clocking in.');
    } else {
      if (latest?.kind !== 'in') throw new AppError('Record time-in before time-out.');
      clockIn = latest;
      const duration = now.getTime() - Date.parse(clockIn.recordedAt);
      if (duration < 60000 || duration > 86400000) throw new AppError('Shift must last at least one minute and at most 24 hours. Ask HR to correct missing time-out.');
    }
    const workDate = clockIn?.workDate || day;
    if (state.runs.some(r => r.start <= workDate && r.end >= workDate && r.rows.some(row => row.employeeId === employee.id))) throw new AppError('This attendance belongs to posted payroll. Contact HR.');
    const event = { id: value.requestId, employeeId: employee.id, kind: value.kind, workDate, time: local(now).slice(11, 16), latitude: value.latitude, longitude: value.longitude, accuracy: value.accuracy, capturedAt: value.capturedAt, recordedAt: now.toISOString(), synchronizedAt: new Date().toISOString(), geofence: geofence(value, workplace), approvedLocation: workplace.approvedLocation || '', address: null, clockInId: clockIn?.id || null };
    if (clockIn) {
      if (state.attendance.some(a => a.employeeId === employee.id && a.date === workDate)) throw new AppError('HR has already entered a record for this day. Ask HR to reconcile it.');
      const approvedExplanation = rows(store, 'attendance_explanations', employee.id).find(e => e.date === workDate && e.status === 'approved');
      const record = schemas.attendance.parse({ id: `clock-${clockIn.id}`, employeeId: employee.id, date: workDate, status: 'present', scheduledIn: scheduleOn(employee, profileOf(state, employee.id, 'attendance'), workDate).start, timeIn: clockIn.time, timeOut: event.time, endNextDay: day !== workDate, breaks: [], approved: false, offsetMinutes: approvedExplanation?.approvedOffset || 0, exception: false, explanation: approvedExplanation?.explanation || 'Employee clock events: HR must review exact unpaid breaks and approve.', holidayEligible: false });
      attendanceMinutes(record);
      state.attendance.push(record); state.version++; store.write(state);
      store.log(actor, 'create-from-clock', 'attendance', record.id, null, record);
    }
    store.db.prepare('INSERT INTO clock_events VALUES(?,?,?,?,?)').run(event.id, employee.id, value.kind, workDate, JSON.stringify(event));
    store.notify(null, `${employee.id}: time ${value.kind} recorded at ${event.time}.`);
    store.log(actor, `time-${value.kind}`, 'clock', event.id, null, event);
    return event;
  });
}
export function todayAttendance(store, employee, now = new Date()) {
  const state = store.read(), day = local(now).slice(0, 10), allEvents = rows(store, 'clock_events', employee.id);
  const open = allEvents[0]?.kind === 'in' ? allEvents[0] : null;
  const workDate = open?.workDate || day, events = allEvents.filter(e => e.workDate === workDate), clockIn = events.find(e => e.kind === 'in'), clockOut = events.find(e => e.kind === 'out');
  const record = state.attendance.find(a => a.employeeId === employee.id && a.date === workDate);
  const schedule = scheduleOn(employee, profileOf(state, employee.id, 'attendance'), workDate, ruleOn(state, day));
  const scheduledIn = record?.scheduledIn || schedule.start;
  const scheduledOut = schedule.end || (scheduledIn ? fromMinutes(hhmm(scheduledIn) + schedule.hoursPerDay * 60 + schedule.mealBreakMinutes) : '');
  const actualIn = record?.timeIn || clockIn?.time || '', actualOut = record?.timeOut || clockOut?.time || '';
  const late = scheduledIn && actualIn ? Math.max(0, hhmm(actualIn) - hhmm(scheduledIn)) : 0;
  const currentMinutes = hhmm(local(now).slice(11, 16)) + (day > workDate ? 1440 : 0);
  const endMinutes = scheduledOut && scheduledIn ? hhmm(scheduledOut) + (scheduledOut <= scheduledIn ? 1440 : 0) : null;
  let workedMinutes = record?.timeIn && record.timeOut ? attendanceMinutes(record).length : clockIn ? Math.max(0, Math.floor(((clockOut ? Date.parse(clockOut.recordedAt) : now.getTime()) - Date.parse(clockIn.recordedAt)) / 60000)) : 0;
  const hours = Math.round(workedMinutes / 60 * 100) / 100;
  const undertime = actualOut && !isRest(employee, workDate) ? Math.max(0, schedule.hoursPerDay * 60 - workedMinutes - late) : 0;
  const leave = state.leaves.find(l => l.employeeId === employee.id && l.status === 'approved' && (l.countedDates || []).includes(day));
  let status = employee.draft ? 'Profile incomplete' : !employee.active || (employee.endDate && employee.endDate < day) ? 'Inactive' : employee.startDate > day ? 'Not started' : 'Awaiting time in';
  if (status === 'Awaiting time in' && isRest(employee, day)) status = 'Rest day';
  if (status === 'Awaiting time in' && state.holidays.some(h => h.date === day && h.kind !== 'ordinary')) status = 'Holiday';
  if (leave) status = 'On leave';
  else if (record?.status === 'official-business') status = 'Official business';
  else if (record?.status === 'rest-day-swap') status = 'Rest-day swap';
  else if (record?.status === 'off') status = 'Off duty';
  else if (record?.status === 'absent' || (!actualIn && status === 'Awaiting time in' && endMinutes !== null && currentMinutes > endMinutes)) status = 'Absent';
  else if (actualIn) status = !actualOut && endMinutes !== null && currentMinutes > endMinutes ? 'Missing time out' : late ? 'Late' : 'Present';
  const exceptions = events.filter(e => ['Outside', 'Uncertain'].includes(e.geofence.status) || e.geofence.poorAccuracy).map(e => `${e.kind === 'in' ? 'Time in' : 'Time out'}: ${e.geofence.status}, accuracy ±${e.accuracy} m`);
  return { date: workDate, status, scheduledIn, scheduledOut, arrangement: schedule.arrangement, actualIn, actualOut, hours, late, undertime, clockIn, clockOut, open: !!open, exceptions, needsApproval: !!record && !record.approved, breakNotice: record?.breaks.length ? 'Exact unpaid breaks deducted' : 'Before HR review of unpaid breaks', recordId: record?.id || null };
}
function validateAttachment(store, actor, id) { if (id) { const doc = getDocument(store, actor, id); if (doc.employeeId !== actor.employeeId || doc.uploadedBy !== actor.username || doc.type !== 'Leave Supporting' || doc.status !== 'Active') throw new AppError('Use your own active supporting document.', 403); } }
export function applyLeave(store, actor, input) {
  const employee = ownEmployee(store, actor);
  const value = z.object({ typeId: z.string().max(80), startDate: date, endDate: date, reason: note, documentId }).strict().refine(v => v.endDate >= v.startDate && Date.parse(v.endDate) - Date.parse(v.startDate) <= 366 * 86400000, 'Choose a valid leave range of at most 366 days.').parse(input);
  return store.transaction(() => {
    const state = store.read(), type = state.leaveTypes.find(t => t.id === value.typeId);
    ready(employee, value.startDate); ready(employee, value.endDate);
    if (!type || !employee.leaveEligibility.includes(type.id)) throw new AppError('This leave type is not enabled for your employee profile. Contact HR.');
    validateAttachment(store, actor, value.documentId);
    if (state.leaves.some(l => l.employeeId === employee.id && !['rejected', 'cancelled'].includes(l.status) && l.startDate <= value.endDate && l.endDate >= value.startDate)) throw new AppError('These dates overlap an existing leave request.');
    if (state.runs.some(r => r.start <= value.endDate && r.end >= value.startDate && r.rows.some(row => row.employeeId === employee.id))) throw new AppError('These dates belong to posted payroll.');
    const countedDates = leaveDates(employee, type, value.startDate, value.endDate);
    if (!countedDates.length) throw new AppError('Choose at least one eligible leave day.');
    const leave = { id: randomUUID(), employeeId: employee.id, typeId: type.id, startDate: value.startDate, endDate: value.endDate, reason: value.reason, days: countedDates.length, countedDates, documentReference: value.documentId, eligibilityVerified: false, status: 'pending', proofStatus: value.documentId ? 'submitted' : type.documentsRequired ? 'required' : '', proofNote: '', proofReviewedBy: '', proofReviewedAt: '' };
    state.leaves.push(leave); state.version++; store.write(state); store.log(actor, 'apply', 'leaves', leave.id, null, leave); return leave;
  });
}
// Employee uploads proof (e.g. a medical certificate on return to work) for their own leave.
export function attachLeaveProof(store, actor, id, input) {
  const employee = ownEmployee(store, actor);
  const value = z.object({ documentId: z.string().min(1).max(80) }).strict().parse(input);
  validateAttachment(store, actor, value.documentId);
  return store.transaction(() => {
    const state = store.read(), leave = state.leaves.find(l => l.id === id && l.employeeId === employee.id);
    if (!leave) throw new AppError('Leave request not found.', 404);
    if (['cancelled', 'rejected'].includes(leave.status)) throw new AppError('This leave request is closed; proof is no longer needed.');
    if (leave.proofStatus === 'verified') throw new AppError('HR has already confirmed the proof for this leave.');
    const before = structuredClone(leave);
    Object.assign(leave, { documentReference: value.documentId, proofStatus: 'submitted', proofNote: '', proofReviewedBy: '', proofReviewedAt: '' });
    state.version++; store.write(state); store.log(actor, 'attach-proof', 'leaves', id, before, leave);
    store.notify(null, `${employee.id}: proof uploaded for leave ${leave.startDate} → ${leave.endDate}; awaiting HR review.`);
    return leave;
  });
}
// HR/Admin confirms or rejects uploaded proof; a rejection needs a reason the employee can act on.
export function reviewLeaveProof(store, actor, id, input) {
  permit(actor, ['admin', 'hr']);
  const value = z.object({ decision: z.enum(['verified', 'rejected']), note: z.string().trim().max(2000).default('') }).strict().parse(input);
  if (value.decision === 'rejected' && value.note.length < 3) throw new AppError('Give a reason so the employee knows what to upload instead.');
  return store.transaction(() => {
    const state = store.read(), leave = state.leaves.find(l => l.id === id);
    if (!leave) throw new AppError('Leave request not found.', 404);
    if (!leave.documentReference || !['submitted', 'verified', 'rejected'].includes(leave.proofStatus)) throw new AppError('No proof has been uploaded for this leave yet.');
    const before = structuredClone(leave);
    Object.assign(leave, { proofStatus: value.decision, proofNote: value.note, proofReviewedBy: actor.username, proofReviewedAt: new Date().toISOString() });
    state.version++; store.write(state); store.log(actor, 'review-proof', 'leaves', id, before, leave);
    store.notify(leave.employeeId, value.decision === 'verified'
      ? `HR confirmed your proof for leave ${leave.startDate} → ${leave.endDate}.`
      : `HR needs a new proof for leave ${leave.startDate} → ${leave.endDate}: ${value.note}`);
    return leave;
  });
}
export function cancelLeave(store, actor, id) {
  ownEmployee(store, actor);
  return store.transaction(() => {
    const state = store.read(), leave = state.leaves.find(l => l.id === id && l.employeeId === actor.employeeId);
    if (!leave) throw new AppError('Leave request not found.', 404);
    if (leave.status !== 'pending') throw new AppError('Only pending leave requests can be cancelled. Contact HR for approved leave.');
    const before = structuredClone(leave); leave.status = 'cancelled'; state.version++; store.write(state); store.log(actor, 'cancel', 'leaves', id, before, leave); return leave;
  });
}
export function submitExplanation(store, actor, input) {
  const employee = ownEmployee(store, actor);
  const value = z.object({ date, reason: note, explanation: note, requestedOffset: z.number().int().min(0).max(1440), documentId }).strict().parse(input);
  ready(employee, value.date); validateAttachment(store, actor, value.documentId);
  return store.transaction(() => {
    if (rows(store, 'attendance_explanations', employee.id).some(e => e.date === value.date && e.status !== 'rejected')) throw new AppError('An explanation already exists for this day.');
    const explanation = { ...value, id: randomUUID(), employeeId: employee.id, submittedAt: new Date().toISOString(), status: 'pending', approvedOffset: 0 };
    store.db.prepare('INSERT INTO attendance_explanations VALUES(?,?,?)').run(explanation.id, employee.id, JSON.stringify(explanation));
    store.notify(null, `${employee.id}: attendance explanation awaits review.`);
    store.log(actor, 'submit', 'explanations', explanation.id, null, explanation); return explanation;
  });
}
export function reviewExplanation(store, actor, id, input) {
  permit(actor, ['admin', 'hr']);
  const value = z.object({ status: z.enum(['approved', 'rejected']), approvedOffset: z.number().int().min(0).max(1440), note }).strict().parse(input);
  return store.transaction(() => {
    const row = store.db.prepare('SELECT data FROM attendance_explanations WHERE id=?').get(id);
    if (!row) throw new AppError('Explanation not found.', 404);
    const before = JSON.parse(row.data);
    if (before.status !== 'pending') throw new AppError('This explanation was already reviewed.');
    if (value.approvedOffset > before.requestedOffset) throw new AppError('Approved offset exceeds the requested minutes.');
    const state = store.read(), record = state.attendance.find(a => a.employeeId === before.employeeId && a.date === before.date);
    if (state.runs.some(r => r.start <= before.date && r.end >= before.date && r.rows.some(a => a.employeeId === before.employeeId))) throw new AppError('Attendance belongs to posted payroll; use a later authorized adjustment.');
    const after = { ...before, ...value, approvedOffset: value.status === 'approved' ? value.approvedOffset : 0, reviewedBy: actor.username, reviewedAt: new Date().toISOString() };
    if (record && after.status === 'approved') {
      const previous = structuredClone(record); record.offsetMinutes = after.approvedOffset; record.explanation = after.explanation; record.approved = false;
      const correction = { reason: value.note, correctedBy: actor.username, approver: actor.username, at: after.reviewedAt, before: previous, after: record };
      store.db.prepare('INSERT INTO attendance_corrections VALUES(?,?,?,?)').run(randomUUID(), before.employeeId, record.id, JSON.stringify(correction));
      state.version++; store.write(state); store.log(actor, 'explanation-offset', 'attendance', record.id, previous, { ...record, correction });
    }
    store.db.prepare('UPDATE attendance_explanations SET data=? WHERE id=?').run(JSON.stringify(after), id);
    store.notify(before.employeeId, `Your attendance explanation for ${before.date} was ${after.status}.`);
    store.log(actor, 'review', 'explanations', id, before, after); return after;
  });
}
export function employeeDashboard(store, actor, now = new Date()) {
  const employee = ownEmployee(store, actor), state = store.read(), day = local(now).slice(0, 10);
  const employment = profileOf(state, employee.id, 'employment'), leaves = state.leaves.filter(l => l.employeeId === employee.id);
  const balances = state.leaveTypes.filter(t => employee.leaveEligibility.includes(t.id)).map(type => {
    const balance = leaveBalance(state, employee, type, day), pending = leaves.filter(l => l.typeId === type.id && l.status === 'pending').reduce((sum, l) => sum + (l.countedDates || []).filter(d => d.startsWith(day.slice(0, 4))).length, 0);
    return { typeId: type.id, name: type.name, documentsRequired: type.documentsRequired, perOccasion: !type.balanceRequired, maxDays: type.entitledDays, ...balance, pending, remaining: Math.max(0, balance.available - pending) };
  });
  const documents = store.db.prepare('SELECT metadata FROM employee_documents WHERE employee_id=?').all(employee.id).map(d => JSON.parse(d.metadata)).filter(d => d.uploadedBy === actor.username && d.type === 'Leave Supporting');
  return { employee: { id: employee.id, name: employee.name, department: employee.department, position: employment.position || '', employmentStatus: employment.employmentStatus || '', employeeStatus: employment.employeeStatus || (employee.active ? 'Active' : 'Inactive'), scheduleStart: employee.scheduleStart, draft: employee.draft }, today: todayAttendance(store, employee, now), history: rows(store, 'clock_events', employee.id).slice(0, 200), attendance: state.attendance.filter(a => a.employeeId === employee.id).slice(-200), corrections: rows(store, 'attendance_corrections', employee.id).slice(0, 100), explanations: rows(store, 'attendance_explanations', employee.id), balances, leaves, documents,
    payslips: state.runs.filter(r => r.status === 'posted' && r.rows.some(row => row.employeeId === employee.id)).map(r => ({ id: r.id, start: r.start, end: r.end, net: r.rows.find(row => row.employeeId === employee.id).net })),
    notifications: store.db.prepare('SELECT id,created_at AS at,message FROM notifications WHERE employee_id=? ORDER BY rowid DESC LIMIT 50').all(employee.id), serverTime: now.toISOString() };
}
export function liveDashboard(store, actor, now = new Date()) {
  permit(actor, ['admin', 'hr']);
  const state = store.read();
  const employees = state.employees.filter(e => !e.endDate || e.endDate >= local(now).slice(0, 10)).map(e => ({ employeeId: e.id, name: e.name, ...todayAttendance(store, e, now) }));
  const explanations = store.db.prepare('SELECT data FROM attendance_explanations ORDER BY rowid DESC LIMIT 200').all().map(r => JSON.parse(r.data));
  const history = store.db.prepare('SELECT data FROM clock_events ORDER BY rowid DESC LIMIT 200').all().map(r => JSON.parse(r.data));
  return { employees, explanations, history, notifications: store.db.prepare('SELECT id,created_at AS at,message FROM notifications WHERE employee_id IS NULL ORDER BY rowid DESC LIMIT 50').all(), serverTime: now.toISOString() };
}
export function correctClock(store, actor, input) {
  permit(actor, ['admin', 'hr']);
  const value = z.object({ employeeId: z.string(), date, timeOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endNextDay: z.boolean(), reason: note }).strict().parse(input);
  return store.transaction(() => {
  const original = rows(store, 'clock_events', value.employeeId).find(e => e.workDate === value.date && e.kind === 'in');
  if (!original) throw new AppError('Original time-in not found.');
  const state = store.read(), employee = state.employees.find(e => e.id === value.employeeId);
  const record = { id: `clock-${original.id}`, employeeId: employee.id, date: value.date, status: 'present', scheduledIn: scheduleOn(employee, profileOf(state, employee.id, 'attendance'), value.date).start, timeIn: original.time, timeOut: value.timeOut, endNextDay: value.endNextDay, breaks: [], approved: false, offsetMinutes: 0, exception: false, explanation: value.reason, holidayEligible: false, correctionReason: value.reason };
  const saved = saveRecord(store, actor, 'attendance', record);
  // A separate immutable reconciliation event closes the open shift, preserving both readings.
  if (!rows(store, 'clock_events', employee.id).some(e => e.clockInId === original.id)) {
    const event = { ...original, id: randomUUID(), kind: 'out', time: value.timeOut, clockInId: original.id, latitude: null, longitude: null, accuracy: null, capturedAt: null, recordedAt: new Date().toISOString(), synchronizedAt: new Date().toISOString(), geofence: { status: 'HR correction', poorAccuracy: false, distance: null }, correctedBy: actor.username, correctionReason: value.reason };
    store.db.prepare('INSERT INTO clock_events VALUES(?,?,?,?,?)').run(event.id, employee.id, 'out', original.workDate, JSON.stringify(event)); store.log(actor, 'correct-time-out', 'clock', event.id, original, event);
  }
  return saved;
  });
}
export async function locationAddress(store, actor, eventId, provider = process.env.HR_GEOCODING_URL) {
  const row = store.db.prepare('SELECT data,employee_id FROM clock_events WHERE id=?').get(eventId);
  if (!row || (actor.role === 'employee' ? row.employee_id !== actor.employeeId : !['admin', 'hr'].includes(actor.role))) throw new AppError('Location not found.', 404);
  const cached = store.db.prepare('SELECT address,fetched_at AS fetchedAt FROM location_addresses WHERE event_id=?').get(eventId);
  if (cached) return cached;
  if (!provider) return { address: null, message: 'Reverse geocoding is not configured. Coordinates and the approved workplace are available.' };
  const event = JSON.parse(row.data);
  if (event.latitude === null) return { address: null, message: 'HR corrections do not have device GPS.' };
  const url = new URL(provider);
  if (url.protocol !== 'https:') throw new AppError('The configured geocoding service must use HTTPS.');
  url.searchParams.set('lat', String(event.latitude)); url.searchParams.set('lon', String(event.longitude)); url.searchParams.set('format', 'jsonv2');
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'GDS-HR-Self-Service/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('Geocoding unavailable');
    const data = await response.json(), address = z.string().min(1).max(2000).parse(data.display_name);
    const fetchedAt = new Date().toISOString(); store.db.prepare('INSERT OR REPLACE INTO location_addresses VALUES(?,?,?)').run(eventId, address, fetchedAt);
    return { address, fetchedAt };
  } catch { return { address: null, message: 'Address lookup is currently unavailable; the recorded coordinates remain unchanged.' }; }
}
export function ownPayslip(store, actor, runId) {
  const employee = ownEmployee(store, actor), run = store.read().runs.find(r => r.id === runId && r.status === 'posted'), row = run?.rows.find(r => r.employeeId === employee.id);
  if (!row) throw new AppError('Payslip not found.', 404);
  const loans = (row.loanDeductions || []).map(l => ({ type: l.type || run.sources?.loans?.find(source => source.id === l.loanId)?.type || 'Loan', reference: l.reference || '', amount: l.amount, previousBalance: l.previousBalance, remainingBalance: l.remainingBalance }));
  // Use the posted employee row only; never recompute historical payslips from current rates.
  const computation = (row.trace || []).map(({ component, side, amount, formula, date }) => ({ component, side, amount, formula, date }));
  const deductionItems = Object.entries(row.deductions).filter(([key]) => !['loans', 'other'].includes(key)).map(([label, amount]) => ({ label, amount }));
  for (const loan of loans) deductionItems.push({ label: `${loan.type}${loan.reference ? ` (${loan.reference})` : ''}`, amount: loan.amount });
  for (const type of ['Salary Loan', 'SSS Loan', 'Pag-IBIG Loan']) if (!loans.some(l => l.type === type)) deductionItems.push({ label: type, amount: 0 });
  const otherItems = computation.filter(t => t.side === 'deductions' && t.component === 'other');
  deductionItems.push(...otherItems.map(t => ({ label: t.formula, amount: t.amount })));
  const residual = (total, items) => Math.round((total - items.reduce((sum, item) => sum + item.amount, 0)) * 100) / 100;
  const loanRemainder = residual(row.deductions.loans || 0, loans), otherRemainder = residual(row.deductions.other || 0, otherItems);
  if (loanRemainder) deductionItems.push({ label: 'Other loan deductions (detail unavailable)', amount: loanRemainder });
  if (otherRemainder || !otherItems.length) deductionItems.push({ label: 'Other authorized deductions', amount: otherRemainder });
  store.log(actor, 'view-payslip', 'payslip', run.id, null, { employeeId: employee.id });
  return { id: run.id, start: run.start, end: run.end, postedAt: run.postedAt, employeeId: employee.id, employeeName: row.employeeName, monthlySalary: row.monthlySalary, dailyRate: row.dailyRate, hourlyRate: row.hourlyRate, workingDays: row.workingDays, daysPresent: row.daysPresent, leaveDays: row.leaveDays, earnings: row.earnings, deductions: row.deductions, deductionItems, computation, gross: row.gross, totalDeductions: row.totalDeductions, net: row.net, loans };
}
export function payslipPdf(payslip) {
  const labels = { nsd: 'Night shift differential', absence: 'Unpaid leave / absence', tax: 'Withholding tax', other: 'Other authorized deductions', thirteenth: '13th month pay', PhilHealth: 'PhilHealth' };
  const cash = n => `PHP ${Number(n || 0).toFixed(2)}`, pretty = s => labels[s] || s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
  const lines = ['GDS CAPITAL INC. - EMPLOYEE PAYSLIP', `${payslip.employeeName} (${payslip.employeeId})`, `Period: ${payslip.start} to ${payslip.end}`, `Monthly salary: ${cash(payslip.monthlySalary)} | Daily rate: ${cash(payslip.dailyRate)}`, `Hourly rate: ${cash(payslip.hourlyRate)} | Scheduled days: ${payslip.workingDays ?? 'Unavailable'}`, `Days present: ${payslip.daysPresent ?? 'Unavailable'} | Leave days: ${payslip.leaveDays ?? 'Unavailable'}`, '', 'EARNINGS', ...Object.entries(payslip.earnings).map(([k, v]) => `${pretty(k)}: ${cash(v)}`), '', 'ITEMIZED DEDUCTIONS', ...payslip.deductionItems.map(item => `${pretty(item.label)}: ${cash(item.amount)}`), '', `Gross salary (sum of earnings): ${cash(payslip.gross)}`, `Total deductions (sum of deduction items): ${cash(payslip.totalDeductions)}`, `NET SALARY: ${cash(payslip.gross)} - ${cash(payslip.totalDeductions)} = ${cash(payslip.net)}`, '', 'LOAN BALANCES (deductions already included above)', ...payslip.loans.map(l => `${l.type}${l.reference ? ` (${l.reference})` : ''}: ${l.previousBalance == null ? 'Unavailable' : cash(l.previousBalance)} - ${cash(l.amount)} = ${l.remainingBalance == null ? 'Unavailable' : cash(l.remainingBalance)}`), '', 'SALARY COMPUTATION - POSTED PAYROLL', ...payslip.computation.flatMap(t => [`${t.date || ''} | ${t.side} | ${pretty(t.component)}: ${cash(t.amount)}`, `  ${t.formula}`])];
  const escaped = text => text.replaceAll('×', 'x').replaceAll('÷', '/').replaceAll('−', '-').replaceAll('→', '->').replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
  const wrapped = lines.flatMap(line => line.match(/.{1,90}/g) || ['']);
  const pages = []; for (let i = 0; i < wrapped.length; i += 48) pages.push(wrapped.slice(i, i + 48));
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pageIds = [];
  pages.forEach((page, index) => {
    const pageId = objects.length + 1; pageIds.push(pageId);
    const stream = `0.70 0.12 0.17 rg 35 790 525 28 re f 1 1 1 rg BT /F1 12 Tf 45 800 Td (GDS CAPITAL INC. - PAYSLIP) Tj ET 0.12 0.12 0.12 rg BT /F1 10 Tf 40 765 Td 14 TL ${page.map((line, i) => `${i ? 'T* ' : ''}(${escaped(line)}) Tj`).join('\n')} ET 0.82 0.67 0.29 RG 35 55 m 560 55 l S BT /F1 9 Tf 40 40 Td (Employee ${escaped(payslip.employeeId)} | Page ${index + 1} of ${pages.length}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
