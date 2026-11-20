// Payroll attendance validation (Nov 20, 2026). Each day payroll uses is one of:
//   System Validated — an original TimeHub (biometric / GPS) time in and time out, complete and consistent with the
//                      punches, no pending correction: used automatically, no HR approval needed;
//   HR Approved      — a record HR approved, or a time correction HR already approved (used without a second approval);
//   For HR review    — a missing punch, conflicting records, a manual entry not approved, or a pending time correction.
// A review item never becomes an absence or a full-day deduction by itself: HR records a payroll decision for it
// (pay as recorded, credit pending verification, hold until resolved, or absent as verified) with a reason. Employees
// with undecided items are held out of posting; everyone else is processed. Overtime approval stays separate.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { ensureDecisions } from './validation-inputs.mjs';
export { validationInputs, VALIDATION_LABELS, ISSUE_LABELS, DECISIONS } from './validation-inputs.mjs';
import { DECISIONS } from './validation-inputs.mjs';

// HR's documented payroll decision for one review item (employee + date). Replacing it keeps the earlier one.
const decisionSchema = z.object({ employeeId: z.string().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), mode: z.enum(Object.keys(DECISIONS)), note: z.string().trim().min(5, 'Give the reason for this payroll decision (at least 5 characters).').max(1000), issue: z.string().max(40).default('') }).strict();
export function recordPayrollDecision(store, actor, input) {
  permit(actor, ['admin', 'hr', 'payroll']);
  const v = decisionSchema.parse(input);
  return store.transaction(() => {
    ensureDecisions(store.db);
    const state = store.read();
    if (!state.employees.some(e => e.id === v.employeeId)) throw new AppError('Employee not found.', 404);
    if (state.runs.some(run => run.status === 'posted' && run.start <= v.date && run.end >= v.date && run.rows.some(row => row.employeeId === v.employeeId))) throw new AppError('That date is in a posted payroll. Corrections of paid days are settled through the attendance correction (difference only).');
    const before = store.db.prepare('SELECT data FROM payroll_day_decisions WHERE employee_id=? AND date=?').get(v.employeeId, v.date);
    const previous = before ? JSON.parse(before.data) : null;
    const decision = { id: previous?.id || randomUUID(), employeeId: v.employeeId, date: v.date, mode: v.mode, label: DECISIONS[v.mode], note: v.note, issue: v.issue, by: actor.username, at: new Date().toISOString(), previous: previous ? [...(previous.previous || []), { mode: previous.mode, note: previous.note, by: previous.by, at: previous.at }] : [] };
    store.db.prepare('INSERT INTO payroll_day_decisions(id,employee_id,date,data) VALUES(?,?,?,?) ON CONFLICT(employee_id,date) DO UPDATE SET data=excluded.data').run(decision.id, v.employeeId, v.date, JSON.stringify(decision));
    store.log(actor, previous ? 'change-payroll-decision' : 'payroll-decision', 'attendance', `${v.employeeId}:${v.date}`, previous, decision);
    return decision;
  });
}
export function removePayrollDecision(store, actor, employeeId, date) {
  permit(actor, ['admin', 'hr', 'payroll']);
  ensureDecisions(store.db);
  const row = store.db.prepare('SELECT data FROM payroll_day_decisions WHERE employee_id=? AND date=?').get(employeeId, date);
  if (!row) throw new AppError('No payroll decision for that day.', 404);
  store.db.prepare('DELETE FROM payroll_day_decisions WHERE employee_id=? AND date=?').run(employeeId, date);
  store.log(actor, 'remove-payroll-decision', 'attendance', `${employeeId}:${date}`, JSON.parse(row.data), null);
  return { ok: true };
}
