import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { calculatePayroll } from '../src/engine.mjs';
import { setLoanSkips } from '../src/loans.mjs';
import { saveRecord } from '../src/service.mjs';

function fixture() { const store = new Store(':memory:'); store.write(completeState()); return store; }

test('a loan is not deducted on a cutoff the employee asked to skip, and is deducted again after', () => {
  const store = fixture();
  try {
    const row = () => calculatePayroll(store.read(), '2026-09-16', '2026-09-30').rows.find(r => r.employeeId === 'EMP-001');
    assert.equal(row().deductions.loans, 1200, 'deducted normally');
    setLoanSkips(store, admin, 'loan1', { cutoffs: ['2026-09-16'] });
    assert.equal(row().deductions.loans, 0, 'skipped this cutoff');
    assert.ok(row().trace.some(t => /skipped at the employee's request/.test(t.formula)));
    assert.equal(calculatePayroll(store.read(), '2026-10-01', '2026-10-15').rows.find(r => r.employeeId === 'EMP-001').deductions.loans, 1200, 'next cutoff deducts');
    assert.throws(() => setLoanSkips(store, admin, 'loan1', { cutoffs: ['2026-09-20'] }), /1st or the 16th/);
    assert.throws(() => setLoanSkips(store, { username: 'v', role: 'viewer' }, 'loan1', { cutoffs: [] }), /permission/i);
  } finally { store.close(); }
});

test('a loan without a monthly amortization deducts the per-payroll amount; a loan date can be recorded', () => {
  const store = fixture();
  try {
    const loan = store.read().loans[0];
    saveRecord(store, admin, 'loans', { ...loan, monthlyAmortization: 0, loanDate: '2026-08-10', balance: 5000 }, { trusted: true });
    const r = calculatePayroll(store.read(), '2026-09-16', '2026-09-30').rows.find(x => x.employeeId === 'EMP-001');
    assert.equal(r.deductions.loans, 2500);
    assert.equal(store.read().loans[0].loanDate, '2026-08-10');
  } finally { store.close(); }
});
