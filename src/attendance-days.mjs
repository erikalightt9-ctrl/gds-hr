// Day-by-day attendance of one employee (Nov 20, 2026): every date of the period, in order, with what kind of day it
// is (workday, rest day, holiday, approved leave, work from home, official business), the recorded attendance and
// time in / out events (off-site reasons and places included), and any gap: missing time-in, missing time-out, or no
// record ("Attendance for verification"). Used by the 201 Attendance history and the incomplete-attendance cases.
// Nothing here assumes an absence or substitutes a scheduled time: it only reports what is recorded.
import { dates, isRest, scheduleOn, ruleOn } from './engine.mjs';

export const ISSUE_LABELS = { 'missing-in': 'Missing Time-In', 'missing-out': 'Missing Time-Out', 'no-record': 'No Time-In / Time-Out' };
// A day with time records that HR has not approved yet (shown, not a case).
export const VERIFY_LABEL = 'Attendance for Verification';
export const GRACE_HOURS = 4;   // a time out is "missing" only this long after the end of the shift
const manila = now => new Date(now.getTime() + 8 * 3600000).toISOString();   // 'YYYY-MM-DDTHH:mm...' in Manila
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const hm = t => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const profileOf = (state, id) => (state.employeeProfiles || []).find(p => p.employeeId === id && p.section === 'attendance') || {};

// When the shift of a date has ended plus the grace period (overnight shifts end the next day), as a Manila timestamp.
function shiftOver(employee, profile, date, rule, nowLocal) {
  const s = scheduleOn(employee, profile, date, rule), start = hm(s.start || '09:00');
  let end = s.end ? hm(s.end) : start + Math.round((s.hoursPerDay || 8) * 60) + (s.mealBreakMinutes || 0);
  if (end <= start) end += 1440;
  const at = end + GRACE_HOURS * 60, day = addDays(date, Math.floor(at / 1440)), min = at % 1440;
  return nowLocal >= `${day}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function dayStatuses(store, state, employee, from, to, now = new Date()) {
  const nowLocal = manila(now), today = nowLocal.slice(0, 10), profile = profileOf(state, employee.id);
  const events = store.db.prepare('SELECT kind, work_date, data FROM clock_events WHERE employee_id=? AND work_date BETWEEN ? AND ? ORDER BY rowid').all(employee.id, from, to)
    .map(r => ({ kind: r.kind, date: r.work_date, ...JSON.parse(r.data) }));
  return dates(from, to).map(date => {
    const rule = ruleOn(state, date) || state.rules[0], sched = scheduleOn(employee, profile, date, rule);
    const employed = (!employee.startDate || date >= employee.startDate) && (!employee.endDate || date <= employee.endDate);
    const holiday = state.holidays.find(h => h.date === date && h.kind !== 'ordinary');
    const leave = state.leaves.find(l => l.employeeId === employee.id && l.status === 'approved' && ((l.countedDates || []).includes(date) || (!l.countedDates && l.startDate <= date && l.endDate >= date)));
    const leaveType = leave ? state.leaveTypes.find(t => t.id === leave.typeId)?.name || 'Leave' : '';
    const halfLeave = !!leave && (leave.partialDates || []).includes(date);
    const record = state.attendance.find(a => a.employeeId === employee.id && a.date === date) || null;
    const dayEvents = events.filter(e => e.date === date);
    const open = (state.openClockIns || []).find(c => c.employeeId === employee.id && c.workDate === date) || null;
    const rest = isRest(employee, date);
    const kind = !employed ? 'not-employed' : rest ? 'rest' : holiday ? 'holiday' : leave && !halfLeave ? 'leave' : sched.autoPresent ? 'wfh' : 'workday';
    const label = { 'not-employed': 'Not employed', rest: 'Rest day', holiday: `${holiday?.name || 'Holiday'} (${holiday?.kind === 'regular' || holiday?.kind === 'double' ? 'regular holiday' : 'special day'})`, leave: leaveType, wfh: 'Work from home', workday: 'Workday' }[kind] + (halfLeave ? ` · ${leaveType} (half day)` : '');
    const timeIn = record?.timeIn || open?.time || dayEvents.find(e => e.kind === 'in')?.time || '';
    const timeOut = record?.timeOut || (record ? '' : dayEvents.filter(e => e.kind === 'out').at(-1)?.time || '');
    const late = record?.status === 'present' && timeIn && hm(record.scheduledIn) !== null ? Math.max(0, hm(timeIn) - hm(record.scheduledIn)) : open && sched.start ? Math.max(0, hm(open.time) - hm(sched.start)) : 0;
    // Gaps, only for dates already reached (a shift in progress is not missing anything yet).
    let issue = null;
    const reached = date < today || (date === today && shiftOver(employee, profile, date, rule, nowLocal));
    if (employed && reached) {
      if (record) {
        if (record.status === 'present' && record.timeIn && !record.timeOut) issue = 'missing-out';
        else if (record.status === 'present' && !record.timeIn && record.timeOut) issue = 'missing-in';
      } else if (open) { if (shiftOver(employee, profile, date, rule, nowLocal)) issue = 'missing-out'; }
      else if (dayEvents.some(e => e.kind === 'out')) issue = 'missing-in';
      else if (kind === 'workday') issue = 'no-record';   // rest days, holidays, whole-day leave and WFH days need no record
    }
    const offsite = dayEvents.filter(e => e.outOfOffice || e.attendanceType === 'offsite' || e.mode === 'outside').map(e => ({ kind: e.kind, time: e.time, reason: e.reason || '', place: e.address || e.place || '', latitude: e.latitude ?? null, longitude: e.longitude ?? null }));
    return { date, kind, label, scheduled: { start: sched.start || '', end: sched.end || '', flexible: !!sched.flexible }, status: record?.status || (open ? 'open' : ''), timeIn, timeOut, endNextDay: !!record?.endNextDay, late, approved: !!record?.approved, explanation: /^Employee clock events:/.test(record?.explanation || '') ? '' : record?.explanation || '', offsite, issue, issueLabel: issue ? ISSUE_LABELS[issue] : '' };
  });
}
