// Separate 13th month pay payslip, one per employee per year, built from the 13th Month Pay ledger:
//  • Draft: computed live from the saved records (encoded salary, finalized payroll, HR-edited totals, approved
//    adjustments and every payment already made). Its fingerprint changes whenever any of those change.
//  • Finalized: a frozen snapshot of the draft that was reviewed. Finalizing records the remaining amount as paid,
//    so the same entitlement cannot be paid again (by a second payslip or by "Pay accrued balance" in payroll).
//  • Adjustments: an amount added (+) or deducted (−) with a reason. Only approved adjustments count; HR / Payroll
//    entries wait for an administrator, an administrator's own entry is approved when saved.
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { thirteenthLedger } from './thirteenth.mjs';

const VIEW = ['admin', 'payroll', 'hr'], FINALIZE = ['admin', 'payroll'];
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const yearSchema = z.string().regex(/^\d{4}$/, 'Choose a calendar year.');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = iso => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const position = (store, id) => { const row = store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='employment'").get(id); return row ? JSON.parse(row.data).position || '' : ''; };
const peso = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rows = (store, sql, ...args) => store.db.prepare(sql).all(...args).map(r => JSON.parse(r.data));

// ---------- Draft statement ----------
export function thirteenthStatement(store, actor, employeeId, yearInput) {
  permit(actor, VIEW);
  const year = yearSchema.parse(String(yearInput ?? ''));
  const row = thirteenthLedger(store, actor, year).find(r => r.employeeId === employeeId);
  if (!row) throw new AppError('This employee has no 13th month pay record for that year (not registered, or remittance only).', 404);
  const state = store.read(), employee = state.employees.find(e => e.id === employeeId);
  const adjustments = rows(store, "SELECT data FROM thirteenth_adjustments WHERE employee_id=? AND year=? AND status='approved' ORDER BY rowid", employeeId, year)
    .map(a => ({ id: a.id, amount: a.amount, reason: a.reason, approvedBy: a.reviewedBy || a.createdBy, approvedAt: a.reviewedAt || a.createdAt }));
  const pendingAdjustments = store.db.prepare("SELECT COUNT(*) n FROM thirteenth_adjustments WHERE employee_id=? AND year=? AND status='pending'").get(employeeId, year).n;
  // Every payment already made for this year: payroll cutoffs, amounts paid before the system, finalized 13th month payslips.
  const payments = [
    ...state.runs.filter(r => r.status === 'posted' && r.start.startsWith(year)).flatMap(r => r.rows.filter(x => x.employeeId === employeeId && x.earnings.thirteenth > 0)
      .map(x => ({ source: 'payroll', label: `Paid in payroll ${shortDay(r.start)}-${Number(r.end.slice(8))}, ${year}`, date: r.postedAt || r.end, amount: r2(x.earnings.thirteenth) }))),
    ...state.priorEarnings.filter(p => p.employeeId === employeeId && p.month.startsWith(`${year}-`) && p.thirteenthPaid > 0)
      .map(p => ({ source: 'encoded', label: `Paid before the system (${MONTHS[Number(p.month.slice(5)) - 1]} ${year})${p.notes ? ` - ${p.notes}` : ''}`, date: p.month, amount: r2(p.thirteenthPaid) })),
    ...rows(store, "SELECT data FROM thirteenth_payslips WHERE employee_id=? AND year=? AND status='final' ORDER BY rowid", employeeId, year)
      .map(p => ({ source: 'payslip', id: p.id, label: `13th month payslip ${p.id.slice(0, 8)}`, date: p.finalizedAt, amount: p.amountPaid })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const previousTotal = r2(payments.reduce((s, p) => s + p.amount, 0));
  const adjustmentsTotal = r2(adjustments.reduce((s, a) => s + a.amount, 0));
  const totalDue = Math.max(0, r2(row.accrued + adjustmentsTotal));
  const start = employee.startDate && employee.startDate > `${year}-01-01` && employee.startDate.startsWith(year) ? employee.startDate : `${year}-01-01`;
  const end = employee.endDate && employee.endDate < `${year}-12-31` && employee.endDate.startsWith(year) ? employee.endDate : `${year}-12-31`;
  const figures = {
    employeeId, employeeName: employee.name, designation: position(store, employeeId), dateHired: employee.startDate || '', year, coveredStart: start, coveredEnd: end,
    totalBasic: row.totalBasic, basicBasis: row.totalEdited ? `Edited by HR (computed ${peso(row.computedTotal)})` : `Finalized payroll ${peso(row.postedBasic)} + encoded before the system ${peso(row.priorBasic)}`,
    thirteenth: row.accrued, thirteenthBasis: row.thirteenthEdited ? `Edited by HR (computed ${peso(row.computedAccrued)})` : row.covered13th ? `${peso(row.totalBasic)} / 12` : 'Not covered by 13th month pay',
    adjustments, adjustmentsTotal, totalDue, payments, previousTotal, remaining: Math.max(0, r2(totalDue - previousTotal)),
  };
  return { ...figures, draft: true, pendingAdjustments, fingerprint: createHash('sha256').update(JSON.stringify(figures)).digest('hex') };
}

// ---------- Finalize / void ----------
const finalizeSchema = z.object({ employeeId: z.string().min(1).max(80), year: yearSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export function finalizeThirteenthPayslip(store, actor, input) {
  permit(actor, FINALIZE);
  const { employeeId, year, fingerprint } = finalizeSchema.parse(input);
  return store.transaction(() => {
    const draft = thirteenthStatement(store, actor, employeeId, year);
    if (draft.fingerprint !== fingerprint) throw new AppError('The 13th month records changed after this draft was opened. Preview the draft again and review it before finalizing.', 409);
    if (draft.pendingAdjustments) throw new AppError('An adjustment for this employee is waiting for approval. Approve or reject it before finalizing.', 409);
    if (draft.remaining <= 0) throw new AppError(`Nothing is left to pay: the ${year} 13th month pay of ${draft.employeeName} has already been paid in full.`, 409);
    const slip = { ...draft, id: randomUUID(), draft: false, status: 'final', amountPaid: draft.remaining, finalizedBy: actor.username, finalizedAt: new Date().toISOString() };
    delete slip.pendingAdjustments;
    store.db.prepare('INSERT INTO thirteenth_payslips(id,employee_id,year,status,data) VALUES(?,?,?,?,?)').run(slip.id, employeeId, year, 'final', JSON.stringify(slip));
    store.log(actor, 'finalize', 'thirteenth-payslip', slip.id, null, { employeeId, year, amountPaid: slip.amountPaid });
    return slip;
  });
}
export function voidThirteenthPayslip(store, actor, id, input) {
  permit(actor, ['admin']);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Give the reason for cancelling this payslip.').max(500) }).strict().parse(input);
  return store.transaction(() => {
    const slip = thirteenthPayslip(store, actor, id);
    if (slip.status !== 'final') throw new AppError('This payslip is already cancelled.', 409);
    const value = { ...slip, status: 'void', voidedBy: actor.username, voidedAt: new Date().toISOString(), voidReason: reason };
    store.db.prepare("UPDATE thirteenth_payslips SET status='void', data=? WHERE id=?").run(JSON.stringify(value), id);
    store.log(actor, 'void', 'thirteenth-payslip', id, { status: 'final' }, { status: 'void', reason });
    return value;
  });
}
export function thirteenthPayslip(store, actor, id) {
  permit(actor, VIEW);
  const row = store.db.prepare('SELECT data FROM thirteenth_payslips WHERE id=?').get(id);
  if (!row) throw new AppError('13th month payslip not found.', 404);
  return JSON.parse(row.data);
}
export const thirteenthPayslips = (store, actor, year) => { permit(actor, VIEW); return rows(store, 'SELECT data FROM thirteenth_payslips WHERE year=? ORDER BY rowid DESC', String(year)); };

// ---------- Adjustments ----------
const adjustmentSchema = z.object({ employeeId: z.string().min(1).max(80), year: yearSchema, amount: z.number().min(-10_000_000).max(10_000_000).refine(v => v !== 0, 'Enter an amount other than zero.'), reason: z.string().trim().min(3, 'Give the reason for the adjustment.').max(500) }).strict();
export function addThirteenthAdjustment(store, actor, input) {
  permit(actor, VIEW);
  const a = adjustmentSchema.parse(input);
  if (!store.read().employees.some(e => e.id === a.employeeId)) throw new AppError(`Unknown employee ${a.employeeId}.`);
  const now = new Date().toISOString(), status = actor.role === 'admin' ? 'approved' : 'pending';
  const value = { id: randomUUID(), ...a, amount: r2(a.amount), status, createdBy: actor.username, createdAt: now, ...(status === 'approved' ? { reviewedBy: actor.username, reviewedAt: now } : {}) };
  return store.transaction(() => {
    store.db.prepare('INSERT INTO thirteenth_adjustments(id,employee_id,year,status,data) VALUES(?,?,?,?,?)').run(value.id, a.employeeId, a.year, status, JSON.stringify(value));
    store.log(actor, 'create', 'thirteenth-adjustment', value.id, null, value);
    return value;
  });
}
export function reviewThirteenthAdjustment(store, actor, id, input) {
  permit(actor, ['admin']);
  const { decision } = z.object({ decision: z.enum(['approve', 'reject']) }).strict().parse(input);
  return store.transaction(() => {
    const row = store.db.prepare('SELECT data FROM thirteenth_adjustments WHERE id=?').get(id);
    if (!row) throw new AppError('Adjustment not found.', 404);
    const before = JSON.parse(row.data);
    if (before.status !== 'pending') throw new AppError(`This adjustment was already ${before.status}.`, 409);
    const value = { ...before, status: decision === 'approve' ? 'approved' : 'rejected', reviewedBy: actor.username, reviewedAt: new Date().toISOString() };
    store.db.prepare('UPDATE thirteenth_adjustments SET status=?, data=? WHERE id=?').run(value.status, JSON.stringify(value), id);
    store.log(actor, decision, 'thirteenth-adjustment', id, before, value);
    return value;
  });
}
export const thirteenthAdjustments = (store, actor, year) => { permit(actor, VIEW); return rows(store, 'SELECT data FROM thirteenth_adjustments WHERE year=? ORDER BY rowid DESC', String(year)); };
