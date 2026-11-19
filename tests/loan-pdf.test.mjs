import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLoanApplicationPdf } from '../src/loan-pdf.mjs';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { applyLoan, decideLoanApplication, loanApplicationRecord } from '../src/loans.mjs';

const employee = { id: 'EMP-001', name: 'Sample, Employee', department: 'Head Office', startDate: '2025-01-01' };

test('loan application PDF: employee, request, approved terms, salary deduction authority and signatures', () => {
  const app = { id: 'app-12345678', employeeId: 'EMP-001', type: 'Salary Loan', amount: 5000, months: 5, purpose: 'House repair', status: 'approved', appliedAt: '2026-11-13T02:00:00Z', decidedAt: '2026-11-13T03:00:00Z', approvedAmount: 5000, interest: 0, approvedMonths: 5, startDate: '2026-11-16', remarks: 'Approved' };
  const loan = { reference: 'LOAN-APP12345', monthlyAmortization: 1000, perPayroll: 500, terms: 10, endDate: '2027-04-15' };
  const pdf = renderLoanApplicationPdf(app, { employee, loan, designation: 'Clerk', decidedBy: 'Hr Manager', verified: { name: 'Ver Ifier', title: 'HR Officer' }, approved: { name: 'Ap Prover', title: 'Manager' } }).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  for (const text of ['LOAN APPLICATION', 'SAMPLE, EMPLOYEE', 'Salary Loan', '5,000.00', 'House repair', 'Approved', '1,000.00', '500.00', 'LOAN-APP12345', 'November 16, 2026', 'authorize', 'Filed by', 'Verified by', 'Approved by']) assert.ok(pdf.includes(text), text);
});

test('a pending application prints as "Pending HR approval" without approved terms', () => {
  const pdf = renderLoanApplicationPdf({ id: 'a2', employeeId: 'EMP-001', type: 'Emergency Loan', amount: 3000, months: 3, purpose: 'Medical', status: 'pending', appliedAt: '2026-11-13T02:00:00Z' }, { employee }).toString('latin1');
  assert.ok(pdf.includes('Pending HR approval')); assert.ok(!pdf.includes('Per payroll deduction'));
});

test('HR (admin / hr / payroll) can open the record; the employee only their own', () => {
  const store = new Store(':memory:'); store.write(completeState());
  const emp = { id: 'u1', username: 'emp1', role: 'employee', employeeId: 'EMP-001' };
  const a = applyLoan(store, emp, { type: 'Salary Loan', amount: 5000, months: 5, purpose: 'House repair' });
  decideLoanApplication(store, admin, a.id, { decision: 'approve', approvedAmount: 5000, interest: 0, months: 5, startDate: '2026-11-16' });
  const record = loanApplicationRecord(store, admin, a.id);
  assert.equal(record.application.status, 'approved'); assert.equal(record.loan.perPayroll, 500); assert.equal(record.employee.id, 'EMP-001');
  assert.equal(loanApplicationRecord(store, emp, a.id).application.id, a.id, 'own application');
  assert.throws(() => loanApplicationRecord(store, { ...emp, employeeId: 'EMP-999' }, a.id), /not found/i, 'another employee');
  assert.throws(() => loanApplicationRecord(store, { id: 'v', username: 'v', role: 'viewer' }, a.id), /permission/);
});

test('HR may approve other terms than requested: the loan follows them and the employee is told what changed', () => {
  const store = new Store(':memory:'); store.write(completeState());
  const emp = { id: 'u1', username: 'emp1', role: 'employee', employeeId: 'EMP-001' };
  const a = applyLoan(store, emp, { type: 'Salary Loan', amount: 5000, months: 5, purpose: 'House repair' });
  const { loan } = decideLoanApplication(store, admin, a.id, { decision: 'approve', approvedAmount: 4000, interest: 0, months: 2, startDate: '2026-11-16' });
  assert.deepEqual([loan.original, loan.monthlyAmortization, loan.perPayroll, loan.terms], [4000, 2000, 1000, 4], 'the loan uses the approved terms');
  const notice = store.db.prepare("SELECT message FROM notifications WHERE employee_id='EMP-001' ORDER BY rowid DESC").get().message;
  assert.match(notice, /approved/i); assert.match(notice, /₱4,000\.00/); assert.match(notice, /2 months/); assert.match(notice, /₱1,000\.00 per payroll/);
  assert.match(notice, /HR changed/); assert.match(notice, /₱5,000\.00 → ₱4,000\.00/); assert.match(notice, /5 → 2 months/);
});

test('payment history keeps one running balance in date order and shows an overpayment below zero', async () => {
  const { loanDashboard } = await import('../src/loans.mjs');
  const store = new Store(':memory:'); const s = completeState();
  s.loans = [{ id: 'L1', employeeId: 'EMP-001', type: 'Salary Loan', reference: 'SL-1', original: 5000, balance: 0, monthlyAmortization: 0, perPayroll: 1000, startDate: '2026-10-01', endDate: '2026-10-15', terms: 5, remainingTerms: 0, authorized: true, interestTotal: 0, interestBalance: 0,
    priorPayments: ['2026-06-22', '2026-07-22', '2026-08-08', '2026-08-22', '2026-09-22', '2026-10-08'].map(date => ({ date, amount: 1000, note: 'Paid before the system' })) }];
  s.runs = [{ id: 'R1', status: 'posted', start: '2026-10-01', end: '2026-10-15', postedAt: '2026-10-20T00:00:00Z', rows: [{ employeeId: 'EMP-001', loanDeductions: [{ loanId: 'L1', amount: 1000, principal: 1000, interest: 0, remainingBalance: 0 }] }] }];
  store.write(s);
  const history = loanDashboard(store, admin).loans.find(l => l.id === 'L1').history;
  assert.deepEqual(history.map(h => h.paidOn), ['2026-06-22', '2026-07-22', '2026-08-08', '2026-08-22', '2026-09-22', '2026-10-08', '2026-10-22'], 'the Oct 1-15 payroll deduction is dated its salary day, Oct 22');
  assert.deepEqual(history.map(h => h.balanceAfter), [4000, 3000, 2000, 1000, 0, -1000, -2000], 'overpaid ₱2,000 in the end');
  assert.equal(loanDashboard(store, admin).loans[0].totalRepaid, 7000);
});
