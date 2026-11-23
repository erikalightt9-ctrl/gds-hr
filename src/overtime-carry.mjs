// Overtime carryover (Nov 20, 2026). A cutoff can be posted while overtime is still waiting: pending filings, and
// overtime worked past the scheduled time out that nobody filed, stay "Pending Overtime" and move forward with each
// cutoff until HR decides. Once HR approves, the next payroll pays it at the rates of the original date (holiday, rest
// day, night) and rules, keeping the original date, hours, reason and history. Posting marks every filing it paid as
// Paid (paidRunId), so nothing is paid twice; reversing that payroll clears the mark.
import { randomUUID } from 'node:crypto';
import { payDateFor } from './paydays.mjs';
import { scheduleOn, isRest, round, OT_BLOCK } from './engine.mjs';

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

// At posting: overtime worked past the scheduled time out (one 30-minute block or more) on a day with no filing at all
// becomes a pending application ("Pending Overtime", source 'carryover'). The employee may add the reason (edit) and HR
// approves or rejects it like any filing; until then it simply waits.
export function carryUnfiledOvertime(store, run, state) {
  const at = new Date().toISOString(), created = [];
  const hm = t => { const [h, m] = String(t || '').split(':').map(Number); return h * 60 + (m || 0); };
  for (const row of run.rows) {
    const e = state.employees.find(x => x.id === row.employeeId);
    if (!e?.coveredOT) continue;
    const profile = (state.employeeProfiles || []).find(p => p.employeeId === e.id && p.section === 'attendance') || {};
    const filed = new Set(store.db.prepare('SELECT date FROM overtime_requests WHERE employee_id=? AND date BETWEEN ? AND ?').all(e.id, run.start, run.end).map(r => r.date));
    for (const a of state.attendance.filter(x => x.employeeId === e.id && x.status === 'present' && x.date >= run.start && x.date <= run.end && x.timeOut && !filed.has(x.date))) {
      const sched = scheduleOn(e, profile, a.date, state.rules[0]);
      if (!sched.end || sched.flexible || isRest(e, a.date)) continue;
      const out = hm(a.timeOut) + (a.endNextDay ? 1440 : 0), end = hm(sched.end) + (hm(sched.end) <= hm(sched.start) ? 1440 : 0), minutes = out - end;
      if (minutes < OT_BLOCK) continue;
      const value = { id: randomUUID(), employeeId: e.id, date: a.date, startTime: sched.end, endTime: a.timeOut, breakMinutes: 0, nightHours: 0, hours: round(minutes / 60), reason: 'Pending Overtime: worked after the scheduled time out, not yet filed (carried over automatically)', status: 'pending', source: 'carryover', createdBy: 'system', createdAt: at, history: [{ at, by: 'system', action: 'carried-over', note: `Not filed by the ${run.start} to ${run.end} payroll; carried to the next cutoff until filed and approved` }] };
      store.db.prepare('INSERT INTO overtime_requests(id,employee_id,date,status,data) VALUES(?,?,?,?,?)').run(value.id, e.id, a.date, 'pending', JSON.stringify(value));
      created.push(value);
    }
  }
  return created;
}
