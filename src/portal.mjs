import { randomUUID } from 'node:crypto';
import { renderPayslipPdf } from './payslip-pdf.mjs';
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { date, schemas } from './schema.mjs';
import { leaveBalance, leaveSplit, leaveFraction, ruleOn, isRest, attendanceMinutes, scheduleOn, OT_BLOCK } from './engine.mjs';
import { getDocument } from './profiles.mjs';
import { networkStatus, inOfficeArea } from './office-network.mjs';
import { lateBy, graceFor } from './late-incidents.mjs';
import { explanationsDue, EXPLAIN_AFTER_MINUTES } from './late-explanations.mjs';
import { payDateFor, payslipReleased, manilaNow } from './paydays.mjs';
import { reasonsFor } from './live-reasons.mjs';

export const clockSchema = z.object({ kind: z.enum(['in', 'out']), requestId: z.string().uuid(), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), accuracy: z.number().finite().min(0).max(100000), capturedAt: z.string().datetime(), mode: z.enum(['office', 'outside']).default('office'), reason: z.string().trim().max(500).default('') }).strict();
const note = z.string().trim().min(3).max(2000);
const documentId = z.string().max(80).default('');
const local = now => new Date(now.getTime() + 8 * 3600000).toISOString();
const hhmm = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const fromMinutes = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const rows = (store, table, id) => store.db.prepare(`SELECT data FROM ${table} WHERE employee_id=? ORDER BY rowid DESC`).all(id).map(r => JSON.parse(r.data));
// Where a time in / out was made: the office address on the office Wi-Fi or inside the office area, else the street
// address looked up for that exact GPS point (when already known).
function distanceMeters(lat1, lon1, lat2, lon2) { const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(a)); }
const companyOf = store => { try { return JSON.parse(store.db.prepare('SELECT data FROM hr_settings LIMIT 1').get()?.data || '{}').company || {}; } catch { return {}; } };
function withPlace(store, events) {
  const company = companyOf(store), cached = new Map(store.db.prepare('SELECT event_id, address FROM location_addresses').all().map(r => [r.event_id, r.address]));
  return events.map(e => {
    if (e.latitude === null || e.latitude === undefined) return e;
    const office = company.officeAddress && (e.onOfficeNetwork || e.inOfficeArea || (company.officeLatitude !== null && company.officeLatitude !== undefined && distanceMeters(e.latitude, e.longitude, company.officeLatitude, company.officeLongitude) <= (company.officeRadius || 150)));
    return { ...e, place: office ? company.officeAddress : cached.get(e.id) || '', atOffice: !!office };
  });
}
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
export function punch(store, actor, input, now = new Date(), { ip = '' } = {}) {
  const employee = ownEmployee(store, actor), value = clockSchema.parse(input);
  // Office Wi-Fi rule: time in / out from the office network; anywhere else it is "Out of office" with a reason for HR.
  const network = networkStatus(store, ip);
  const officeArea = inOfficeArea(store, value.latitude, value.longitude, value.accuracy);
  if (value.mode === 'office' && network.configured && !network.office && !officeArea) throw new AppError('You are not at the office (not on the office Wi-Fi and your location is outside the office). Choose Out of office and give the reason.');
  if (value.mode === 'outside' && value.reason.length < 5) throw new AppError('Give the reason you are out of the office (at least 5 characters).');
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
      if (latest?.kind === 'in' && !staleOpen(latest, day, now)) throw new AppError('You already have an open time-in. Time out or contact HR.');
      if (history.some(e => e.workDate === day && e.kind === 'in') || state.attendance.some(a => a.employeeId === employee.id && a.date === day)) throw new AppError('Attendance already exists for today. Ask HR for a correction.');
      if (state.leaves.some(l => l.employeeId === employee.id && l.status === 'approved' && (l.countedDates || []).includes(day) && !(l.partialDates || []).includes(day))) throw new AppError('You are on approved leave today. Ask HR to review before clocking in.');
    } else {
      if (latest?.kind !== 'in') throw new AppError('Record time-in before time-out.');
      if (staleOpen(latest, day, now)) throw new AppError(`Your time in on ${latest.workDate} has no time out. HR will correct it; time in for today instead.`);
      clockIn = latest;
      const duration = now.getTime() - Date.parse(clockIn.recordedAt);
      if (duration < 60000 || duration > 86400000) throw new AppError('Shift must last at least one minute and at most 24 hours. Ask HR to correct missing time-out.');
    }
    const workDate = clockIn?.workDate || day;
    if (state.runs.some(r => r.start <= workDate && r.end >= workDate && r.rows.some(row => row.employeeId === employee.id))) throw new AppError('This attendance belongs to posted payroll. Contact HR.');
    const event = { id: value.requestId, employeeId: employee.id, kind: value.kind, workDate, time: local(now).slice(11, 16), latitude: value.latitude, longitude: value.longitude, accuracy: value.accuracy, capturedAt: value.capturedAt, recordedAt: now.toISOString(), synchronizedAt: new Date().toISOString(), geofence: geofence(value, workplace), onOfficeNetwork: network.office, inOfficeArea: officeArea, ...(value.mode === 'outside' ? { outOfOffice: true, reason: value.reason } : {}), approvedLocation: workplace.approvedLocation || '', address: null, clockInId: clockIn?.id || null };
    if (clockIn) {
      if (state.attendance.some(a => a.employeeId === employee.id && a.date === workDate)) throw new AppError('HR has already entered a record for this day. Ask HR to reconcile it.');
      const approvedExplanation = rows(store, 'attendance_explanations', employee.id).find(e => e.date === workDate && e.status === 'approved');
      const record = schemas.attendance.parse({ id: `clock-${clockIn.id}`, employeeId: employee.id, date: workDate, status: 'present', scheduledIn: (s => (s.flexible ? clockIn.time : s.start))(scheduleOn(employee, profileOf(state, employee.id, 'attendance'), workDate)), timeIn: clockIn.time, timeOut: event.time, endNextDay: day !== workDate, breaks: [], approved: false, offsetMinutes: approvedExplanation?.approvedOffset || 0, exception: false, explanation: approvedExplanation?.explanation || 'Employee clock events: HR must review exact unpaid breaks and approve.', holidayEligible: false });
      attendanceMinutes(record);
      state.attendance.push(record); state.version++; store.write(state);
      store.log(actor, 'create-from-clock', 'attendance', record.id, null, record);
    }
    store.db.prepare('INSERT INTO clock_events VALUES(?,?,?,?,?)').run(event.id, employee.id, value.kind, workDate, JSON.stringify(event));
    // Late 15 minutes or more against the day's schedule: the employee must explain it (Attendance → Explanations).
    if (value.kind === 'in') {
      const daySched = scheduleOn(employee, profileOf(state, employee.id, 'attendance'), workDate), lateMin = daySched.flexible ? 0 : lateBy(event.time, daySched.start);
      if (lateMin >= EXPLAIN_AFTER_MINUTES && !rows(store, 'attendance_explanations', employee.id).some(e => e.date === workDate)) {
        store.notify(employee.id, `You timed in ${lateMin} minutes late on ${workDate} (scheduled ${daySched.start}). Please submit a written explanation in Attendance → Explanations.`);
        store.notify(null, `${employee.id} ${employee.name}: timed in ${lateMin} minutes late on ${workDate}. Explanation required.`);
      }
    }
    store.notify(null, value.mode === 'outside' ? `${employee.id}: out of office time ${value.kind} at ${event.time}. Reason: ${value.reason}` : `${employee.id}: time ${value.kind} recorded at ${event.time}.`);
    store.log(actor, `time-${value.kind}`, 'clock', event.id, null, event);
    return event;
  });
}
// A time in from an earlier day left open for more than 16 hours is a forgotten time out: it no longer blocks today's
// time in. It stays open (missing time out) until HR records the correct time out.
const STALE_OPEN_MS = 16 * 3600000;
export const staleOpen = (event, day, now = new Date()) => event?.kind === 'in' && event.workDate < day && now.getTime() - Date.parse(event.recordedAt) > STALE_OPEN_MS;
export function todayAttendance(store, employee, now = new Date()) {
  const state = store.read(), day = local(now).slice(0, 10), allEvents = rows(store, 'clock_events', employee.id);
  const open = allEvents[0]?.kind === 'in' && !staleOpen(allEvents[0], day, now) ? allEvents[0] : null;
  const workDate = open?.workDate || day, events = allEvents.filter(e => e.workDate === workDate), clockIn = events.find(e => e.kind === 'in'), clockOut = events.find(e => e.kind === 'out');
  const record = state.attendance.find(a => a.employeeId === employee.id && a.date === workDate);
  const schedule = scheduleOn(employee, profileOf(state, employee.id, 'attendance'), workDate, ruleOn(state, day));
  const scheduledIn = schedule.flexible ? (record?.timeIn || clockIn?.time || '') : record?.scheduledIn || schedule.start;
  const scheduledOut = schedule.end || (scheduledIn ? fromMinutes(hhmm(scheduledIn) + schedule.hoursPerDay * 60 + schedule.mealBreakMinutes) : '');
  const actualIn = record?.timeIn || clockIn?.time || '', actualOut = record?.timeOut || clockOut?.time || '';
  const late = scheduledIn && actualIn ? Math.max(0, hhmm(actualIn) - hhmm(scheduledIn)) : 0;
  // Within the grace period the employee is not tagged late; they offset it by staying the same minutes after the end.
  const grace = profileOf(state, employee.id, 'attendance').graceMinutes ?? ruleOn(state, day)?.graceMinutes ?? 0, graceLate = late && late < grace ? late : 0;
  const currentMinutes = hhmm(local(now).slice(11, 16)) + (day > workDate ? 1440 : 0);
  const endMinutes = scheduledOut && scheduledIn ? hhmm(scheduledOut) + (scheduledOut <= scheduledIn ? 1440 : 0) : null;
  let workedMinutes = record?.timeIn && record.timeOut ? attendanceMinutes(record).length : clockIn ? Math.max(0, Math.floor(((clockOut ? Date.parse(clockOut.recordedAt) : now.getTime()) - Date.parse(clockIn.recordedAt)) / 60000)) : 0;
  const hours = Math.round(workedMinutes / 60 * 100) / 100;
  const undertime = actualOut && !isRest(employee, workDate) ? Math.max(0, schedule.hoursPerDay * 60 - workedMinutes - late) : 0;
  const leave = state.leaves.find(l => l.employeeId === employee.id && l.status === 'approved' && (l.countedDates || []).includes(day) && !(l.partialDates || []).includes(day));
  let status = employee.draft ? 'Profile incomplete' : !employee.active || (employee.endDate && employee.endDate < day) ? 'Inactive' : employee.startDate > day ? 'Not started' : 'Awaiting time in';
  if (status === 'Awaiting time in' && isRest(employee, day)) status = 'Rest day';
  if (status === 'Awaiting time in' && state.holidays.some(h => h.date === day && h.kind !== 'ordinary')) status = 'Holiday';
  if (leave) status = 'On leave';
  else if (record?.status === 'official-business') status = 'Official business';
  else if (record?.status === 'rest-day-swap') status = 'Rest-day swap';
  else if (record?.status === 'off') status = 'Off duty';
  else if (record?.status === 'absent' || (!actualIn && status === 'Awaiting time in' && endMinutes !== null && currentMinutes > endMinutes)) status = 'Absent';
  else if (actualIn) status = !actualOut && endMinutes !== null && currentMinutes > endMinutes ? 'Missing time out' : late && !graceLate ? 'Late' : 'Present';
  const exceptions = events.filter(e => ['Outside', 'Uncertain'].includes(e.geofence.status) || e.geofence.poorAccuracy).map(e => `${e.kind === 'in' ? 'Time in' : 'Time out'}: ${e.geofence.status}, accuracy ±${e.accuracy} m`);
  return { date: workDate, status, scheduledIn, scheduledOut, arrangement: schedule.arrangement, actualIn, actualOut, hours, late: graceLate ? 0 : late, graceLate, offsetUntil: graceLate && scheduledOut ? fromMinutes(hhmm(scheduledOut) + graceLate) : '', undertime, clockIn, clockOut, open: !!open, exceptions, needsApproval: !!record && !record.approved, breakNotice: record?.breaks.length ? 'Exact unpaid breaks deducted' : 'Before HR review of unpaid breaks', recordId: record?.id || null };
}
function validateAttachment(store, actor, id) { if (id) { const doc = getDocument(store, actor, id); if (doc.employeeId !== actor.employeeId || doc.uploadedBy !== actor.username || doc.type !== 'Leave Supporting' || doc.status !== 'Active') throw new AppError('Use your own active supporting document.', 403); } }
export function applyLeave(store, actor, input) {
  const employee = ownEmployee(store, actor);
  const value = z.object({ typeId: z.string().max(80), startDate: date, endDate: date, startTime: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]).default(''), endTime: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]).default(''), reason: note, documentId }).strict().refine(v => v.endDate >= v.startDate && Date.parse(v.endDate) - Date.parse(v.startDate) <= 366 * 86400000, 'Choose a valid leave range of at most 366 days.').parse(input);
  return store.transaction(() => {
    const state = store.read(), type = state.leaveTypes.find(t => t.id === value.typeId);
    ready(employee, value.startDate); ready(employee, value.endDate);
    if (!type || !employee.leaveEligibility.includes(type.id)) throw new AppError('This leave type is not enabled for your employee profile. Contact HR.');
    validateAttachment(store, actor, value.documentId);
    if (state.leaves.some(l => l.employeeId === employee.id && !['rejected', 'cancelled'].includes(l.status) && l.startDate <= value.endDate && l.endDate >= value.startDate)) throw new AppError('These dates overlap an existing leave request.');
    if (state.runs.some(r => r.start <= value.endDate && r.end >= value.startDate && r.rows.some(row => row.employeeId === employee.id))) throw new AppError('These dates belong to posted payroll.');
    const split = leaveSplit(employee, profileOf(state, employee.id, 'attendance'), ruleOn(state, value.startDate), type, value.startDate, value.endDate, value.startTime, value.endTime);
    if (split.invalidDate) throw new AppError(`The leave time on ${split.invalidDate} is outside your work schedule. Check the start and end times.`);
    const { countedDates, partialDates } = split;
    if (!countedDates.length) throw new AppError('Choose at least one eligible leave day.');
    const leave = { id: randomUUID(), employeeId: employee.id, typeId: type.id, startDate: value.startDate, endDate: value.endDate, startTime: value.startTime, endTime: value.endTime, reason: value.reason, days: split.days, countedDates, partialDates, documentReference: value.documentId, eligibilityVerified: false, status: 'pending', proofStatus: value.documentId ? 'submitted' : '', proofNote: '', proofReviewedBy: '', proofReviewedAt: '' };
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
// HR/Admin asks the employee for a supporting document (e.g. a medical certificate); until it is uploaded and
// confirmed the leave cannot be approved. Without this request an attachment is optional.
export function requestLeaveProof(store, actor, id, input) {
  permit(actor, ['admin', 'hr']);
  const value = z.object({ note: z.string().trim().min(3, 'Say which document is needed.').max(2000) }).strict().parse(input);
  return store.transaction(() => {
    const state = store.read(), leave = state.leaves.find(l => l.id === id);
    if (!leave) throw new AppError('Leave request not found.', 404);
    if (['cancelled', 'rejected'].includes(leave.status)) throw new AppError('This leave request is closed.');
    if (['required', 'submitted', 'verified'].includes(leave.proofStatus)) throw new AppError(leave.proofStatus === 'required' ? 'A supporting document was already asked for.' : 'A supporting document is already on file. Review it instead.');
    const before = structuredClone(leave);
    Object.assign(leave, { proofStatus: 'required', proofNote: value.note, proofReviewedBy: actor.username, proofReviewedAt: new Date().toISOString() });
    state.version++; store.write(state); store.log(actor, 'request-proof', 'leaves', id, before, leave);
    store.notify(leave.employeeId, `HR asks for a supporting document for your leave ${leave.startDate} → ${leave.endDate}: ${value.note}. Upload it in My leave.`);
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
    store.notify(null, `${employee.id} ${employee.name}: submitted an attendance explanation for ${value.date}. Review it in Attendance → Explanations.`);
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
    if (before.status === 'returned') throw new AppError('This explanation was sent back to the employee and is waiting for the employee to reply.');
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
// HR is not satisfied with an explanation: it goes back to the employee with HR's comment. The employee answers with a
// comment of their own, which puts it back in HR's review list. Every comment is kept on the explanation.
const comment = z.object({ comment: z.string().trim().min(3, 'Write a comment of at least 3 characters.').max(2000) }).strict();
const loadExplanation = (store, id) => { const row = store.db.prepare('SELECT data FROM attendance_explanations WHERE id=?').get(id); if (!row) throw new AppError('Explanation not found.', 404); return JSON.parse(row.data); };
export function returnExplanation(store, actor, id, input) {
  permit(actor, ['admin', 'hr']);
  const { comment: text } = comment.parse(input);
  return store.transaction(() => {
    const before = loadExplanation(store, id);
    if (before.status !== 'pending') throw new AppError('Only an explanation waiting for HR review can be sent back.');
    const after = { ...before, status: 'returned', comments: [...(before.comments || []), { side: 'hr', by: actor.username, text, at: new Date().toISOString() }] };
    store.db.prepare('UPDATE attendance_explanations SET data=? WHERE id=?').run(JSON.stringify(after), id);
    store.notify(before.employeeId, `HR sent back your attendance explanation for ${before.date}: "${text}". Open Attendance → Explanations to reply.`);
    store.log(actor, 'return', 'explanations', id, before, after); return after;
  });
}
export function replyExplanation(store, actor, id, input) {
  const employee = ownEmployee(store, actor);
  const { comment: text } = comment.parse(input);
  return store.transaction(() => {
    const before = loadExplanation(store, id);
    if (before.employeeId !== employee.id) throw new AppError('Explanation not found.', 404);
    if (before.status !== 'returned') throw new AppError('HR has not sent this explanation back to you.');
    const after = { ...before, status: 'pending', comments: [...(before.comments || []), { side: 'employee', by: actor.username, text, at: new Date().toISOString() }] };
    store.db.prepare('UPDATE attendance_explanations SET data=? WHERE id=?').run(JSON.stringify(after), id);
    store.notify(null, `${employee.id}: replied to HR on the attendance explanation for ${before.date}; it awaits review again.`);
    store.log(actor, 'reply', 'explanations', id, before, after); return after;
  });
}
// Time worked after the day's scheduled end, in whole 30-minute blocks (shown to the employee; pay still needs an approved filing).
function overtimeMinutes(state, employee, a) {
  if (a.status !== 'present' || !a.timeIn || !a.timeOut) return 0;
  const s = scheduleOn(employee, profileOf(state, employee.id, 'attendance'), a.date, ruleOn(state, a.date));
  if (s.flexible) return 0;
  const start = hhmm(s.start || a.scheduledIn || a.timeIn), end = s.end ? hhmm(s.end) + (hhmm(s.end) <= start ? 1440 : 0) : start + Math.round(s.hoursPerDay * 60) + (s.mealBreakMinutes ?? 60);
  const out = hhmm(a.timeOut) + (a.endNextDay || hhmm(a.timeOut) < hhmm(a.timeIn) ? 1440 : 0);
  return Math.floor(Math.max(0, out - end) / OT_BLOCK) * OT_BLOCK;
}
export function employeeDashboard(store, actor, now = new Date()) {
  const employee = ownEmployee(store, actor), state = store.read(), day = local(now).slice(0, 10);
  const at = manilaNow(now);
  announcePayslips(store, state, employee.id, at);
  const employment = profileOf(state, employee.id, 'employment'), leaves = state.leaves.filter(l => l.employeeId === employee.id);
  const balances = state.leaveTypes.filter(t => employee.leaveEligibility.includes(t.id)).map(type => {
    const balance = leaveBalance(state, employee, type, day), pending = leaves.filter(l => l.typeId === type.id && l.status === 'pending').reduce((sum, l) => sum + (l.countedDates || []).filter(d => d.startsWith(day.slice(0, 4))).reduce((n, d) => n + leaveFraction(l, d), 0), 0);
    return { typeId: type.id, name: type.name, documentsRequired: type.documentsRequired, perOccasion: !type.balanceRequired, maxDays: type.entitledDays, ...balance, pending, remaining: Math.max(0, balance.available - pending) };
  });
  const documents = store.db.prepare('SELECT metadata FROM employee_documents WHERE employee_id=?').all(employee.id).map(d => JSON.parse(d.metadata)).filter(d => d.uploadedBy === actor.username && d.type === 'Leave Supporting');
  // Greeting name: First Last from the 201 personal record (else the part after the comma, then the last name).
  const personal = JSON.parse(store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='personal'").get(employee.id)?.data ?? '{}'), [lastPart, restPart = ''] = employee.name.split(',').map(s => s.trim());
  const greetingName = [personal.firstName || restPart, personal.lastName || lastPart].filter(Boolean).join(' ');
  const calendar = { restDays: employee.restDays || [0], grace: graceFor(state, employee.id, day), holidays: state.holidays.filter(h => h.date.slice(0, 4) >= String(Number(day.slice(0, 4)) - 1) && h.kind !== 'ordinary').map(h => ({ date: h.date, name: h.name, kind: h.kind })) };
  return { calendar, employee: { id: employee.id, name: employee.name, greetingName, department: employee.department, position: employment.position || '', employmentStatus: employment.employmentStatus || '', employeeStatus: employment.employeeStatus || (employee.active ? 'Active' : 'Inactive'), scheduleStart: employee.scheduleStart, draft: employee.draft }, today: todayAttendance(store, employee, now), history: withPlace(store, rows(store, 'clock_events', employee.id)).slice(0, 200), attendance: state.attendance.filter(a => a.employeeId === employee.id && a.date >= `${Number(day.slice(0, 4)) - 1}-01-01`).map(a => ({ ...a, otMinutes: overtimeMinutes(state, employee, a) })), corrections: rows(store, 'attendance_corrections', employee.id).slice(0, 100), explanations: rows(store, 'attendance_explanations', employee.id), explanationsDue: explanationsDue(store, state, { employeeId: employee.id }), balances, leaves, documents,
    payslips: state.runs.filter(r => payslipReleased(r, at) && r.rows.some(row => row.employeeId === employee.id)).map(r => ({ id: r.id, start: r.start, end: r.end, payDate: payDateFor(r.start, r.end), net: r.rows.find(row => row.employeeId === employee.id).net })),
    upcomingPayslips: state.runs.filter(r => r.status === 'posted' && !payslipReleased(r, at) && r.rows.some(row => row.employeeId === employee.id)).map(r => ({ start: r.start, end: r.end, payDate: payDateFor(r.start, r.end) })),
    notifications: store.db.prepare('SELECT id,created_at AS at,message FROM notifications WHERE employee_id=? ORDER BY rowid DESC LIMIT 50').all(employee.id), serverTime: now.toISOString() };
}
export function liveDashboard(store, actor, now = new Date()) {
  permit(actor, ['admin', 'hr']);
  const state = store.read();
  // Only people who clock in: not drafts (incomplete or remittance-only profiles such as the CEO), not archived, not separated.
  // Inactive employees (resigned, separated, set inactive) are not listed.
  const day = local(now).slice(0, 10);
  const employees = state.employees.filter(e => !e.draft && !e.archived && e.active !== false && (!e.endDate || e.endDate >= day)).map(e => ({ employeeId: e.id, name: e.name, department: e.department || '', ...todayAttendance(store, e, now), reasons: reasonsFor(store, state, e.id, day) })).filter(e => e.status !== 'Inactive');
  const history = withPlace(store, store.db.prepare('SELECT data FROM clock_events ORDER BY rowid DESC LIMIT 200').all().map(r => JSON.parse(r.data)));
  const companies = (() => { try { return JSON.parse(store.db.prepare('SELECT data FROM hr_settings LIMIT 1').get()?.data || '{}').departments || []; } catch { return []; } })();
  return { companies, employees, history, notifications: store.db.prepare('SELECT id,created_at AS at,message FROM notifications WHERE employee_id IS NULL ORDER BY rowid DESC LIMIT 50').all(), serverTime: now.toISOString() };
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
  // A punch on the office Wi-Fi, or within the office radius, is shown with the office address (Settings -> Company).
  const event0 = JSON.parse(row.data), company = (() => { try { return JSON.parse(store.db.prepare('SELECT data FROM hr_settings LIMIT 1').get()?.data || '{}').company || {}; } catch { return {}; } })();
  if (company.officeAddress) {
    const near = company.officeLatitude !== null && company.officeLatitude !== undefined && event0.latitude !== null && distanceMeters(event0.latitude, event0.longitude, company.officeLatitude, company.officeLongitude) <= (company.officeRadius || 150);
    if (event0.onOfficeNetwork || event0.inOfficeArea || near) return { address: company.officeAddress, office: true, via: event0.onOfficeNetwork ? 'office Wi-Fi' : 'office location' };
  }
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
// One payslip builder for the employee portal, staff review and the draft preview, so they always agree.
export function designationOf(store, employeeId) {
  const row = store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='employment'").get(employeeId);
  return row ? JSON.parse(row.data).position || '' : '';
}
export function payslipFromRow(run, row, { designation = '' } = {}) {
  const loans = (row.loanDeductions || []).map(l => ({ type: l.type || run.sources?.loans?.find(source => source.id === l.loanId)?.type || 'Loan', reference: l.reference || '', amount: l.amount, previousBalance: l.previousBalance, remainingBalance: l.remainingBalance }));
  // Use the posted employee row only; never recompute historical payslips from current rates.
  const computation = (row.trace || []).map(({ component, side, amount, formula, date }) => ({ component, side, amount, formula, date }));
  const TYPED = { sssLoan: 'SSS Loan', pagibigLoan: 'Pag-IBIG Loan', salaryDeduction: 'Salary Loan' };
  const deductionItems = Object.entries(row.deductions).filter(([key]) => !['loans', 'other', ...Object.keys(TYPED)].includes(key)).map(([label, amount]) => ({ label, amount }));
  for (const loan of loans) deductionItems.push({ label: `${loan.type}${loan.reference ? ` (${loan.reference})` : ''}`, amount: loan.amount });
  for (const [key, label] of Object.entries(TYPED)) if (row.deductions[key]) deductionItems.push({ label, amount: row.deductions[key] });
  for (const type of ['Salary Loan', 'SSS Loan', 'Pag-IBIG Loan']) if (!loans.some(l => l.type === type) && !deductionItems.some(i => i.label === type)) deductionItems.push({ label: type, amount: 0 });
  const otherItems = computation.filter(t => t.side === 'deductions' && t.component === 'other');
  // An amount typed by HR in "Other deductions" is named by its reason (or "Other deductions"), never by the audit note.
  const otherLabel = f => { const m = String(f || '').match(/^Manual override by .*?→ [-\d.]+(?: \((.*)\))?$/); return m ? (m[1] || 'Other deductions') : f; };
  deductionItems.push(...otherItems.map(t => ({ label: otherLabel(t.formula), amount: t.amount })));
  const residual = (total, items) => Math.round((total - items.reduce((sum, item) => sum + item.amount, 0)) * 100) / 100;
  const loanRemainder = residual(row.deductions.loans || 0, loans), otherRemainder = residual(row.deductions.other || 0, otherItems);
  if (loanRemainder) deductionItems.push({ label: 'Other loan deductions (detail unavailable)', amount: loanRemainder });
  if (otherRemainder || !otherItems.length) deductionItems.push({ label: 'Other authorized deductions', amount: otherRemainder });
  const leaveDays = new Map();
  for (const note of row.leaveNotes || []) {
    const [d, ...rest] = note.split(': '), text = rest.join(': '), half = /\(half day/.test(text), name = text.replace(/\s*\(half day.*\)$/, '');
    const code = /\(([^)]+)\)/.exec(name)?.[1] || name.split(/\s+/).filter(w => /^[A-Z]/.test(w)).map(w => w[0]).join('');
    const label = `${new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}${half ? ' (half day)' : ''}`;
    leaveDays.set(code, [...(leaveDays.get(code) || []), label]);
  }
  const leaves = [...leaveDays].map(([code, days]) => `${code}: ${days.join(', ')}`).join('; ');
  // Paid leave days (from the leave pay lines) count as days credited: days worked + paid leave.
  const paidLeaveDays = (row.trace || []).filter(t => t.component === 'leavePay' && t.amount > 0).reduce((n, t) => n + (Number(/([\d.]+) day/.exec(t.formula)?.[1]) || 0), 0);
  const worked = Math.round(((row.creditedDays ?? row.daysPresent ?? 0) - (paidLeaveDays ? (row.leaveNotes || []).filter(n => /\(half day/.test(n)).length * 0.5 : 0)) * 10000) / 10000;
  const daysCredited = Math.round((worked + paidLeaveDays) * 10000) / 10000;
  return { leaves, paidLeaveDays, daysWorked: worked, daysCredited, draft: run.status !== 'posted', designation, payBasis: row.payBasis || 'monthly', workBreakdown: row.workBreakdown || [], contributionBasis: row.contributionBasis || null, id: run.id, start: run.start, end: run.end, postedAt: run.postedAt, employeeId: row.employeeId, employeeName: row.employeeName, monthlySalary: row.monthlySalary, dailyRate: row.dailyRate, hourlyRate: row.hourlyRate, workingDays: row.workingDays, daysPresent: row.daysPresent, creditedDays: row.creditedDays ?? row.daysPresent, leaveDays: row.leaveDays, earnings: row.earnings, deductions: row.deductions, deductionItems, computation, gross: row.gross, totalDeductions: row.totalDeductions, net: row.net, loans, employer: row.employer || null, employerTotal: row.employerTotal ?? 0 };
}
// At 9:00 AM on salary day the server releases finalized payslips and tells each employee once (bell notice).
export function announceDuePayslips(store, now = new Date()) {
  const state = store.read(), at = manilaNow(now), ids = new Set(state.runs.filter(r => payslipReleased(r, at)).flatMap(r => r.rows.map(row => row.employeeId)));
  for (const id of ids) announcePayslips(store, state, id, at);
}
// On salary day, tell the employee once that the payslip is now in their account.
function announcePayslips(store, state, employeeId, at) {
  for (const run of state.runs.filter(r => payslipReleased(r, at) && r.rows.some(row => row.employeeId === employeeId))) {
    const key = `payslip-notice:${run.id}:${employeeId}`;
    if (store.db.prepare('SELECT value FROM hr_counters WHERE key=?').get(key)) continue;
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run(key);
    store.notify(employeeId, `Your payslip for ${run.start} to ${run.end} is now available (salary day ${payDateFor(run.start, run.end)}).`);
  }
}
export function ownPayslip(store, actor, runId) {
  const employee = ownEmployee(store, actor), run = store.read().runs.find(r => r.id === runId && r.status === 'posted'), row = run?.rows.find(r => r.employeeId === employee.id);
  if (!row) throw new AppError('Payslip not found.', 404);
  if (!payslipReleased(run, manilaNow())) throw new AppError(`This payslip will be available on salary day, ${payDateFor(run.start, run.end)}, at 9:00 AM.`, 403);
  store.log(actor, 'view-payslip', 'payslip', run.id, null, { employeeId: employee.id });
  return payslipFromRow(run, row, { designation: designationOf(store, row.employeeId) });
}
// Admin/HR/Payroll review of any employee's posted payslip.
export function staffPayslip(store, actor, runId, employeeId) {
  permit(actor, ['admin', 'hr', 'payroll']);
  const run = store.read().runs.find(r => r.id === runId && r.status === 'posted'), row = run?.rows.find(r => r.employeeId === employeeId);
  if (!row) throw new AppError('Payslip not found.', 404);
  store.log(actor, 'view-payslip', 'payslip', run.id, null, { employeeId });
  return payslipFromRow(run, row, { designation: designationOf(store, row.employeeId) });
}
export function payslipPdf(payslip, { draft = payslip.draft } = {}) {
  return renderPayslipPdf(payslip, { draft, designation: payslip.designation });
}

// Out-of-office time in / out is recorded at once with its reason, time and location; it needs no approval.
// Decisions HR made before that rule (clock_reviews) are kept and shown with the record in the attendance history.
const ensureReviews = store => store.db.exec('CREATE TABLE IF NOT EXISTS clock_reviews(event_id TEXT PRIMARY KEY, data TEXT NOT NULL)');
export function outOfOfficeReview(store, eventId) { ensureReviews(store); const r = store.db.prepare('SELECT data FROM clock_reviews WHERE event_id=?').get(eventId); return r ? JSON.parse(r.data) : null; }

// One employee's time in / out records for a month (HR / Admin): out-of-office reason, recording time, GPS point and
// place, and any decision made under the earlier approval rule.
export function employeeClockEvents(store, actor, employeeId, month) {
  permit(actor, ['admin', 'hr']);
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new AppError('Choose a month.');
  const events = store.db.prepare('SELECT data FROM clock_events WHERE employee_id=? AND work_date LIKE ? ORDER BY rowid DESC').all(String(employeeId), `${month}-%`).map(r => JSON.parse(r.data));
  return withPlace(store, events).map(e => { const review = e.outOfOffice ? outOfOfficeReview(store, e.id) : null; return review ? { ...e, earlierDecision: review } : e; });
}

// Attendance → Explanations (HR / Admin): late arrivals still waiting for an explanation and every explanation.
export function explanationsOverview(store, actor) {
  permit(actor, ['admin', 'hr']);
  const state = store.read();
  return { due: explanationsDue(store, state), explanations: store.db.prepare('SELECT data FROM attendance_explanations ORDER BY rowid DESC LIMIT 500').all().map(r => JSON.parse(r.data)), names: Object.fromEntries(state.employees.map(e => [e.id, e.name])) };
}
