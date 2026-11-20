import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { postPayroll, preview } from '../src/service.mjs';
import { setPayrollStage } from '../src/payroll-stages.mjs';
import { adjustOvertime, decideOvertime, fileOvertime } from '../src/overtime.mjs';
import { completeState, admin } from './helpers.mjs';

const worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
const hr = { id: 'hr-1', username: 'hr1', role: 'hr', displayName: 'Salustiana Tower' };
const day = '2026-09-01';

test('an overtime decision change needs a reason, and inclusion locks the original row', () => {
  const store = new Store(':memory:');
  try {
    const state = completeState();
    state.loans = [];
    delete state.rules[0].overtimeApproval;
    state.attendance.find(a => a.date === day).timeOut = '19:00';
    store.write(state);
    const filing = fileOvertime(store, worker, { date: day, startTime: '17:00', endTime: '19:00', reason: 'Closing (demo)' });
    assert.throws(() => decideOvertime(store, hr, filing.id, { decision: 'approve' }), /reason for changing/);
    const approved = decideOvertime(store, hr, filing.id, { decision: 'approve', reason: 'Work was authorised (demo)' });
    assert.equal(approved.decisionReason, 'Work was authorised (demo)');
    const decided = store.audit().find(a => a.action === 'approve' && a.recordId === 'EMP-001');
    assert.equal(decided.before.status, 'pending');
    assert.equal(decided.after.status, 'approved');
    assert.equal(decided.after.decisionReason, 'Work was authorised (demo)');
    assert.equal(decided.actor, 'hr1');
    assert.equal(decided.actorName, 'Salustiana Tower');
    assert.ok(decided.at);
    const seen = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
    const posted = postPayroll(store, admin, { start: seen.start, end: seen.end, pay13th: false, fingerprint: seen.fingerprint, employeeIds: ['EMP-001'] });
    setPayrollStage(store, admin, posted.id, 'approved');
    setPayrollStage(store, admin, posted.id, 'included');
    const before = store.db.prepare('SELECT data FROM overtime_requests WHERE id=?').get(filing.id).data;
    assert.throws(() => decideOvertime(store, hr, filing.id, { decision: 'reject', remarks: 'Changed our mind (demo)', reason: 'Changed our mind (demo)' }), /locked/);
    assert.equal(store.db.prepare('SELECT data FROM overtime_requests WHERE id=?').get(filing.id).data, before);
    const adjustment = adjustOvertime(store, hr, filing.id, { hours: 1, reason: 'Only one hour should have been included (demo)' });
    assert.equal(adjustment.adjustsId, filing.id);
    assert.equal(adjustment.status, 'pending');
    assert.notEqual(adjustment.id, filing.id);
    assert.equal(store.db.prepare('SELECT data FROM overtime_requests WHERE id=?').get(filing.id).data, before);
    const logged = store.audit().find(a => a.action === 'adjust');
    assert.equal(logged.after.reason, 'Only one hour should have been included (demo)');
    assert.equal(logged.actorName, 'Salustiana Tower');
    assert.equal(logged.before.status, 'approved');
  } finally { store.close(); }
});
