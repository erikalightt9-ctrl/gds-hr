import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { saveRecord } from '../src/service.mjs';
import { applyLoan, decideLoanApplication, loanDashboard, myLoans } from '../src/loans.mjs';
import { renderLoanApplicationPdf } from '../src/loan-pdf.mjs';
import { completeState, admin } from './helpers.mjs';

// An active loan: ₱45,000 borrowed. With ₱8,000 still owed 17.8% is left: less than 20%, so a new loan is allowed.
const OLD = { id: 'OLD1', employeeId: 'EMP-001', type: 'Salary Loan', reference: 'SL-OLD', original: 45000, balance: 8000, monthlyAmortization: 4000, perPayroll: 2000, loanDate: '2026-07-16', startDate: '2026-08-01', endDate: '2027-01-31', terms: 12, remainingTerms: 3, authorized: true, interestTotal: 0, interestBalance: 0 };
const emp = { id: 'u1', username: 'emp1', role: 'employee', employeeId: 'EMP-001' };
function setup(balance = 8000) {
  const store = new Store(':memory:'); const s = completeState();
  s.loans = [{ ...structuredClone(OLD), balance, priorPayments: [{ date: '2026-08-22', amount: 45000 - balance, note: 'Paid before the system' }] }]; store.write(s);
  return store;
}
const approve = (store, id, extra = {}) => decideLoanApplication(store, admin, id, { decision: 'approve', approvedAmount: 50000, interest: 0, months: 12, startDate: '2026-12-01', ...extra });
const apply = (store, extra = {}) => applyLoan(store, emp, { type: 'Salary Loan', amount: 50000, months: 12, purpose: 'Renewal', ...extra });
const setBalance = (store, balance) => { const s = store.read(); Object.assign(s.loans[0], { balance }); store.write(s); };

test('renewal: the new loan pays off the old balance; the old loan closes; the rest is released', () => {
  const store = setup();
  const { loan, application } = approve(store, apply(store).id, { renewLoanIds: ['OLD1'] });
  assert.equal(loan.original, 50000); assert.equal(loan.payoff, 8000); assert.deepEqual(loan.renewalOf.map(r => [r.reference, r.amount]), [['SL-OLD', 8000]]);
  assert.equal(application.netRelease, 42000);
  const old = loanDashboard(store, admin).loans.find(l => l.id === 'OLD1');
  assert.equal(old.status, 'Fully paid'); assert.equal(old.outstanding, 0); assert.equal(old.renewedBy, loan.id);
  assert.match(old.history.at(-1).note, /Paid by renewal/); assert.equal(old.history.at(-1).amount, 8000); assert.equal(old.history.at(-1).balanceAfter, 0);
  const notice = store.db.prepare("SELECT message FROM notifications WHERE employee_id='EMP-001' ORDER BY rowid DESC").get().message;
  assert.match(notice, /₱8,000\.00 of it paid off your Salary Loan SL-OLD/); assert.match(notice, /₱42,000\.00 released to you/);
  assert.equal(myLoans(store, emp).loans.find(l => l.id === 'OLD1').status, 'Fully paid', 'the employee sees the same');
});

test('20% or more still owed: no new loan at all — the application is refused, and HR cannot approve one', () => {
  assert.throws(() => apply(setup(34000)), /less than 20%.*75\.6%/s, '₱34,000 of ₱45,000 = 75.6% left');
  assert.throws(() => apply(setup(9000)), /less than 20%.*20%/s, 'exactly 20% left is not yet enough');
  const store = setup(), a = apply(store);
  setBalance(store, 34000);   // the balance is higher again by the time HR decides
  assert.throws(() => approve(store, a.id, { renewLoanIds: ['OLD1'] }), /less than 20%/);
  assert.throws(() => approve(store, a.id), /less than 20%/, 'nor as a separate loan');
});

test('less than 20% left: renewal or a separate loan is allowed', () => {
  const store = setup();
  approve(store, apply(store, { type: 'Emergency Loan', amount: 5000, months: 5 }).id, { approvedAmount: 5000, months: 5 });
  const loans = loanDashboard(store, admin).loans;
  assert.equal(loans.filter(l => l.status === 'Active').length, 1);
  assert.equal(loans.filter(l => l.status === 'Awaiting release').length, 1, 'the new loan waits for Finance to record its release (Nov 24, 2026)');
});

test('renewal is refused when the new amount does not cover the old balance, or the loan is not the employee\'s', () => {
  const store = setup();
  const a = apply(store, { amount: 5000, months: 6 });
  assert.throws(() => approve(store, a.id, { approvedAmount: 5000, months: 6, renewLoanIds: ['OLD1'] }), /cover/);
  const s = store.read(); s.loans.push({ ...OLD, id: 'OTHER', employeeId: 'EMP-999', reference: 'SL-X' }); store.write(s);
  assert.throws(() => approve(store, a.id, { renewLoanIds: ['OTHER'] }), /not an active loan of this employee/);
  assert.equal(loanDashboard(store, admin).loans.find(l => l.id === 'OLD1').outstanding, 8000, 'nothing changed');
});

test('the application form shows the payoff and the net amount released', () => {
  const pdf = renderLoanApplicationPdf({ id: 'a1', employeeId: 'EMP-001', type: 'Salary Loan', amount: 50000, months: 12, purpose: 'Renewal', status: 'approved', appliedAt: '2026-11-13T00:00:00Z', approvedAmount: 50000, interest: 0, approvedMonths: 12, startDate: '2026-12-01', netRelease: 42000 },
    { employee: { name: 'Sample, Employee' }, loan: { reference: 'LOAN-NEW', perPayroll: 2083.33, monthlyAmortization: 4166.67, terms: 24, payoff: 8000, renewalOf: [{ id: 'OLD1', reference: 'SL-OLD', amount: 8000 }] } }).toString('latin1');
  for (const text of ['Paid off \\(renewal\\)', 'SL-OLD', '8,000.00', 'Net amount released', '42,000.00']) assert.ok(pdf.includes(text), text);
});

test('a renewed loan stays valid for the loan record rules (HR can still review / edit the new loan)', () => {
  const store = setup();
  const { loan } = approve(store, apply(store).id, { renewLoanIds: ['OLD1'] });
  assert.doesNotThrow(() => saveRecord(store, admin, 'loans', { ...loan, deductOn: 'second' }));
});
