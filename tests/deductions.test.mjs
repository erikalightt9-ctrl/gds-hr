import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { saveRecord, deleteRecord, preview } from '../src/service.mjs';
import { deductionApplies } from '../src/engine.mjs';
import { payslipFromRow } from '../src/portal.mjs';
import { completeState } from './helpers.mjs';

const hr = { username: 'hr1', role: 'hr' };
const base = extra => ({ id: 'd1', employeeId: 'EMP-001', name: 'Cash advance', amount: 500, schedule: 'every-cutoff', startDate: '2026-09-01', endDate: '', active: true, notes: '', ...extra });

test('company deductions follow their schedule', () => {
  const d = base();
  assert.equal(deductionApplies(d, '2026-09-01', '2026-09-15'), true);
  assert.equal(deductionApplies({ ...d, schedule: 'second-cutoff' }, '2026-09-01', '2026-09-15'), false);
  assert.equal(deductionApplies({ ...d, schedule: 'second-cutoff' }, '2026-09-16', '2026-09-30'), true);
  assert.equal(deductionApplies({ ...d, schedule: 'first-cutoff' }, '2026-09-16', '2026-09-30'), false);
  assert.equal(deductionApplies({ ...d, schedule: 'once', startDate: '2026-09-10' }, '2026-09-01', '2026-09-15'), true);
  assert.equal(deductionApplies({ ...d, schedule: 'once', startDate: '2026-09-10' }, '2026-09-16', '2026-09-30'), false);
  assert.equal(deductionApplies({ ...d, endDate: '2026-08-31' }, '2026-09-01', '2026-09-15'), false);
  assert.equal(deductionApplies({ ...d, startDate: '2026-10-01' }, '2026-09-01', '2026-09-15'), false);
});

test('HR adds, edits, pauses and removes a named deduction; payroll and payslip follow', () => {
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const before = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).rows[0];
    saveRecord(store, hr, 'deductions', base());
    let row = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).rows[0];
    assert.equal(row.deductions.other, before.deductions.other + 500);
    assert.equal(row.net, before.net - 500);
    const slip = payslipFromRow({ start: '2026-09-01', end: '2026-09-15', id: 'preview' }, row);
    assert.ok(slip.deductionItems.some(i => i.label === 'Cash advance' && i.amount === 500), 'printed under its own name');
    saveRecord(store, hr, 'deductions', base({ amount: 750 }));
    assert.equal(preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).rows[0].deductions.other, before.deductions.other + 750);
    saveRecord(store, hr, 'deductions', base({ active: false }));
    assert.equal(preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).rows[0].deductions.other, before.deductions.other);
    deleteRecord(store, hr, 'deductions', 'd1');
    assert.equal(store.read().deductions.length, 0);
    assert.throws(() => saveRecord(store, { username: 'v', role: 'viewer' }, 'deductions', base()), /permission/i);
    assert.throws(() => saveRecord(store, hr, 'deductions', base({ name: '' })));
  } finally { store.close(); }
});
