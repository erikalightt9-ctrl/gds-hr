// Employee loans: applications from the employee portal, HR / Payroll approval (which creates the active loan),
// the loans dashboard with repayment history, and the employee's own view. Payroll deducts approved loans
// automatically (engine.mjs); balances change only when payroll is posted (service.postPayroll) and are restored if a
// posted payroll is reversed (reversePayroll).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { ruleOn } from './engine.mjs';
import { localToday } from './profiles.mjs';
import { payDateFor } from './paydays.mjs';

const APPROVERS = ['admin', 'payroll', 'hr'];
const TYPES = ['Salary Loan', 'Emergency Loan', 'Medical Loan', 'Educational Loan', 'Housing Loan', 'Vehicle Loan', 'Calamity Loan', 'SSS Loan', 'Pag-IBIG Loan', 'Other Company Loan'];
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const apps = (store, where = '', ...args) => store.db.prepare(`SELECT data FROM loan_applications ${where} ORDER BY rowid DESC`).all(...args).map(r => JSON.parse(r.data));
const write = (store, a) => store.db.prepare('INSERT INTO loan_applications(id,employee_id,status,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(a.id, a.employeeId, a.status, JSON.stringify(a));

// ---------- Employee ----------
const applySchema = z.object({ type: z.enum(TYPES), amount: z.number().positive().max(10_000_000), months: z.number().int().min(1).max(120), purpose: z.string().trim().min(3, 'Tell HR what the loan is for.').max(1000) }).strict();
export function applyLoan(store, actor, input) {
  permit(actor, ['employee']);
  const v = applySchema.parse(input);
  return store.transaction(() => {
    const employee = store.read().employees.find(e => e.id === actor.employeeId);
    if (!employee) throw new AppError('Your employee record was not found.', 404);
    if (apps(store, 'WHERE employee_id=? AND status=?', employee.id, 'pending').length >= 3) throw new AppError('You already have three pending loan applications.');
    const app = { id: randomUUID(), employeeId: employee.id, ...v, status: 'pending', appliedAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), by: actor.username, action: 'applied' }] };
    write(store, app);
    store.log(actor, 'apply', 'loan-applications', app.id, null, app);
    store.notify(null, `${employee.id}: new ${v.type} application for ₱${v.amount.toFixed(2)}.`);
    return app;
  });
}
export function cancelLoanApplication(store, actor, id) {
  permit(actor, ['employee']);
  return store.transaction(() => {
    const app = apps(store, 'WHERE id=?', id)[0];
    if (!app || app.employeeId !== actor.employeeId) throw new AppError('Loan application not found.', 404);
    if (app.status !== 'pending') throw new AppError('Only pending applications can be cancelled.');
    const updated = { ...app, status: 'cancelled', history: [...app.history, { at: new Date().toISOString(), by: actor.username, action: 'cancelled' }] };
    write(store, updated); store.log(actor, 'cancel', 'loan-applications', id, app, updated);
    return updated;
  });
}

