// Overtime filing. Employees may clock out before or after their schedule; staying late is not overtime by itself.
// Under the default policy ("separate" in Rules & rates) overtime is paid only when the employee files it and HR
// approves it, and never for more hours than attendance shows beyond the schedule. Unfiled extra time is not paid.
// Pending filings block posting so they are decided first. Every step is audited and notified.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { attendanceMinutes, scheduleOn, isRest, ruleOn, round } from './engine.mjs';
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
  const minutes = profile?.paidFrom === 'schedule' && !rest ? attendanceMinutes(record).filter(m => m >= scheduled) : attendanceMinutes(record);
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
  const daily = pay?.dailyRate ?? (employee.monthlySalary || 0) / rule.dailyDivisor, hourly = pay?.hourlyRate ?? daily / rule.hourlyDivisor;
  // Overtime minutes are counted from the end of the schedule, so a partial approval drops the latest (night) minutes first.
  const approvedNightHours = filing.status === 'approved' ? Math.max(0, round(filing.nightHours - Math.max(0, filing.hours - filing.approvedHours))) : 0;
  const hours = filing.status === 'approved' ? approvedNightHours : filing.nightHours;
  return { nightHours: filing.nightHours, approvedNightHours, nightRate: rule.nsd, nightPay: round(hours * hourly * rule.ordinaryOT * rule.nsd) };
}
const fileSchema = z.object({ date, startTime: time.optional(), endTime: time.optional(), hours: z.number().min(0.25).max(16).optional(), reason: z.string().trim().min(3, 'Say what the overtime work was for.').max(1000), employeeId: z.string().max(80).optional() }).strict();
// Employees file their own overtime; HR may record it for an employee (approved at once, e.g. no portal account).
export function fileOvertime(store, actor, input) {
  const parsed = fileSchema.parse(input), self = actor.role === 'employee';
  if (!!parsed.startTime !== !!parsed.endTime) throw new AppError('Enter both the overtime start and end time.');
  // Start and end given: hours are computed from them, never typed.
  const v = parsed.startTime ? { ...parsed, hours: hoursBetween(parsed.startTime, parsed.endTime) } : parsed;
  if (!v.hours) throw new AppError('Enter the overtime start and end time.');
  if (v.hours < 0.25 || v.hours > 16) throw new AppError('Overtime must be between 15 minutes and 16 hours.');
  if (!self) permit(actor, HR);
  const employeeId = self ? actor.employeeId : v.employeeId;
  if (!employeeId) throw new AppError('Choose the employee.');
  return store.transaction(() => {
    const state = store.read(), employee = state.employees.find(e => e.id === employeeId);
    if (!employee) throw new AppError('Employee not found.', 404);
    if (!employee.coveredOT) throw new AppError('This employee is not covered for overtime pay (exempt). Use an approved additional-pay entry instead.');
    if (v.date > addDays(localToday(), 31)) throw new AppError('Overtime can be filed at most 31 days in advance.');
    if (posted(state, employeeId, v.date)) throw new AppError('Payroll for that date is already posted. Contact HR or Payroll.');
    if (rowsOf(store, 'WHERE employee_id=? AND date=?', employeeId, v.date).some(o => ['pending', 'approved'].includes(o.status))) throw new AppError('Overtime is already filed for that date. Cancel it first to file again.');
    const now = new Date().toISOString();
    const value = { id: randomUUID(), employeeId, date: v.date, startTime: v.startTime || '', endTime: v.endTime || '', nightHours: v.startTime ? nightHoursBetween(v.startTime, v.endTime) : 0, hours: v.hours, reason: v.reason, filedBy: actor.username, filedAt: now, status: self ? 'pending' : 'approved', approvedHours: self ? 0 : v.hours, decidedBy: self ? '' : actor.username, decidedAt: self ? '' : now, remarks: self ? '' : 'Recorded by HR' };
    put(store, value);
    store.log(actor, 'file', 'overtime', employeeId, null, value);
    if (self) store.notify(null, `${employee.name} filed ${v.hours} h overtime for ${v.date}.`);
    else store.notify(employeeId, `HR recorded ${v.hours} h approved overtime for ${v.date}.`);
    return value;
  });
}
export function cancelOvertime(store, actor, id) {
  if (actor.role !== 'employee') throw new AppError('Only the employee can cancel their filing.', 403);
  return store.transaction(() => {
    const o = rowsOf(store, 'WHERE id=?', id)[0];
    if (!o || o.employeeId !== actor.employeeId) throw new AppError('Overtime filing not found.', 404);
    if (o.status !== 'pending') throw new AppError('Only pending filings can be cancelled. Ask HR to change a decided filing.');
    const after = { ...o, status: 'cancelled', decidedAt: new Date().toISOString(), decidedBy: actor.username };
    put(store, after); store.log(actor, 'cancel', 'overtime', o.employeeId, o, after);
    return after;
  });
}
const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']), hours: z.number().min(0.25).max(16).optional(), remarks: z.string().trim().max(500).default('') }).strict();
export function decideOvertime(store, actor, id, input) {
  permit(actor, HR);
  const v = decisionSchema.parse(input);
  if (v.decision === 'reject' && v.remarks.length < 3) throw new AppError('Give a reason for rejecting the overtime.');
  return store.transaction(() => {
    const o = rowsOf(store, 'WHERE id=?', id)[0];
    if (!o) throw new AppError('Overtime filing not found.', 404);
    if (!['pending', 'approved', 'rejected'].includes(o.status)) throw new AppError('This filing was cancelled.');
    if (posted(store.read(), o.employeeId, o.date)) throw new AppError('Payroll for that date is posted; the decision is locked. Reverse the payroll to correct it.');
    const hours = v.decision === 'approve' ? v.hours ?? o.hours : 0;
    if (hours > o.hours) throw new AppError(`Approved hours cannot exceed the ${o.hours} h filed.`);
    const after = { ...o, status: v.decision === 'approve' ? 'approved' : 'rejected', approvedHours: hours, remarks: v.remarks, decidedBy: actor.username, decidedAt: new Date().toISOString() };
    put(store, after); store.log(actor, v.decision, 'overtime', o.employeeId, o, after);
    store.notify(o.employeeId, `Your overtime for ${o.date} was ${v.decision === 'approve' ? `approved (${hours} h)` : 'not approved'}${v.remarks ? `: ${v.remarks}` : ''}.`);
    return after;
  });
}
export function myOvertime(store, actor) {
  if (actor.role !== 'employee') throw new AppError('Only employees have their own overtime filings.', 403);
  const state = store.read(), employee = state.employees.find(e => e.id === actor.employeeId);
  return rowsOf(store, 'WHERE employee_id=?', actor.employeeId).map(o => ({ ...o, ...nightEstimate(state, employee, o) }));
}
// HR / Payroll review list: each filing with the hours attendance actually shows beyond the schedule.
export function overtimeQueue(store, actor) {
  permit(actor, [...HR, 'payroll']);
  const state = store.read(), people = new Map(state.employees.map(e => [e.id, e]));
  return rowsOf(store).filter(o => o.status !== 'cancelled').slice(0, 300).map(o => {
    const e = people.get(o.employeeId), record = state.attendance.find(a => a.employeeId === o.employeeId && a.date === o.date);
    return { ...o, ...nightEstimate(state, e, o), name: e?.name || o.employeeId, worked: e && record ? overtimeHours(state, e, record) : null, attendanceApproved: !!record?.approved, locked: posted(state, o.employeeId, o.date) };
  }).sort((a, b) => (a.status === 'pending') === (b.status === 'pending') ? b.date.localeCompare(a.date) : a.status === 'pending' ? -1 : 1);
}
