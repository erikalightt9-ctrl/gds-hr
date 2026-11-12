import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, saveRecord } from '../src/service.mjs';
import { completeState, admin } from './helpers.mjs';

test('an offset day (hours worked on another day) is paid and counted present, not absent', () => {
  const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s);
  try {
    const day = store.read().attendance[0], run = () => preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).rows[0];
    const before = run();
    assert.throws(() => saveRecord(store, admin, 'attendance', { ...day, status: 'offset', timeIn: '', timeOut: '', explanation: '', correctionReason: 'Offset (demo)' }), /offset must say/);
    saveRecord(store, admin, 'attendance', { ...day, status: 'offset', timeIn: '', timeOut: '', explanation: 'Worked until 22:48 on Friday', correctionReason: 'Offset (demo)' });
    const after = run();
    assert.equal(after.daysPresent, before.daysPresent, 'still counted as a day present');
    assert.ok(!after.trace.some(t => t.date === day.date && t.component === 'absence'), 'no absence deduction');
    assert.ok(after.trace.some(t => t.date === day.date && /Offset \(Worked until 22:48 on Friday\)/.test(t.formula)));
  } finally { store.close(); }
});
