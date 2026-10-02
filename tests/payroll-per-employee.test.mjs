import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { calculatePayroll, dates, isRest } from '../src/engine.mjs';
import { preview, postPayroll } from '../src/service.mjs';

// Two employees; only EMP-001 has attendance, so an all-employee run is blocked.
function fixture() {
  const store = new Store(':memory:');
  const state = completeState();
  state.employees.push({ ...state.employees[0], id: 'EMP-002', name: 'Second Employee' });
  store.write(state);
  return store;
}

test('payroll can be calculated for one employee', () => {
  const store = fixture();
  try {
    const all = preview(store, '2026-09-01', '2026-09-15');
    assert.equal(all.rows.length, 2);
    assert.ok(all.blockers.some(b => b.includes('EMP-002')), 'control: missing attendance blocks the whole run');
    const one = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
    assert.deepEqual(one.rows.map(r => r.employeeId), ['EMP-001']);
    assert.deepEqual(one.employeeIds, ['EMP-001']);
    assert.ok(!one.blockers.some(b => b.includes('EMP-002')), 'other employees do not block this run');
    assert.notEqual(one.fingerprint, all.fingerprint);
    assert.ok(calculatePayroll(store.read(), '2026-09-01', '2026-09-15', false, ['NOPE']).blockers.some(b => /No employees/.test(b)));
  } finally { store.close(); }
});

test('one employee can be posted, then the rest of the same cutoff later, never twice', () => {
  const store = fixture();
  try {
    const one = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
    const run = postPayroll(store, admin, { start: one.start, end: one.end, pay13th: false, fingerprint: one.fingerprint, employeeIds: ['EMP-001'] });
    assert.equal(run.rows.length, 1);
    assert.deepEqual(run.employeeIds, ['EMP-001']);
    assert.ok(preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).blockers.some(b => /overlaps a posted payroll/.test(b)), 'cannot pay the same person twice');
    const state = store.read();
    for (const d of dates('2026-09-01', '2026-09-15').filter(d => !isRest(state.employees[1], d))) state.attendance.push({ ...state.attendance.find(a => a.employeeId === 'EMP-001'), id: `b-${d}`, employeeId: 'EMP-002', date: d });
    store.write(state);
    const second = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-002']);
    assert.deepEqual(second.blockers, [], 'the second employee posts separately');
    assert.throws(() => postPayroll(store, admin, { start: second.start, end: second.end, pay13th: false, fingerprint: second.fingerprint, employeeIds: ['EMP-001'] }), /changed after preview/, 'fingerprint is tied to the chosen employees');
  } finally { store.close(); }
});
