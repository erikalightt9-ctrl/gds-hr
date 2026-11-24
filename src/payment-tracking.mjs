// Payment tracking (Nov 24, 2026; role / workflow spec, Phase 3): payroll and loans each move Approved → Released →
// Paid / Confirmed. Released is recorded by Finance with the payment reference (releasePayslips, releaseLoan);
// Paid / Confirmed is Finance's (or the System Administrator's) confirmation that the money arrived: date and how it
// was confirmed (bank statement, acknowledgment). Audited; never undone except by the System Administrator.
import { z } from 'zod';
import { AppError, saveRecord } from './service.mjs';

const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date the payment was confirmed.'), note: z.string().trim().min(3, 'Say how the payment was confirmed (e.g. bank statement, employee acknowledgment).').max(500) }).strict();
const mayConfirm = actor => !!actor.finance || actor.role === 'admin';
export const paymentStage = item => (item.paymentConfirmed ? 'Paid / Confirmed' : item.releasedAt || item.release ? 'Released' : 'Approved');

export function confirmRunPayment(store, actor, runId, input) {
  if (!mayConfirm(actor)) throw new AppError('The Finance / Releasing Officer or the System Administrator confirms payments.', 403);
  const v = schema.parse(input);
  return store.transaction(() => {
    const state = store.read(), run = state.runs.find(r => r.id === runId);
    if (!run) throw new AppError('Payroll not found.', 404);
    if (!run.releasedAt) throw new AppError('Record the salary release first.');
    if (run.paymentConfirmed) throw new AppError(`Payment already confirmed on ${run.paymentConfirmed.date}.`);
    run.paymentConfirmed = { ...v, by: actor.username, at: new Date().toISOString() }; state.version++; store.write(state);
    store.log(actor, 'confirm-payment', 'runs', run.id, null, { start: run.start, end: run.end, ...run.paymentConfirmed });
    return { id: run.id, paymentConfirmed: run.paymentConfirmed };
  });
}
export function confirmLoanPayment(store, actor, loanId, input) {
  if (!mayConfirm(actor)) throw new AppError('The Finance / Releasing Officer or the System Administrator confirms payments.', 403);
  const v = schema.parse(input);
  return store.transaction(() => {
    const loan = store.read().loans.find(l => l.id === loanId);
    if (!loan) throw new AppError('Loan not found.', 404);
    if (!loan.release) throw new AppError('Record the loan release first.');
    if (loan.paymentConfirmed) throw new AppError(`Payment already confirmed on ${loan.paymentConfirmed.date}.`);
    const after = { ...loan, paymentConfirmed: { ...v, by: actor.username, at: new Date().toISOString() } };
    saveRecord(store, actor, 'loans', after, { trusted: true });
    return after;
  });
}
