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
    const state = store.read(), employee = state.employees.find(e => e.id === actor.employeeId);
    if (!employee) throw new AppError('Your employee record was not found.', 404);
    assertMayBorrow(state, employee.id);
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
const approveSchema = z.object({ renewLoanIds: z.array(z.string().max(80)).max(10).default([]), decision: z.literal('approve'), approvedAmount: z.number().positive().max(10_000_000), interest: z.number().min(0).max(10_000_000).default(0), months: z.number().int().min(1).max(120), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().max(120).default(''), remarks: z.string().trim().max(1000).default('') }).strict();
const rejectSchema = z.object({ decision: z.literal('reject'), remarks: z.string().trim().min(3, 'Give the employee a reason.').max(1000) }).strict();
// A new loan (a renewal that pays the old balance off, or a separate loan) only when every active loan is down to less
// than 20% of what was borrowed (principal + interest). Checked when the employee applies and again when HR approves.
export const NEW_LOAN_BELOW_SHARE = 0.2;
export function assertMayBorrow(state, employeeId) {
  for (const l of state.loans.filter(x => x.employeeId === employeeId && x.authorized)) {
    const owed = r2(l.balance + (l.interestBalance || 0)), share = owed / ((l.original || 0) + (l.interestTotal || 0) || 1);
    if (owed > 0 && share >= NEW_LOAN_BELOW_SHARE - 1e-9) throw new AppError(`A new loan is possible only when less than 20% of the current loan is left. ${l.type} ${l.reference}: ${Math.round(share * 1000) / 10}% is still owed (₱${owed.toFixed(2)} of ₱${r2((l.original || 0) + (l.interestTotal || 0)).toFixed(2)}).`);
  }
}
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
    assertMayBorrow(state, app.employeeId);
    const total = r2(v.approvedAmount + v.interest), monthly = r2(total / v.months), terms = v.months * perMonth;
    // Renewal: the new loan first pays off the employee's chosen active loans (principal + interest still due); only
    // the rest is released. Each old loan closes with a "Paid by renewal" payment, so its history stays complete.
    const renewed = [...new Set(v.renewLoanIds)].map(lid => {
      const old = state.loans.find(l => l.id === lid && l.employeeId === app.employeeId && l.authorized && r2(l.balance + (l.interestBalance || 0)) > 0);
      if (!old) throw new AppError('One of the loans to renew is not an active loan of this employee.');
      return { old, amount: r2(old.balance + (old.interestBalance || 0)) };
    });
    const payoff = r2(renewed.reduce((s, r) => s + r.amount, 0));
    if (payoff > v.approvedAmount) throw new AppError(`The approved amount must cover the balance being renewed (₱${payoff.toFixed(2)}).`);
    const loan = {
      id: randomUUID(), employeeId: app.employeeId, type: app.type, reference: v.reference || `LOAN-${app.id.slice(0, 8).toUpperCase()}`,
      original: v.approvedAmount, balance: v.approvedAmount, interestTotal: v.interest, interestBalance: v.interest,
      monthlyAmortization: monthly, perPayroll: r2(monthly / perMonth), startDate: v.startDate, endDate: addMonths(v.startDate, v.months),
      terms, remainingTerms: terms, authorized: true, applicationId: app.id,
      ...(renewed.length ? { payoff, renewalOf: renewed.map(r => ({ id: r.old.id, reference: r.old.reference, amount: r.amount })) } : {}),
    };
    saveRecord(store, actor, 'loans', loan, { trusted: true });
    if (renewed.length) {
      const next = store.read(), paidOn = localToday();
      for (const { old, amount } of renewed) {
        const target = next.loans.find(l => l.id === old.id), before = structuredClone(target);
        Object.assign(target, { priorPayments: [...(target.priorPayments || []), { date: paidOn, amount, note: `Paid by renewal (${loan.reference})` }], balance: 0, interestBalance: 0, remainingTerms: 0, renewedBy: loan.id });
        store.log(actor, 'renewal-payoff', 'loans', target.id, before, target);
      }
      store.write(next);
    }
    const updated = { ...app, status: 'approved', approvedAmount: v.approvedAmount, interest: v.interest, approvedMonths: v.months, startDate: v.startDate, loanId: loan.id, ...(renewed.length ? { payoff, netRelease: r2(v.approvedAmount - payoff), renewed: loan.renewalOf } : {}), remarks: v.remarks, decidedBy: actor.username, decidedAt: now, history: [...app.history, { at: now, by: actor.username, action: 'approved', note: v.remarks }] };
    write(store, updated); store.log(actor, 'approve', 'loan-applications', id, app, updated);
    // The loan follows the terms HR approved; the notice spells them out and says what HR changed from the request.
    const peso = n => `₱${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, mo = n => `${n} month${n === 1 ? '' : 's'}`;
    const changes = [v.approvedAmount !== app.amount ? `amount ${peso(app.amount)} → ${peso(v.approvedAmount)}` : '', v.months !== app.months ? `${app.months} → ${mo(v.months)}` : '', v.interest ? `interest / fees ${peso(v.interest)} added` : ''].filter(Boolean);
    store.notify(app.employeeId, `Your ${app.type} was approved: ${peso(v.approvedAmount)}${v.interest ? ` + ${peso(v.interest)} interest / fees` : ''} over ${mo(v.months)}. Payroll deducts ${peso(loan.perPayroll)} per payroll (${peso(loan.monthlyAmortization)} a month) from ${v.startDate}.${renewed.length ? ` Renewal: ${peso(payoff)} of it paid off your ${renewed.map(r => `${r.old.type} ${r.old.reference}`).join(' and ')}; ${peso(v.approvedAmount - payoff)} released to you.` : ''}${changes.length ? ` HR changed your requested terms: ${changes.join('; ')}.` : ''}${v.remarks ? ` HR remarks: ${v.remarks}` : ''}`);
    return { application: updated, loan };
  });
}

// ---------- Dashboard ----------
function postedRepayments(state, loanId) {
  return state.runs.filter(r => r.status === 'posted').flatMap(run => run.rows.flatMap(row => (row.loanDeductions || []).filter(l => l.loanId === loanId).map(l => ({ runId: run.id, start: run.start, end: run.end, paidOn: payDateFor(run.start, run.end), postedAt: run.postedAt, amount: l.amount, principal: l.principal ?? l.amount, interest: l.interest ?? 0, balanceAfter: l.remainingBalance })))).sort((a, b) => a.start.localeCompare(b.start));
}
// Payment history: payments made before the system (recorded by HR on the loan) followed by posted payroll deductions.
function repayments(state, loanId) {
  const loan = state.loans.find(l => l.id === loanId), prior = (loan?.priorPayments || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  // One running balance in the order the money was paid (a payroll deduction on its salary day: 1st-15th on the 22nd,
  // 16th-end on the 8th of the next month), so payments encoded later still line up; below zero is an overpayment.
  const before = prior.map(p => ({ prior: true, start: p.date, end: p.date, paidOn: p.date, amount: p.amount, principal: p.amount, interest: 0, note: p.note || 'Paid before the system' }));
  let paid = 0;
  return [...before, ...postedRepayments(state, loanId)].sort((a, b) => a.paidOn.localeCompare(b.paidOn))
    .map(h => { paid += h.principal; return { ...h, balanceAfter: r2((loan?.original || 0) - paid) }; });
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
// One application with its employee and, once approved, the loan it created (for the printable application form).
// Admin, HR and Payroll see every application; an employee only their own.
export function loanApplicationRecord(store, actor, id) {
  permit(actor, [...APPROVERS, 'employee']);
  const application = apps(store, 'WHERE id=?', String(id))[0];
  if (!application || (actor.role === 'employee' && application.employeeId !== actor.employeeId)) throw new AppError('Loan application not found.', 404);
  const state = store.read();
  return { application, employee: state.employees.find(e => e.id === application.employeeId) || null, loan: application.loanId ? state.loans.find(l => l.id === application.loanId) || null : null };
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
