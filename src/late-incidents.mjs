// Late incidents: arriving late by the grace period (15 minutes) or more. Lateness made up by staying after the
// scheduled end is not deducted, but it still counts here. From the 3rd incident in a calendar month the employee is
// asked to file an explanation letter.
import { ruleOn } from './engine.mjs';

export const LETTER_AFTER = 3;
const minutes = hm => { const [h, m] = String(hm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };

export function graceFor(state, employeeId, day) {
  const profile = (state.employeeProfiles || []).find(p => p.employeeId === employeeId && p.section === 'attendance');
  return profile?.graceMinutes ?? ruleOn(state, day)?.graceMinutes ?? 15;
}
// Minutes late for a time in against the scheduled start (0 when on time or either time is missing).
export const lateBy = (timeIn, scheduledIn) => { const a = minutes(timeIn), s = minutes(scheduledIn); return a === null || s === null ? 0 : Math.max(0, a - s); };

// Late incidents in a month ("YYYY-MM") from recorded attendance, oldest first.
export function lateIncidents(state, employeeId, month) {
  const grace = graceFor(state, employeeId, `${month}-01`);
  return state.attendance
    .filter(a => a.employeeId === employeeId && a.status === 'present' && a.date.startsWith(month) && !a.exception)
    .map(a => ({ date: a.date, minutes: lateBy(a.timeIn, a.scheduledIn) }))
    .filter(x => grace > 0 && x.minutes >= grace)
    .sort((a, b) => a.date.localeCompare(b.date));
}
export const letterMessage = (count, month) => `You have been late 15 minutes or more ${count} times in ${new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}. Please file an explanation letter with HR.`;
