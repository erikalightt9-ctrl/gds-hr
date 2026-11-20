// One active-employee list for every module (Nov 20, 2026). Pages showed 19, 14, 12 or 11 because each counted with
// its own rule. Now:
//   records      every employee record that is not archived;
//   active       headcount: employment status Active / On Leave, not separated (end date passed), already started;
//   timekeeping  the active employees who time in and are paid through payroll: not draft profiles without pay yet,
//                not remittance-only (e.g. the CEO). Attendance and payroll lists use this; they say who is left out.
import { localToday } from './profiles.mjs';
import { activity } from './hr201.mjs';
import { remittanceOnlyIds } from './remittance-only.mjs';

const employmentOf = (state, id) => (state.employeeProfiles || []).find(p => p.employeeId === id && p.section === 'employment') || {};
export const isActive = (state, e, day = localToday()) => !e.archived && activity(e, employmentOf(state, e.id)) === 'Active' && (!e.endDate || e.endDate >= day) && (!e.startDate || e.startDate <= day);

export function workforce(store, day = localToday(), state = store.read()) {
  const remit = remittanceOnlyIds(store), records = state.employees.filter(e => !e.archived);
  const active = records.filter(e => isActive(state, e, day)), timekeeping = active.filter(e => !e.draft && !remit.has(e.id));
  const keep = new Set(timekeeping.map(e => e.id));
  return {
    asOf: day, records: records.length, active: active.length, inactive: records.length - active.length, timekeeping: timekeeping.length,
    activeIds: active.map(e => e.id), timekeepingIds: [...keep],
    notTimekeeping: active.filter(e => !keep.has(e.id)).map(e => ({ id: e.id, name: e.name, why: remit.has(e.id) ? 'remittance only (not paid through payroll)' : 'draft profile: pay not set up yet' })),
  };
}
