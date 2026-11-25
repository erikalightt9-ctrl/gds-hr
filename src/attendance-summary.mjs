// My attendance analytics (Nov 25, 2026): one month of the employee's own attendance, built from the same day-by-day
// statuses HR's 201 Attendance history and the incomplete-attendance cases use (attendance-days.mjs dayStatuses), so
// the figures match HR's records:
// - working days so far: scheduled workdays (incl. work-from-home days and whole-day leave) that have been reached;
//   rest days, holidays and days before hiring / after separation are not counted;
// - present: days with a time in (incl. incomplete ones awaiting a correction) and work-from-home days;
// - absent: reached workdays with no time in / out, or recorded absent by HR; leave: approved whole-day leave
//   (half-day leave counts 0.5);
// - late: time in later than the schedule by the grace threshold or more (flexible time is never late), as payroll;
// - hours logged: time in to time out less recorded breaks or the scheduled meal break, exactly as payroll counts.
import { AppError } from './service.mjs';
import { dayStatuses } from './attendance-days.mjs';
import { ruleOn } from './engine.mjs';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const manilaToday = now => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const lastDay = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

export function attendanceSummary(store, employeeId, month, now = new Date()) {
  const state = store.read(), employee = state.employees.find(e => e.id === employeeId);
  if (!employee) throw new AppError('Employee not found.', 404);
  const today = manilaToday(now), chosen = MONTH.test(month || '') ? month : today.slice(0, 7);
  if (`${chosen}-01` > today) throw new AppError('Choose a month that has started.');
  const days = dayStatuses(store, state, employee, `${chosen}-01`, lastDay(chosen), now);
  const profile = (state.employeeProfiles || []).find(p => p.employeeId === employeeId && p.section === 'attendance') || {};
  const reached = d => d.date < today || (d.date === today && d.status && d.status !== 'open');
  const workday = d => ['workday', 'wfh', 'leave'].includes(d.kind);
  let workdays = 0, present = 0, absent = 0, leave = 0, late = 0, lateMinutes = 0, incomplete = 0;
  const bars = [], absences = [];
  for (const d of days) {
    const grace = profile.graceMinutes ?? (ruleOn(state, d.date) || state.rules[0])?.graceMinutes ?? 0;
    const worked = d.kind === 'wfh' || (d.timeIn && d.status !== 'absent');
    if (workday(d) && reached(d)) {
      workdays += 1;
      if (d.kind === 'leave') leave += 1;
      else if (worked) { present += 1; if (d.issue) incomplete += 1; }
      else if (d.issue === 'no-record' || d.absentByHr || d.status === 'absent') { absent += 1; absences.push({ date: d.date, byHr: !!d.absentByHr || d.status === 'absent' }); }
    }
    if (d.timeIn && !d.flexible && d.late > 0 && d.late >= grace && workday(d)) { late += 1; lateMinutes += d.late; }
    if (d.hoursWorked !== null && d.hoursWorked !== undefined) bars.push({ date: d.date, day: Number(d.date.slice(8)), weekday: WEEKDAY[new Date(`${d.date}T00:00:00Z`).getUTCDay()], hours: r2(d.hoursWorked), required: d.regularHours || 8, kind: d.kind });
  }
  // Half-day leave: the leave half counts as 0.5 leave on a day that is also present.
  const halfLeave = state.leaves.filter(l => l.employeeId === employeeId && l.status === 'approved').reduce((n, l) => n + (l.partialDates || []).filter(d => d.startsWith(chosen) && d <= today).length * 0.5, 0);
  const hours = r1(bars.reduce((n, b) => n + b.hours, 0));
  const leaves = state.leaves.filter(l => l.employeeId === employeeId && l.startDate <= lastDay(chosen) && l.endDate >= `${chosen}-01`)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map(l => ({ id: l.id, type: state.leaveTypes.find(t => t.id === l.typeId)?.name || l.typeId, startDate: l.startDate, endDate: l.endDate, days: l.days, status: l.status }));
  const lastEvent = store.db.prepare('SELECT data FROM clock_events WHERE employee_id=? AND work_date BETWEEN ? AND ? ORDER BY rowid DESC LIMIT 1').get(employeeId, `${chosen}-01`, lastDay(chosen));
  const lastAudit = store.db.prepare("SELECT at FROM audit WHERE kind='attendance' AND (after_json LIKE ? OR before_json LIKE ?) ORDER BY at DESC LIMIT 1").get(`%"employeeId":"${employeeId}"%`, `%"employeeId":"${employeeId}"%`);
  const updated = [lastEvent ? JSON.parse(lastEvent.data).recordedAt : null, lastAudit?.at || null].filter(Boolean).sort().at(-1) || null;
  const requiredHours = bars.length ? bars.map(b => b.required).sort((a, b) => bars.filter(x => x.required === b).length - bars.filter(x => x.required === a).length)[0] : profile.hoursPerDay || 8;
  const firstMonth = (employee.startDate || '').slice(0, 7);
  const months = [];
  for (let d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); months.length < 12; d.setUTCMonth(d.getUTCMonth() - 1)) { const m = d.toISOString().slice(0, 7); if (firstMonth && m < firstMonth) break; months.push(m); }
  return {
    month: chosen, today, months, requiredHours,
    workdays, present, absent, leave: r1(leave + halfLeave), incomplete,
    presentRate: workdays ? r1(present / workdays * 100) : null,
    late, lateMinutes, lateRate: present ? r1(late / present * 100) : null, onTimeRate: present ? r1((present - late) / present * 100) : null,
    hours, avgHours: bars.length ? r1(hours / bars.length) : null,
    bars, leaves, absences: absences.reverse(), lastUpdated: updated,
  };
}
export function myAttendanceSummary(store, actor, month, now = new Date()) {
  if (actor?.role !== 'employee' || !actor.employeeId) throw new AppError('Only employees have this page.', 403);
  return attendanceSummary(store, actor.employeeId, month, now);
}
