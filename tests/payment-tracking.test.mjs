import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll, releasePayslips } from '../src/service.mjs';
import { applyLoan, decideLoanApplication, releaseLoan } from '../src/loans.mjs';
import { confirmRunPayment, confirmLoanPayment, paymentStage } from '../src/payment-tracking.mjs';
import { completeState, admin } from './helpers.mjs';

const fin = { username: 'fin1', role: 'viewer', finance: true }, payroll = { username: 'pay1', role: 'payroll' };
test('payroll: Approved → Released → Paid / Confirmed, each step by Finance with its record', () => {
  const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s);
  try {
    const p = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
    const run = postPayroll(store, admin, { start: p.start, end: p.end, pay13th: false, fingerprint: p.fingerprint, employeeIds: ['EMP-001'] });
    assert.equal(paymentStage(store.read().runs.find(r => r.id === run.id)), 'Approved');
    assert.throws(() => confirmRunPayment(store, fin, run.id, { date: '2026-09-22', note: 'Bank statement' }), /release first/);
    releasePayslips(store, fin, run.id, { reference: 'BATCH-77', date: '2026-09-22' });
    assert.equal(paymentStage(store.read().runs.find(r => r.id === run.id)), 'Released');
    assert.throws(() => confirmRunPayment(store, payroll, run.id, { date: '2026-09-22', note: 'Bank statement' }), /Finance/);
    assert.throws(() => confirmRunPayment(store, fin, run.id, { date: '2026-09-22', note: '' }), /confirmed/);
    confirmRunPayment(store, fin, run.id, { date: '2026-09-23', note: 'Bank statement, batch 77' });
    const r = store.read().runs.find(x => x.id === run.id);
    assert.deepEqual([paymentStage(r), r.paymentConfirmed.by], ['Paid / Confirmed', 'fin1']);
    assert.throws(() => confirmRunPayment(store, fin, run.id, { date: '2026-09-23', note: 'again' }), /already confirmed/);
  } finally { store.close(); }
});

test('loans: Approved → Released → Paid / Confirmed', () => {
  const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s);
  try {
    const app = applyLoan(store, { username: 'employee1', role: 'employee', employeeId: 'EMP-001' }, { type: 'Salary Loan', amount: 2000, months: 2, purpose: 'Repairs' });
    const { loan } = decideLoanApplication(store, { username: 'hr1', role: 'hr' }, app.id, { decision: 'approve', approvedAmount: 2000, months: 2, startDate: '2026-09-01' });
    assert.equal(paymentStage(loan), 'Approved');
    assert.throws(() => confirmLoanPayment(store, fin, loan.id, { date: '2026-09-02', note: 'Bank' }), /release first/);
    releaseLoan(store, fin, loan.id, { date: '2026-09-02', reference: 'BT-5' });
    const done = confirmLoanPayment(store, fin, loan.id, { date: '2026-09-03', note: 'Employee signed acknowledgment' });
    assert.equal(paymentStage(done), 'Paid / Confirmed');
  } finally { store.close(); }
});
