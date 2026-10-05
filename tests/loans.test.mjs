import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll, reversePayroll } from '../src/service.mjs';
import { applyLoan, decideLoanApplication, loanDashboard, myLoans, cancelLoanApplication } from '../src/loans.mjs';
import { completeState, admin } from './helpers.mjs';

const worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' }, hr = { username: 'hr1', role: 'hr' };
function fixture() { const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s); return store; }
const run = store => preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);

test('a loan application is deducted only after approval; balances move only when payroll is posted; reversal restores them', () => {
  const store = fixture();
  try {
    const app = applyLoan(store, worker, { type: 'Salary Loan', amount: 12000, months: 6, purpose: 'Tuition (demo)' });
    assert.equal(run(store).rows[0].deductions.loans, 0, 'pending application: no deduction');
    assert.throws(() => decideLoanApplication(store, worker, app.id, { decision: 'reject', remarks: 'no' }), /permission/i);
    const { loan } = decideLoanApplication(store, hr, app.id, { decision: 'approve', approvedAmount: 10000, interest: 600, months: 6, startDate: '2026-09-01' });
    assert.equal(loan.monthlyAmortization, 1766.67); assert.equal(loan.perPayroll, Math.round(loan.monthlyAmortization / 2 * 100) / 100);
    const preview1 = run(store), d = preview1.rows[0].loanDeductions[0];
    assert.equal(d.amount, loan.perPayroll);
    assert.equal(Math.round((d.principal + d.interest) * 100) / 100, d.amount, 'principal + interest = deduction');
    assert.ok(d.interest > 0 && d.principal < d.amount, 'interest is separate from principal');
    assert.equal(store.read().loans[0].balance, 10000, 'preview does not change the balance');
    const posted = postPayroll(store, admin, { start: preview1.start, end: preview1.end, pay13th: false, fingerprint: preview1.fingerprint, employeeIds: ['EMP-001'] });
    const after = store.read().loans[0];
    assert.equal(after.balance, d.remainingBalance); assert.equal(after.interestBalance, d.remainingInterest); assert.equal(after.remainingTerms, loan.terms - 1);
    const dash = loanDashboard(store, hr).loans[0];
    assert.equal(dash.totalRepaid, d.amount); assert.equal(dash.history.length, 1); assert.equal(dash.status, 'Active'); assert.ok(dash.nextDeduction);
    assert.equal(myLoans(store, worker).loans[0].totalRepaid, d.amount);
    assert.throws(() => reversePayroll(store, hr, posted.id, { reason: 'Wrong cutoff' }), /permission/i);
    reversePayroll(store, admin, posted.id, { reason: 'Attendance correction needed' });
    const restored = store.read().loans[0];
    assert.equal(restored.balance, 10000); assert.equal(restored.interestBalance, 600); assert.equal(restored.remainingTerms, loan.terms);
    assert.equal(loanDashboard(store, hr).loans[0].totalRepaid, 0, 'reversed payroll is not a repayment');
    const again = run(store);
    assert.ok(!again.blockers.some(b => /posted payroll/.test(b)), 'the cutoff can be posted again');
    assert.equal(again.rows[0].loanDeductions[0].amount, d.amount, 'no duplicate deduction after reversal');
  } finally { store.close(); }
});

test('the final deduction never exceeds what is owed; rejected and cancelled applications create no loan', () => {
  const store = fixture();
  try {
    const app = applyLoan(store, worker, { type: 'Salary Loan', amount: 500, months: 1, purpose: 'Small advance (demo)' });
    decideLoanApplication(store, hr, app.id, { decision: 'approve', approvedAmount: 500, months: 1, startDate: '2026-09-01' });
    const s = store.read(); s.loans[0].perPayroll = 5000; s.loans[0].monthlyAmortization = 5000; store.write(s);
    assert.equal(run(store).rows[0].loanDeductions[0].amount, 500);
    const two = applyLoan(store, worker, { type: 'Salary Loan', amount: 900, months: 2, purpose: 'Repairs (demo)' });
    assert.throws(() => decideLoanApplication(store, hr, two.id, { decision: 'reject', remarks: '' }), /reason/);
    decideLoanApplication(store, hr, two.id, { decision: 'reject', remarks: 'Existing loan active' });
    const three = applyLoan(store, worker, { type: 'Salary Loan', amount: 300, months: 1, purpose: 'Other (demo)' });
    cancelLoanApplication(store, worker, three.id);
    assert.equal(store.read().loans.length, 1);
    assert.deepEqual(myLoans(store, worker).applications.map(a => a.status).sort(), ['approved', 'cancelled', 'rejected']);
  } finally { store.close(); }
});
