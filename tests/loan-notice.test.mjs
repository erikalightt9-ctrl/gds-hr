import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { saveRecord } from '../src/service.mjs';
import { setLoanSchedule, setLoanSkips, applyLoan, decideLoanApplication, myLoans } from '../src/loans.mjs';
import { loanChangeText } from '../src/loan-notice.mjs';
import { completeState, admin } from './helpers.mjs';

const LOAN = { id: 'L1', employeeId: 'EMP-001', type: 'Salary Loan', reference: 'SL-1', original: 6000, balance: 6000, monthlyAmortization: 2000, perPayroll: 1000, loanDate: '2026-11-01', startDate: '2026-11-16', endDate: '2027-02-15', terms: 6, remainingTerms: 6, authorized: true, interestTotal: 0, interestBalance: 0 };
function setup() {
  const store = new Store(':memory:'); const s = completeState(); s.loans = [structuredClone(LOAN)]; store.write(s);
  return store;
}
const notices = store => store.db.prepare("SELECT message FROM notifications WHERE employee_id='EMP-001' ORDER BY rowid").all().map(n => n.message);
const emp = { id: 'u1', username: 'emp1', role: 'employee', employeeId: 'EMP-001' };

test('the change text lists each changed field, old → new', () => {
  const text = loanChangeText(LOAN, { ...LOAN, perPayroll: 500, monthlyAmortization: 1000, endDate: '2027-05-15', deductOn: 'second' }, 'update');
  assert.match(text, /Salary Loan SL-1 was updated by HR/);
  assert.match(text, /per payroll ₱1,000\.00 → ₱500\.00/); assert.match(text, /monthly ₱2,000\.00 → ₱1,000\.00/);
  assert.match(text, /last deduction 2027-02-15 → 2027-05-15/); assert.match(text, /deducted every cutoff → 16th–end cutoff only/);
  assert.equal(loanChangeText(LOAN, { ...LOAN }, 'update'), '', 'no change, no notice');
});

test('HR editing a loan notifies the employee, and the employee sees the same updated loan', () => {
  const store = setup();
  saveRecord(store, admin, 'loans', { ...LOAN, perPayroll: 500, monthlyAmortization: 1000 });
  assert.match(notices(store).at(-1), /per payroll ₱1,000\.00 → ₱500\.00/);
  assert.equal(myLoans(store, emp).loans[0].perPayroll, 500, 'the employee record shows the new amount');
});

test('schedule changes and skipped cutoffs notify the employee too', () => {
  const store = setup();
  setLoanSchedule(store, admin, 'L1', { deductOn: 'first', reason: 'Employee request' });
  assert.match(notices(store).at(-1), /deducted every cutoff → 1st–15th cutoff only/);
  setLoanSkips(store, admin, 'L1', { cutoffs: ['2026-12-01'] });
  assert.match(notices(store).at(-1), /not deducted on: 2026-12-01/);
});

test('approving an application sends one notice (the approval), not a second "loan recorded" one', () => {
  const store = setup();
  const s = store.read(); s.loans[0].balance = 600; store.write(s);   // 10% left: a new loan is allowed
  const a = applyLoan(store, emp, { type: 'Emergency Loan', amount: 2000, months: 2, purpose: 'Medical' });
  const before = notices(store).length;
  decideLoanApplication(store, admin, a.id, { decision: 'approve', approvedAmount: 2000, interest: 0, months: 2, startDate: '2026-12-01' });
  const added = notices(store).slice(before);
  assert.equal(added.length, 1); assert.match(added[0], /was approved/);
});

test('HR recording a loan directly tells the employee', () => {
  const store = setup();
  saveRecord(store, admin, 'loans', { ...LOAN, id: 'L2', reference: 'SL-2', original: 3000, balance: 3000 });
  assert.match(notices(store).at(-1), /HR recorded a Salary Loan SL-2 of ₱3,000\.00/);
});