// ---------- HR / Payroll decision ----------
const approveSchema = z.object({ decision: z.literal('approve'), approvedAmount: z.number().positive().max(10_000_000), interest: z.number().min(0).max(10_000_000).default(0), months: z.number().int().min(1).max(120), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().max(120).default(''), remarks: z.string().trim().max(1000).default('') }).strict();
const rejectSchema = z.object({ decision: z.literal('reject'), remarks: z.string().trim().min(3, 'Give the employee a reason.').max(1000) }).strict();
const addMonths = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
export function decideLoanApplication(store, actor, id, input) {
  permit(actor, APPROVERS);
  const v = input?.decision === 'approve' ? approveSchema.parse(input) : rejectSchema.parse(input);
  return store.transaction(() => {
    const app = apps(store, 'WHERE id=?', id)[0];
    if (!app) throw new AppError('Loan application not found.', 404);
    if (app.status !== 'pending') throw new AppError(`This application is already ${app.status}.`);
    const now = new Date().toISOString();
    if (v.decision === 'reject') {
      const updated = { ...app, status: 'rejected', remarks: v.remarks, decidedBy: actor.username, decidedAt: now, history: [...app.history, { at: now, by: actor.username, action: 'rejected', note: v.remarks }] };
      write(store, updated); store.log(actor, 'reject', 'loan-applications', id, app, updated);
      store.notify(app.employeeId, `Your ${app.type} application was not approved: ${v.remarks}`);
      return updated;
    }
    const state = store.read(), rule = ruleOn(state, v.startDate) || state.rules[0], perMonth = rule?.cutoff === 'monthly' ? 1 : 2;
    const total = r2(v.approvedAmount + v.interest), monthly = r2(total / v.months), terms = v.months * perMonth;
    const loan = {
      id: randomUUID(), employeeId: app.employeeId, type: app.type, reference: v.reference || `LOAN-${app.id.slice(0, 8).toUpperCase()}`,
      original: v.approvedAmount, balance: v.approvedAmount, interestTotal: v.interest, interestBalance: v.interest,
      monthlyAmortization: monthly, perPayroll: r2(monthly / perMonth), startDate: v.startDate, endDate: addMonths(v.startDate, v.months),
      terms, remainingTerms: terms, authorized: true, applicationId: app.id,
    };
    saveRecord(store, actor, 'loans', loan, { trusted: true });
    const updated = { ...app, status: 'approved', approvedAmount: v.approvedAmount, interest: v.interest, approvedMonths: v.months, startDate: v.startDate, loanId: loan.id, remarks: v.remarks, decidedBy: actor.username, decidedAt: now, history: [...app.history, { at: now, by: actor.username, action: 'approved', note: v.remarks }] };
    write(store, updated); store.log(actor, 'approve', 'loan-applications', id, app, updated);
    store.notify(app.employeeId, `Your ${app.type} of ₱${v.approvedAmount.toFixed(2)} was approved. Payroll deducts ₱${loan.perPayroll.toFixed(2)} per cutoff from ${v.startDate}.`);
    return { application: updated, loan };
  });
}

