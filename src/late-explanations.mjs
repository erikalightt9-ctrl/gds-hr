// Late arrival explanations: every time in 15 minutes or more after the start of the employee's schedule for that
// day needs a written explanation. The list of what is still due is worked out from the attendance itself (recorded
// days and today's open time in), so a day can never be asked for twice, and lateness under 15 minutes is never asked
// for. A day counts as explained once the employee has submitted an explanation for it, whatever HR decided.
// Payroll and lateness deductions do not use this list.
import { scheduleOn, ruleOn } from './engine.mjs';
import { lateBy } from './late-incidents.mjs';

export const EXPLAIN_AFTER_MINUTES = 15;
// Attendance before this date was imported from the biometric records (January-August 2026, before the system):
// it never asks for an explanation. The records, any explanations already submitted and payroll are unchanged.
export const EXPLAIN_FROM = '2026-09-01';
const profileOf = (state, id) => (state.employeeProfiles || []).find(p => p.employeeId === id && p.section === 'attendance') || {};
const explainedDays = store => new Set(store.db.prepare('SELECT employee_id, data FROM attendance_explanations').all().map(r => `${r.employee_id}|${JSON.parse(r.data).date}`));

// Lateness against the schedule that applied on that date (a record keeps the start it was recorded against).
function lateOn(state, employee, date, timeIn, recordedStart) {
  const schedule = scheduleOn(employee, profileOf(state, employee.id), date, ruleOn(state, date));
  if (schedule.flexible) return null;
  const start = recordedStart || schedule.start;
  return start ? { scheduledIn: start, lateMinutes: lateBy(timeIn, start) } : null;
}

export function explanationsDue(store, state = store.read(), { employeeId = null } = {}) {
  const explained = explainedDays(store), people = new Map(state.employees.map(e => [e.id, e])), due = new Map();
  const consider = (employee, date, timeIn, recordedStart, source) => {
    if (!employee || date < EXPLAIN_FROM || (employeeId && employee.id !== employeeId) || !timeIn || explained.has(`${employee.id}|${date}`)) return;
    const late = lateOn(state, employee, date, timeIn, recordedStart);
    if (!late || late.lateMinutes < EXPLAIN_AFTER_MINUTES) return;
    due.set(`${employee.id}|${date}`, { employeeId: employee.id, employeeName: employee.name, date, scheduledIn: late.scheduledIn, timeIn, lateMinutes: late.lateMinutes, source });
  };
  for (const a of state.attendance) if (a.status === 'present' && !a.exception) consider(people.get(a.employeeId), a.date, a.timeIn, a.scheduledIn, 'attendance');
  // Today's time in before the time out creates the attendance record.
  for (const o of state.openClockIns || []) if (!due.has(`${o.employeeId}|${o.workDate}`) && !state.attendance.some(a => a.employeeId === o.employeeId && a.date === o.workDate)) consider(people.get(o.employeeId), o.workDate, o.time, '', 'time-in');
  return [...due.values()].sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
}
