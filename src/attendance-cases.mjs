// Incomplete attendance (Nov 20, 2026). Every workday that is missing a time-in or time-out, or has no record at all,
// becomes one case per employee and date: the employee and HR are notified, the employee has three working days to
// file a time correction request, and overdue cases are escalated to HR. Nothing is assumed: no absence, no full-day
// deduction, no scheduled time is substituted. While a case is open, payroll needs HR's documented treatment for
// that day before posting. When the day is corrected (HR approves the request or completes the record), the case is
// resolved; if its payroll was already posted, only the difference between the corrected entitlement and what was
// paid is settled: an underpayment is paid by the next payroll, an overpayment waits for HR to recover or waive it.
// The correction status (request) and the payment status (adjustment) are kept separately.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { calculatePayroll, isRest } from './engine.mjs';
import { dayStatuses, ISSUE_LABELS } from './attendance-days.mjs';
import { CARRY_COMPONENTS } from './overtime-carry.mjs';
import { remittanceOnlyIds } from './remittance-only.mjs';
import { payslipReleased } from './paydays.mjs';
import { ensure as ensureRequests } from './attendance-requests.mjs';

export const CASE_START = '2026-11-01';   // cases are opened from this date on (earlier months are already settled)
export const DUE_WORKDAYS = 3;
const HR = ['admin', 'hr'];
const PAY_KEYS = ['basic', 'leavePay', ...CARRY_COMPONENTS];
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const todayOf = now => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const all = store => store.db.prepare('SELECT data FROM attendance_cases').all().map(r => JSON.parse(r.data));
const save = (store, c) => store.db.prepare('INSERT INTO attendance_cases(id,employee_id,date,status,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(c.id, c.employeeId, c.date, c.status, JSON.stringify(c));
const step = (c, by, action, note = '') => ({ ...c, history: [...(c.history || []), { at: new Date().toISOString(), by, action, note }] });
const postedRun = (state, employeeId, day) => state.runs.find(r => r.status === 'posted' && r.start <= day && r.end >= day && r.rows.some(row => row.employeeId === employeeId));
// Working days after a date (the employee's rest days and calendar holidays skipped).
function dueDate(state, employee, from) {
  let d = from, n = 0;
  while (n < DUE_WORKDAYS) { d = addDays(d, 1); if (!isRest(employee, d) && !state.holidays.some(h => h.date === d && h.kind !== 'ordinary')) n++; }
  return d;
}
// The latest time correction request for the day: the "correction status".
function correctionOf(store, employeeId, date) {
  ensureRequests(store);
  const r = store.db.prepare("SELECT data FROM attendance_requests WHERE employee_id=? AND date=? ORDER BY rowid DESC").all(employeeId, date).map(x => JSON.parse(x.data))[0];
  if (!r) return { status: 'not-requested', label: 'Not requested' };
  const status = r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : r.status === 'cancelled' ? 'not-requested' : 'pending';
  return { status, label: { approved: 'Approved', rejected: 'Rejected', pending: 'Pending HR review', 'not-requested': 'Cancelled by employee' }[status], reference: r.reference, requestStatus: r.status };
}

// What the correction changes in a posted payroll: the cutoff computed with the day as it was paid and as corrected,
// under the same rules (so later rule changes never create a difference), on the pay lines attendance affects.
export function correctionDifference(store, state, c, run) {
  const asOf = todayOf(new Date()), keep = a => !(a.employeeId === c.employeeId && a.date === c.date);
  const paidRecord = (run.sources?.attendance || []).find(a => a.employeeId === c.employeeId && a.date === c.date) || null;
  const inEvent = store.db.prepare("SELECT id, data FROM clock_events WHERE employee_id=? AND work_date=? AND kind='in' ORDER BY rowid").get(c.employeeId, c.date);
  const asPaid = { ...state, noCarry: true, noCaseAdjust: true, asOf, attendance: [...state.attendance.filter(keep), ...(paidRecord ? [paidRecord] : [])],
    openClockIns: [...(state.openClockIns || []).filter(o => !(o.employeeId === c.employeeId && o.workDate === c.date)), ...(!paidRecord && inEvent ? [{ id: inEvent.id, employeeId: c.employeeId, workDate: c.date, time: JSON.parse(inEvent.data).time }] : [])],
    attendanceCases: (state.attendanceCases || []).map(x => (x.id === c.id ? { ...x, status: 'open' } : x)) };
  const corrected = { ...state, noCarry: true, noCaseAdjust: true, asOf };
  const pay = st => calculatePayroll(st, run.start, run.end, run.pay13th, [c.employeeId]).rows[0]?.earnings || {};
  const before = pay(asPaid), after = pay(corrected);
  return r2(PAY_KEYS.reduce((sum, k) => sum + (after[k] || 0) - (before[k] || 0), 0));
}

// Opens, updates, resolves and escalates cases. Run hourly and whenever the lists are opened.
export function refreshCases(store, now = new Date()) {
  const state = store.read(), today = todayOf(now), skip = remittanceOnlyIds(store), at = now.toISOString();
  const existing = new Map(all(store).map(c => [`${c.employeeId}|${c.date}`, c])), opened = [], resolved = [];
  for (const e of state.employees.filter(x => !x.draft && !x.archived && x.active !== false && !skip.has(x.id) && x.startDate && x.startDate <= today)) {
    const from = e.startDate > CASE_START ? e.startDate : CASE_START, to = e.endDate && e.endDate < today ? e.endDate : today;
    if (from > to) continue;
    for (const d of dayStatuses(store, state, e, from, to, now)) {
      const c = existing.get(`${e.id}|${d.date}`);
      if (d.issue && !c) {
        const due = dueDate(state, e, today), value = { id: randomUUID(), employeeId: e.id, employeeName: e.name, date: d.date, issue: d.issue, status: 'open', detectedAt: at, due, timeIn: d.timeIn, timeOut: d.timeOut, treatment: null, adjustment: null, escalatedAt: null, history: [{ at, by: 'system', action: 'detected', note: `${ISSUE_LABELS[d.issue]}; correction due ${due}` }] };
        save(store, value); opened.push(value);
        store.notify(e.id, `${ISSUE_LABELS[d.issue]} on ${longDate(d.date)}: please submit a time correction request with the actual time and the reason by ${longDate(due)} (Attendance → Requests).`);
      } else if (d.issue && c?.status === 'open' && c.issue !== d.issue) save(store, step({ ...c, issue: d.issue, timeIn: d.timeIn, timeOut: d.timeOut }, 'system', 'updated', ISSUE_LABELS[d.issue]));
      else if (!d.issue && c?.status === 'open') {
        const corr = correctionOf(store, e.id, d.date), run = postedRun(state, e.id, d.date);
        let next = step({ ...c, status: 'resolved', resolvedAt: at, resolution: corr.status === 'approved' ? `Correction ${corr.reference} approved` : 'Attendance completed in the records', timeIn: d.timeIn, timeOut: d.timeOut }, 'system', 'resolved', corr.reference || '');
        if (run) {
          const diff = correctionDifference(store, state, next, run);
          next = { ...next, adjustment: Math.abs(diff) < 0.01 ? { status: 'none', amount: 0, kind: 'none', paidCutoff: `${run.start} to ${run.end}` } : diff > 0 ? { status: 'pending', amount: diff, kind: 'underpayment', paidCutoff: `${run.start} to ${run.end}` } : { status: 'review', amount: r2(-diff), kind: 'overpayment', paidCutoff: `${run.start} to ${run.end}` } };
          if (diff <= -0.01) store.notify(null, `${e.name}: attendance correction for ${longDate(d.date)} shows a possible overpayment of ₱${r2(-diff).toFixed(2)} in the ${run.start} to ${run.end} payroll. Review it in Attendance → Requests → Incomplete attendance.`);
        }
        save(store, next); resolved.push(next);
      }
    }
  }
  if (opened.length) {
    const names = [...new Set(opened.map(c => c.employeeName))];
    store.notify(null, `${opened.length} incomplete attendance record${opened.length === 1 ? '' : 's'} detected (${names.slice(0, 5).join('; ')}${names.length > 5 ? ` +${names.length - 5}` : ''}). Employees were asked to file a correction within ${DUE_WORKDAYS} working days.`);
  }
  // Escalation: a case still open after its due date goes to HR (once).
  for (const c of all(store).filter(x => x.status === 'open' && !x.escalatedAt && today > x.due)) {
    save(store, step({ ...c, escalatedAt: at }, 'system', 'escalated', `No correction by ${c.due}`));
    store.notify(null, `${c.employeeName}: ${ISSUE_LABELS[c.issue]} on ${longDate(c.date)} still has no approved correction (due ${longDate(c.due)}). HR review needed.`);
    store.notify(c.employeeId, `Reminder: your ${ISSUE_LABELS[c.issue]} on ${longDate(c.date)} is overdue for a time correction request. HR has been informed.`);
  }
  return { opened: opened.length, resolved: resolved.length };
}

// HR's documented pay treatment of an unresolved day (required before posting a payroll that includes it):
// 'credit' = pay the day as attended pending verification; 'hold' = not credited until corrected.
export function setTreatment(store, actor, id, input) {
  permit(actor, HR);
  const v = z.object({ mode: z.enum(['credit', 'hold']), note: z.string().trim().min(5, 'Write the reason for this treatment (at least 5 characters).').max(500) }).strict().parse(input);
  return store.transaction(() => {
    const c = all(store).find(x => x.id === id);
    if (!c) throw new AppError('Case not found.', 404);
    if (c.status !== 'open') throw new AppError('This case is already resolved.');
    const after = step({ ...c, treatment: { ...v, by: actor.username, at: new Date().toISOString() } }, actor.username, 'treatment', `${v.mode === 'credit' ? 'Credited pending verification' : 'Held until corrected'}: ${v.note}`);
    save(store, after); store.log(actor, 'treatment', 'attendance-cases', id, { treatment: c.treatment }, { employeeId: c.employeeId, date: c.date, treatment: after.treatment });
    return after;
  });
}
// An overpayment found after a correction: HR recovers it through the next payroll or waives it (reason required).
export function decideOverpayment(store, actor, id, input) {
  permit(actor, HR);
  const v = z.object({ action: z.enum(['recover', 'waive']), note: z.string().trim().min(5, 'Write the reason (at least 5 characters).').max(500) }).strict().parse(input);
  return store.transaction(() => {
    const c = all(store).find(x => x.id === id);
    if (!c || c.adjustment?.kind !== 'overpayment' || c.adjustment.status !== 'review') throw new AppError('This case has no overpayment to review.');
    const after = step({ ...c, adjustment: { ...c.adjustment, status: v.action === 'recover' ? 'recover' : 'waived', decidedBy: actor.username, decidedAt: new Date().toISOString(), note: v.note } }, actor.username, v.action === 'recover' ? 'recover-overpayment' : 'waive-overpayment', v.note);
    save(store, after); store.log(actor, after.adjustment.status, 'attendance-cases', id, { adjustment: c.adjustment }, { employeeId: c.employeeId, date: c.date, adjustment: after.adjustment });
    if (v.action === 'recover') store.notify(c.employeeId, `An overpayment of ₱${c.adjustment.amount.toFixed(2)} from your corrected attendance on ${longDate(c.date)} will be deducted in your next payroll: ${v.note}`);
    return after;
  });
}
// Posting: adjustments the run included are marked; reversing the run returns them to pending.
export function markCaseAdjustments(store, run) {
  const cases = new Map(all(store).map(c => [c.id, c]));
  for (const row of run.rows) for (const a of row.caseAdjustments || []) {
    const c = cases.get(a.id); if (!c) continue;
    save(store, step({ ...c, adjustment: { ...c.adjustment, status: 'included', runId: run.id, includedIn: `${run.start} to ${run.end}`, previousStatus: c.adjustment.status } }, run.postedBy || 'system', 'included', `${run.start} to ${run.end}`));
  }
}
export function unmarkCaseAdjustments(store, runId) {
  for (const c of all(store).filter(x => x.adjustment?.runId === runId)) {
    const { runId: _r, includedIn, previousStatus, ...rest } = c.adjustment; void _r; void includedIn;
    save(store, step({ ...c, adjustment: { ...rest, status: previousStatus || 'pending' } }, 'system', 'payroll-reversed'));
  }
}
const paymentLabel = (state, c) => {
  const a = c.adjustment;
  if (!a) return { status: c.status === 'open' ? 'none' : 'none', label: c.status === 'open' ? (c.treatment ? (c.treatment.mode === 'credit' ? 'Credited pending verification' : 'Held until corrected') : 'Treatment needed before posting') : 'No payroll change' };
  if (a.status === 'included') { const run = state.runs.find(r => r.id === a.runId); return run && payslipReleased(run) ? { status: 'paid', label: `Paid (${a.includedIn})` } : { status: 'included', label: `Included in payroll ${a.includedIn}` }; }
  return { status: a.status, label: { none: 'No payroll change', pending: `Underpayment ₱${a.amount.toFixed(2)}: pending, next payroll`, review: `Possible overpayment ₱${a.amount.toFixed(2)}: HR review`, recover: `Overpayment ₱${a.amount.toFixed(2)}: to be recovered next payroll`, waived: `Overpayment ₱${a.amount.toFixed(2)} waived` }[a.status] || a.status };
};
export function listCases(store, actor) {
  permit(actor, [...HR, 'payroll']);
  refreshCases(store);
  const state = store.read(), today = todayOf(new Date());
  return all(store).sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName))
    .map(c => ({ ...c, issueLabel: ISSUE_LABELS[c.issue], overdue: c.status === 'open' && today > c.due, correction: correctionOf(store, c.employeeId, c.date), payment: paymentLabel(state, c) }));
}
export function myCases(store, actor) {
  if (actor.role !== 'employee') throw new AppError('Only employees have their own attendance cases.', 403);
  refreshCases(store);
  const state = store.read(), today = todayOf(new Date());
  return all(store).filter(c => c.employeeId === actor.employeeId).sort((a, b) => b.date.localeCompare(a.date))
    .map(c => ({ id: c.id, date: c.date, issue: c.issue, issueLabel: ISSUE_LABELS[c.issue], status: c.status, due: c.due, overdue: c.status === 'open' && today > c.due, timeIn: c.timeIn, timeOut: c.timeOut, correction: correctionOf(store, c.employeeId, c.date), payment: paymentLabel(state, c) }));
}