// ---------- Dashboard ----------
function postedRepayments(state, loanId) {
  return state.runs.filter(r => r.status === 'posted').flatMap(run => run.rows.flatMap(row => (row.loanDeductions || []).filter(l => l.loanId === loanId).map(l => ({ runId: run.id, start: run.start, end: run.end, postedAt: run.postedAt, amount: l.amount, principal: l.principal ?? l.amount, interest: l.interest ?? 0, balanceAfter: l.remainingBalance })))).sort((a, b) => a.start.localeCompare(b.start));
}
// Payment history: payments made before the system (recorded by HR on the loan) followed by posted payroll deductions.
function repayments(state, loanId) {
  const loan = state.loans.find(l => l.id === loanId), prior = (loan?.priorPayments || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  let paid = 0;
  const before = prior.map(p => { paid += p.amount; return { prior: true, start: p.date, end: p.date, amount: p.amount, principal: p.amount, interest: 0, balanceAfter: r2((loan.original || 0) - paid), note: p.note || 'Paid before the system' }; });
  return [...before, ...postedRepayments(state, loanId)];
}
function nextDeduction(state, loan, today = localToday()) {
  if (!loan.authorized || r2(loan.balance + (loan.interestBalance || 0)) <= 0) return '';
  // The first cutoff from the loan's start that is not posted yet: a cutoff that has ended but is not finalized is still next.
  const rule = ruleOn(state, today) || state.rules[0], from = loan.startDate;
  for (let i = 0; i < 2400; i++) {
    const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + Math.floor(i / 2));
    const ym = d.toISOString().slice(0, 7), last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const end = rule?.cutoff === 'monthly' ? (i % 2 ? null : `${ym}-${last}`) : i % 2 ? `${ym}-${last}` : `${ym}-15`;
    if (!end || end < from) continue;
    const posted = state.runs.some(r => r.status === 'posted' && r.end === end && r.rows.some(row => row.employeeId === loan.employeeId));
    const start = end.endsWith('-15') ? `${end.slice(0, 7)}-01` : rule?.cutoff === 'monthly' ? `${end.slice(0, 7)}-01` : `${end.slice(0, 7)}-16`;
    const wrongHalf = (loan.deductOn === 'first' && !start.endsWith('-01')) || (loan.deductOn === 'second' && !start.endsWith('-16'));
    // Shown as the salary day the deduction is taken (1st-15th: the 22nd; 16th-end: the 8th of the next month).
    if (!posted && !wrongHalf && !(loan.skipCutoffs || []).includes(start)) return payDateFor(start, end);
  }
  return '';
}
// Cutoffs (start dates) where this loan is not deducted, at the employee's request. Posted cutoffs cannot change.
const skipSchema = z.object({ cutoffs: z.array(z.string().regex(/^\d{4}-\d{2}-(01|16)$/, 'Choose cutoff start dates (the 1st or the 16th).')).max(500) }).strict();
export function setLoanSkips(store, actor, loanId, input) {
  permit(actor, APPROVERS);
  const { cutoffs } = skipSchema.parse(input);
  return store.transaction(() => {
    const state = store.read(), loan = state.loans.find(l => l.id === loanId);
    if (!loan) throw new AppError('Loan not found.', 404);
    const posted = c => state.runs.some(r => r.status === 'posted' && r.start === c && r.rows.some(row => row.employeeId === loan.employeeId));
    const before = new Set(loan.skipCutoffs || []), after = new Set(cutoffs);
    for (const c of new Set([...before, ...after])) if (before.has(c) !== after.has(c) && posted(c)) throw new AppError(`The ${c} cutoff is already final for this employee and cannot change.`);
    const skipCutoffs = [...after].sort();
    saveRecord(store, actor, 'loans', { ...loan, skipCutoffs }, { trusted: true });
    return { id: loan.id, skipCutoffs };
  });
}
// Which cutoff a loan is deducted in (every cutoff, only the 1st-15th paid on the 22nd, or only the 16th-end). Applies
// to cutoffs not yet posted; posted payroll keeps what it deducted. A reason is required and the change is audited.
const scheduleSchema = z.object({ deductOn: z.enum(['every', 'first', 'second']), reason: z.string().trim().min(3, 'Give the reason for the change.').max(500) }).strict();
export function setLoanSchedule(store, actor, loanId, input) {
  permit(actor, APPROVERS);
  const v = scheduleSchema.parse(input);
  return store.transaction(() => {
    const loan = store.read().loans.find(l => l.id === loanId);
    if (!loan) throw new AppError('Loan not found.', 404);
    if ((loan.deductOn || 'every') === v.deductOn) return { id: loan.id, deductOn: v.deductOn };
    saveRecord(store, actor, 'loans', { ...loan, deductOn: v.deductOn }, { trusted: true });
    store.log(actor, 'change-loan-schedule', 'loans', loan.id, { deductOn: loan.deductOn || 'every' }, { deductOn: v.deductOn, reason: v.reason });
    return { id: loan.id, deductOn: v.deductOn };
  });
}
export const loanStatus = loan => (!loan.authorized ? 'Not authorized' : r2(loan.balance + (loan.interestBalance || 0)) <= 0 ? 'Fully paid' : 'Active');
export function loanDashboard(store, actor) {
  permit(actor, ['admin', 'payroll', 'hr', 'viewer']);
  const state = store.read(), names = new Map(state.employees.map(e => [e.id, e.name]));
  const loans = state.loans.map(l => {
    const paid = repayments(state, l.id), principalPaid = r2(paid.reduce((s, p) => s + p.principal, 0)), interestPaid = r2(paid.reduce((s, p) => s + p.interest, 0));
    return { ...l, employeeName: names.get(l.employeeId) || l.employeeId, status: loanStatus(l), totalRepaid: r2(principalPaid + interestPaid), principalPaid, interestPaid, outstanding: r2(l.balance + (l.interestBalance || 0)), nextDeduction: nextDeduction(state, l), history: paid };
  });
  const applications = apps(store).map(a => ({ ...a, employeeName: names.get(a.employeeId) || a.employeeId }));
  return { loans, applications };
}
export function myLoans(store, actor) {
  permit(actor, ['employee']);
  const state = store.read();
  return {
    applications: apps(store, 'WHERE employee_id=?', actor.employeeId),
    loans: state.loans.filter(l => l.employeeId === actor.employeeId).map(l => { const paid = repayments(state, l.id); return { id: l.id, type: l.type, reference: l.reference, loanDate: l.loanDate || '', original: l.original, interestTotal: l.interestTotal || 0, perPayroll: l.perPayroll, monthlyAmortization: l.monthlyAmortization, outstanding: r2(l.balance + (l.interestBalance || 0)), totalRepaid: r2(paid.reduce((s, p) => s + p.amount, 0)), status: loanStatus(l), nextDeduction: nextDeduction(state, l), startDate: l.startDate, endDate: l.endDate, history: paid }; }),
  };
}
