// Overtime carryover (Nov 20, 2026). A cutoff can be posted while overtime is still waiting: pending filings stay
// "Pending Overtime" and move forward with each cutoff until HR decides (overtime nobody filed is not recorded). Once HR approves, the next payroll pays it at the rates of the original date (holiday, rest
// day, night) and rules, keeping the original date, hours, reason and history. Posting marks every filing it paid as
// Paid (paidRunId), so nothing is paid twice; reversing that payroll clears the mark.
import { payDateFor } from './paydays.mjs';
import { round } from './engine.mjs';

// Earnings an overtime filing can change (overtime, premiums, night differential).
export const CARRY_COMPONENTS = ['regularOT', 'restDay', 'restOT', 'nsd', 'specialHoliday', 'specialOT', 'regularHoliday', 'regularHolidayOT', 'otherHoliday', 'otherOT'];
const cutoffOf = (date, rule) => {
  const month = date.slice(0, 7), last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  if ((rule?.cutoff || 'semi-monthly') === 'monthly') return [`${month}-01`, last];
  return date.slice(8) <= '15' ? [`${month}-01`, `${month}-15`] : [`${month}-16`, last];
};
const postedRun = (state, employeeId, day) => state.runs.find(r => r.status === 'posted' && r.start <= day && r.end >= day && r.rows.some(row => row.employeeId === employeeId));
const alreadyCarried = (state, id) => state.runs.some(r => r.status === 'posted' && r.rows.some(row => (row.carriedOvertime || []).some(c => c.id === id)));

// Approved filings of an employee that belong to an earlier, already posted cutoff and were never paid: approved after
// that cutoff was posted (so it could not include them) and not carried into any posted payroll since.
export function carryableFilings(state, employee, start) {
  return (state.overtimeRequests || []).filter(o => {
    if (o.employeeId !== employee.id || o.status !== 'approved' || o.paidRunId || o.date >= start) return false;
    const run = postedRun(state, employee.id, o.date);
    return !!run && String(o.decidedAt || '') >= String(run.postedAt || '') && !alreadyCarried(state, o.id);
  });
}

// What one late-approved filing is worth: the original cutoff computed with and without it (same attendance, rules and
// rates as that date), the difference per component. Fixed overtime amounts typed for that cutoff are left out so they
// do not hide the difference.
export function carriedAmounts(state, employee, filing, calculatePayroll) {
  const [s, e] = cutoffOf(filing.date, state.rules[0]);
  const inputs = (state.payrollInputs || []).map(i => (i.employeeId === employee.id && i.start === s ? { ...i, overrides: (i.overrides || []).filter(o => !CARRY_COMPONENTS.includes(o.component)) } : i));
  const base = { ...state, noCarry: true, payrollInputs: inputs };
  const others = (state.overtimeRequests || []).filter(o => o.id !== filing.id);
  const run = list => calculatePayroll({ ...base, overtimeRequests: list }, s, e, false, [employee.id]).rows[0]?.earnings || {};
  const withIt = run([...others, filing]), without = run(others);
  return Object.fromEntries(CARRY_COMPONENTS.map(k => [k, round((withIt[k] || 0) - (without[k] || 0))]).filter(([, v]) => v > 0));
}

// At posting: mark every approved filing this payroll paid (its own dates, and carried ones) as Paid.
export function markOvertimePaid(store, run) {
  const at = new Date().toISOString(), update = store.db.prepare('UPDATE overtime_requests SET data=? WHERE id=?');
  let marked = 0;
  for (const row of run.rows) {
    const own = store.db.prepare("SELECT data FROM overtime_requests WHERE employee_id=? AND status='approved' AND date BETWEEN ? AND ?").all(row.employeeId, run.start, run.end).map(r => JSON.parse(r.data));
    const carried = (row.carriedOvertime || []).map(c => JSON.parse(store.db.prepare('SELECT data FROM overtime_requests WHERE id=?').get(c.id)?.data || 'null')).filter(Boolean);
    for (const o of [...own, ...carried]) {
      if (o.paidRunId) continue;
      const carry = (row.carriedOvertime || []).find(c => c.id === o.id);
      const paid = { ...o, paidRunId: run.id, paidAt: at, paidCutoff: `${run.start} to ${run.end}`, paidPayDate: payDateFor(run.start, run.end), ...(carry ? { carriedAmount: carry.amount } : {}), history: [...(o.history || []), { at, by: run.postedBy, action: 'paid', note: `Paid in the ${run.start} to ${run.end} payroll${carry ? ` (carried over, ${carry.amount})` : ''}` }] };
      update.run(JSON.stringify(paid), o.id); marked++;
    }
  }
  return marked;
}
// Reversing a payroll: its filings are unpaid again (they will be paid by the payroll that replaces it).
export function unmarkOvertimePaid(store, runId) {
  const update = store.db.prepare('UPDATE overtime_requests SET data=? WHERE id=?'), at = new Date().toISOString();
  for (const o of store.db.prepare('SELECT data FROM overtime_requests').all().map(r => JSON.parse(r.data)).filter(x => x.paidRunId === runId)) {
    const { paidRunId, paidAt, paidCutoff, carriedAmount, ...rest } = o;
    void paidRunId; void paidAt; void carriedAmount;
    update.run(JSON.stringify({ ...rest, history: [...(o.history || []), { at, by: 'system', action: 'unpaid', note: `Payroll ${paidCutoff} reversed` }] }), o.id);
  }
}
