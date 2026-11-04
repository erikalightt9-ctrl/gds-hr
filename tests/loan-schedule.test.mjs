import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { saveRecord, preview } from '../src/service.mjs';
import { setLoanSchedule, setLoanSkips } from '../src/loans.mjs';
import { completeState, admin } from './helpers.mjs';

test('a loan used in posted payroll keeps its amounts, but its deduction schedule can change for future cutoffs', () => {
  const store = new Store(':memory:'), s = completeState();
  store.write(s);
  try {
    const loan = store.read().loans[0];
    // Pretend the loan was already deducted in a posted run.
    const state = store.read(); state.runs.push({ id: 'posted-1', status: 'posted', start: '2026-08-16', end: '2026-08-31', rows: [{ employeeId: loan.employeeId, loanDeductions: [{ loanId: loan.id, amount: loan.perPayroll }] }] }); store.write(state);
    assert.throws(() => saveRecord(store, admin, 'loans', { ...loan, perPayroll: loan.perPayroll + 1 }), /immutable/, 'amounts stay locked');
    assert.throws(() => setLoanSchedule(store, admin, loan.id, { deductOn: 'first', reason: '' }), /reason/);
    assert.equal(setLoanSchedule(store, admin, loan.id, { deductOn: 'first', reason: 'Deduct on the 22nd salary day only' }).deductOn, 'first');
    assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE action='change-loan-schedule'").get(), 'audited with the reason');
    assert.doesNotThrow(() => setLoanSkips(store, admin, loan.id, { cutoffs: ['2026-10-01'] }), 'skipping a future cutoff is allowed too');
    const clean = store.read(); clean.runs = clean.runs.filter(r => r.id !== 'posted-1'); store.write(clean);   // the stand-in run is not a full payroll
    const second = preview(store, '2026-09-16', '2026-09-30', false, [loan.employeeId]).rows[0];
    assert.ok(!second.loanDeductions.some(l => l.loanId === loan.id), 'not deducted in a 16th-end cutoff');
    assert.ok(second.trace.some(t => /deducted only in the 1st-15th cutoff/.test(t.formula)));
  } finally { store.close(); }
});
