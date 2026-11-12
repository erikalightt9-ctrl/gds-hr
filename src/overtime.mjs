// Overtime filing. Employees may clock out before or after their schedule; staying late is not overtime by itself.
// Under the default policy ("separate" in Rules & rates) overtime is paid only when the employee files it and HR
// approves it, and never for more hours than attendance shows beyond the schedule. Unfiled extra time is not paid.
// Pending filings block posting so they are decided first. Every step is audited and notified.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { attendanceMinutes, withScheduledLunch, scheduleOn, isRest, ruleOn, round, overtimeWindow, OT_BLOCK } from './engine.mjs';
import { localToday } from './profiles.mjs';

const HR = ['admin', 'hr'];
const stamp = value => Date.parse(`${value}:00Z`);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

// Hours worked beyond the scheduled day, counted the same way payroll counts them.
export function overtimeHours(state, employee, record, rule = ruleOn(state, record.date) || state.rules[0]) {
  if (!record || record.status !== 'present' || !rule) return 0;
  const profile = state.employeeProfiles?.find(p => p.employeeId === employee.id && p.section === 'attendance');
  const rest = isRest(employee, record.date), normalHours = scheduleOn(employee, profile, record.date, rule).hoursPerDay;
  const scheduled = stamp(`${record.date}T${record.scheduledIn}`);
  const worked = attendanceMinutes(withScheduledLunch(record, scheduleOn(employee, profile, record.date, rule), profile, rest));
  const minutes = profile?.paidFrom === 'schedule' && !rest ? worked.filter(m => m >= scheduled) : worked;
  return round(Math.max(0, minutes.length - normalHours * 60) / 60);
}
const rowsOf = (store, where = '', ...args) => store.db.prepare(`SELECT data FROM overtime_requests ${where} ORDER BY rowid DESC`).all(...args).map(r => JSON.parse(r.data));
const posted = (state, employeeId, day) => state.runs.some(r => r.status === 'posted' && r.start <= day && r.end >= day && r.rows.some(row => row.employeeId === employeeId));
function put(store, value) {
  store.db.prepare('INSERT INTO overtime_requests(id,employee_id,date,status,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(value.id, value.employeeId, value.date, value.status, JSON.stringify(value));
}

// Hours between an overtime start and end time; an end at or before the start means the next day.
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export function hoursBetween(start, end) {
  const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  let minutes = toMin(end) - toMin(start); if (minutes <= 0) minutes += 1440;
  return round(minutes / 60);
}
// Minutes of a start-end span that fall in the night shift (10:00 PM to 6:00 AM, Labor Code Art. 86).
export function nightHoursBetween(start, end) {
  const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const s = toMin(start); let e = toMin(end); if (e <= s) e += 1440;
  let night = 0;
  for (let m = s; m < e; m++) { const h = Math.floor((m % 1440) / 60); if (h >= 22 || h < 6) night++; }
  return round(night / 60);
}
// Estimated pay for the night hours of approved overtime: hourly rate × overtime rate × night differential rate.
// The payroll computation is final; it counts only hours actually worked beyond the schedule.
function nightEstimate(state, employee, filing) {
  const rule = ruleOn(state, filing.date) || state.rules[0];
  if (!rule || !employee?.coveredNSD || !filing.nightHours) return { nightHours: filing.nightHours || 0, approvedNightHours: 0, nightPay: 0 };
  const pay = state.employeeProfiles?.find(p => p.employeeId === employee.id && p.section === 'payroll');
  const sched = state.employeeProfiles?.find(p => p.employeeId === employee.id && p.section === 'attendance');
  const daily = pay?.dailyRate ?? (employee.monthlySalary || 0) / rule.dailyDivisor, hourly = pay?.hourlyRate ?? daily / (sched?.hoursPerDay || rule.hourlyDivisor);   // 12-hour drivers: ÷ 12
  // Overtime minutes are counted from the end of the schedule, so a partial approval drops the latest (night) minutes first.
  const approvedNightHours = filing.status === 'approved' ? Math.max(0, round(filing.nightHours - Math.max(0, filing.hours - filing.approvedHours))) : 0;
  const hours = filing.status === 'approved' ? approvedNightHours : filing.nightHours;
  return { nightHours: filing.nightHours, approvedNightHours, nightRate: rule.nsd, nightPay: round(hours * hourly * rule.ordinaryOT * rule.nsd) };
}
const fileSchema = z.object({ date, startTime: time.optional(), endTime: time.optional(), breakMinutes: z.number().int().min(0).max(480).default(0), hours: z.number().min(0.25).max(16).optional(), reason: z.string().trim().min(3, 'Say what the overtime work was for.').max(1000), documentId: z.string().max(80).default(''), employeeId: z.string().max(80).optional() }).strict();
// Start and end given: hours are the period less unpaid breaks, never typed. Older callers may send hours only.
function requested(parsed) {
  if (!!parsed.startTime !== !!parsed.endTime) throw new AppError('Enter both the overtime start and end time.');
  if (parsed.startTime && parsed.breakMinutes >= Math.round(hoursBetween(parsed.startTime, parsed.endTime) * 60)) throw new AppError('The unpaid break must be shorter than the overtime period.');
  const v = parsed.startTime ? { ...parsed, hours: round(hoursBetween(parsed.startTime, parsed.endTime) - parsed.breakMinutes / 60) } : { ...parsed, breakMinutes: 0 };
  if (!v.hours) throw new AppError('Enter the overtime start and end time.');
  if (v.hours < 0.25 || v.hours > 16) throw new AppError('Overtime must be between 15 minutes and 16 hours.');
  return v;
}
// A supporting attachment must be the employee's own active document (uploaded from their portal).
function checkAttachment(store, employeeId, documentId) {
  if (!documentId) return;
  const doc = JSON.parse(store.db.prepare('SELECT metadata FROM employee_documents WHERE id=?').get(documentId)?.metadata || 'null');
  if (!doc || doc.employeeId !== employeeId || doc.status !== 'Active') throw new AppError('Attach one of your own active documents.', 403);
}
const describe = o => (o.startTime ? `${o.date} ${o.startTime}–${o.endTime}${o.endTime <= o.startTime ? ' (next day)' : ''}` : o.date);
// One employee may not have two pending / approved filings covering the same time (so nothing is paid twice).
function assertNoOverlap(store, employeeId, value, ignoreId = '') {
  const [s, e] = overtimeWindow(value);
  const clash = rowsOf(store, 'WHERE employee_id=? AND date BETWEEN ? AND ?', employeeId, addDays(value.date, -1), addDays(value.date, 1))
    .filter(o => o.id !== ignoreId && ['pending', 'approved'].includes(o.status)).find(o => { const [os, oe] = overtimeWindow(o); return s < oe && os < e; });
  if (clash) throw new AppError(`Overtime is already filed for an overlapping time (${describe(clash)}, ${clash.status}). Edit or cancel that application instead.`);
}
const historyEntry = (actor, action, note = '') => ({ at: new Date().toISOString(), by: actor.username, action, note });
// Employees file their own overtime; HR may record it for an employee (approved at once, e.g. no portal account).
export function fileOvertime(store, actor, input) {
  const self = actor.role === 'employee', v = requested(fileSchema.parse(input));
  if (!self) permit(actor, HR);
  const employeeId = self ? actor.employeeId : v.employeeId;
  if (!employeeId) throw new AppError('Choose the employee.');
  return store.transaction(() => {
    const state = store.read(), employee = state.employees.find(e => e.id === employeeId);
    if (!employee) throw new AppError('Employee not found.', 404);
    if (!employee.coveredOT) throw new AppError('This employee is not covered for overtime pay (exempt). Use an approved additional-pay entry instead.');
    if (v.date > addDays(localToday(), 31)) throw new AppError('Overtime can be filed at most 31 days in advance.');
    if (posted(state, employeeId, v.date)) throw new AppError('Payroll for that date is already posted. Contact HR or Payroll.');
    if (self) checkAttachment(store, employeeId, v.documentId);
    const now = new Date().toISOString();
    const value = { id: randomUUID(), employeeId, date: v.date, startTime: v.startTime || '', endTime: v.endTime || '', breakMinutes: v.breakMinutes, nightHours: v.startTime ? Math.min(v.hours, nightHoursBetween(v.startTime, v.endTime)) : 0, hours: v.hours, reason: v.reason, documentId: self ? v.documentId : '', filedBy: actor.username, filedAt: now, status: self ? 'pending' : 'approved', approvedHours: self ? 0 : v.hours, adjustReason: '', decidedBy: self ? '' : actor.username, decidedAt: self ? '' : now, remarks: self ? '' : 'Recorded by HR', history: [historyEntry(actor, self ? 'submitted' : 'recorded and approved by HR')] };
    assertNoOverlap(store, employeeId, value);
    put(store, value);
    store.log(actor, 'file', 'overtime', employeeId, null, value);
    if (self) store.notify(null, `${employee.name} filed ${v.hours} h overtime for ${describe(value)}. Review it in Attendance → Overtime applications.`);
    else store.notify(employeeId, `HR recorded ${v.hours} h approved overtime for ${v.date}.`);
    return value;
  });
}
// The employee may change a pending application (period, break, reason, attachment); every change is kept.
export function editOvertime(store, actor, id, input) {
  if (actor.role !== 'employee') throw new AppError('Only the employee can edit their application.', 403);
  const v = requested(fileSchema.omit({ employeeId: true }).parse(input));
  return store.transaction(() => {
    const o = rowsOf(store, 'WHERE id=?', id)[0], state = store.read();
    if (!o || o.employeeId !== actor.employeeId) throw new AppError('Overtime application not found.', 404);
    if (o.status !== 'pending') throw new AppError('Only pending applications can be edited. Ask HR to change a decided application.');
    if (v.date > addDays(localToday(), 31)) throw new AppError('Overtime can be filed at most 31 days in advance.');
    if (posted(state, o.employeeId, v.date)) throw new AppError('Payroll for that date is already posted. Contact HR or Payroll.');
    checkAttachment(store, o.employeeId, v.documentId);
    const changed = { date: v.date, startTime: v.startTime || '', endTime: v.endTime || '', breakMinutes: v.breakMinutes, hours: v.hours, nightHours: v.startTime ? Math.min(v.hours, nightHoursBetween(v.startTime, v.endTime)) : 0, reason: v.reason, documentId: v.documentId };
    const note = `was ${describe(o)}, ${o.hours} h`;
    const after = { ...o, ...changed, history: [...(o.history || []), historyEntry(actor, 'edited', note)] };
    assertNoOverlap(store, o.employeeId, after, o.id);
    if (after.date !== o.date) store.db.prepare('UPDATE overtime_requests SET date=? WHERE id=?').run(after.date, o.id);
    put(store, after); store.log(actor, 'edit', 'overtime', o.employeeId, o, after);
    const employee = state.employees.find(e => e.id === o.employeeId);
    store.notify(null, `${employee?.name || o.employeeId} changed their overtime application: now ${describe(after)} (${after.hours} h).`);
    return after;
  });
}
export function cancelOvertime(store, actor, id) {
  if (actor.role !== 'employee') throw new AppError('Only the employee can cancel their filing.', 403);
  return store.transaction(() => {
    const o = rowsOf(store, 'WHERE id=?', id)[0];
    if (!o || o.employeeId !== actor.employeeId) throw new AppError('Overtime filing not found.', 404);
    if (o.status !== 'pending') throw new AppError('Only pending filings can be cancelled. Ask HR to change a decided filing.');
    const after = { ...o, status: 'cancelled', decidedAt: new Date().toISOString(), decidedBy: actor.username, history: [...(o.history || []), historyEntry(actor, 'cancelled')] };
    put(store, after); store.log(actor, 'cancel', 'overtime', o.employeeId, o, after);
    return after;
  });
}
const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']), hours: z.number().min(0.25).max(16).optional(), remarks: z.string().trim().max(500).default(''), adjustReason: z.string().trim().max(500).default('') }).strict();
export function decideOvertime(store, actor, id, input) {
  permit(actor, HR);
  const v = decisionSchema.parse(input);
  if (v.decision === 'reject' && v.remarks.length < 3) throw new AppError('Give a reason for rejecting the overtime.');
  return store.transaction(() => {
    const o = rowsOf(store, 'WHERE id=?', id)[0];
    if (!o) throw new AppError('Overtime filing not found.', 404);
    if (!['pending', 'approved', 'rejected'].includes(o.status)) throw new AppError('This filing was cancelled.');
    if (posted(store.read(), o.employeeId, o.date)) throw new AppError('Payroll for that date is posted; the decision is locked. Reverse the payroll to correct it.');
    const hours = v.decision === 'approve' ? round(v.hours ?? o.hours) : 0;
    if (hours > o.hours) throw new AppError(`Approved hours cannot exceed the ${o.hours} h filed.`);
    // Approving other hours than filed is an adjustment and needs its own reason.
    const adjusted = v.decision === 'approve' && hours !== o.hours;
    if (adjusted && v.adjustReason.length < 3) throw new AppError(`Give the reason for approving ${hours} h instead of the ${o.hours} h filed.`);
    const note = v.decision === 'approve' ? `${hours} h${adjusted ? ` of ${o.hours} h filed: ${v.adjustReason}` : ''}${v.remarks ? ` · ${v.remarks}` : ''}` : v.remarks;
    const after = { ...o, status: v.decision === 'approve' ? 'approved' : 'rejected', approvedHours: hours, adjustReason: adjusted ? v.adjustReason : '', remarks: v.remarks, decidedBy: actor.username, decidedAt: new Date().toISOString(), history: [...(o.history || []), historyEntry(actor, v.decision === 'approve' ? 'approved' : 'rejected', note)] };
    put(store, after); store.log(actor, v.decision, 'overtime', o.employeeId, o, after);
    store.notify(o.employeeId, `Your overtime for ${o.date} was ${v.decision === 'approve' ? `approved (${hours} h${adjusted ? ` of ${o.hours} h filed: ${v.adjustReason}` : ''})` : 'not approved'}${v.remarks ? `: ${v.remarks}` : ''}.`);
    return after;
  });
}
export function myOvertime(store, actor) {
  if (actor.role !== 'employee') throw new AppError('Only employees have their own overtime filings.', 403);
  const state = store.read(), employee = state.employees.find(e => e.id === actor.employeeId);
  return rowsOf(store, 'WHERE employee_id=?', actor.employeeId).map(o => ({ ...o, ...nightEstimate(state, employee, o) }));
}
// Attendance against one filing, counted the way payroll counts it: minutes after the scheduled day that fall inside
// the filed period (unpaid attendance breaks excluded), paid in whole 30-minute blocks up to the approved hours.
export function overtimeCheck(state, employee, o, today = localToday()) {
  const record = state.attendance.find(a => a.employeeId === o.employeeId && a.date === o.date && a.status === 'present');
  const target = o.status === 'approved' ? o.approvedHours : o.hours, flags = [];
  if (!record) {
    if (o.date <= today && ['pending', 'approved'].includes(o.status)) flags.push('No attendance recorded for this date');
    return { workedInPeriod: 0, payableHours: 0, flags };
  }
  const rule = ruleOn(state, o.date) || state.rules[0], profile = state.employeeProfiles?.find(p => p.employeeId === employee.id && p.section === 'attendance');
  const sched = scheduleOn(employee, profile, o.date, rule), rest = isRest(employee, o.date), scheduled = stamp(`${o.date}T${record.scheduledIn}`);
  const worked = attendanceMinutes(withScheduledLunch(record, sched, profile, rest));
  const minutes = profile?.paidFrom === 'schedule' && !rest ? worked.filter(m => m >= scheduled) : worked;
  const [s, e] = overtimeWindow(o);
  const inPeriod = sched.flexible ? 0 : minutes.filter((m, i) => i >= sched.hoursPerDay * 60 && m >= s && m < e).length;
  const workedInPeriod = round(inPeriod / 60), payableHours = round(Math.floor(Math.min(inPeriod, Math.round(target * 60)) / OT_BLOCK) * OT_BLOCK / 60);
  if (!record.approved) flags.push('Attendance not approved yet');
  if (['pending', 'approved'].includes(o.status) && target - workedInPeriod >= OT_BLOCK / 60) flags.push(`Worked ${workedInPeriod} h within the period, ${round(target - workedInPeriod)} h less than ${o.status === 'approved' ? 'approved' : 'filed'}`);
  return { workedInPeriod, payableHours, flags };
}
// HR / Payroll review list: every application (cancelled ones too, for the history) with attendance compared.
export function overtimeQueue(store, actor) {
  permit(actor, [...HR, 'payroll']);
  const state = store.read(), people = new Map(state.employees.map(e => [e.id, e]));
  return rowsOf(store).slice(0, 500).map(o => {
    const e = people.get(o.employeeId), record = state.attendance.find(a => a.employeeId === o.employeeId && a.date === o.date);
    return { ...o, ...nightEstimate(state, e, o), ...(e ? overtimeCheck(state, e, o) : { workedInPeriod: 0, payableHours: 0, flags: [] }), name: e?.name || o.employeeId, worked: e && record ? overtimeHours(state, e, record) : null, attendanceApproved: !!record?.approved, locked: posted(state, o.employeeId, o.date) };
  }).sort((a, b) => (a.status === 'pending') === (b.status === 'pending') ? b.date.localeCompare(a.date) : a.status === 'pending' ? -1 : 1);
}
