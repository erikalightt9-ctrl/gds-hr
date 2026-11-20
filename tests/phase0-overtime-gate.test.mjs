import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { decideOvertime, fileOvertime, overtimeQueue } from '../src/overtime.mjs';
import { completeState } from './helpers.mjs';

const worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
const hr = { id: 'hr-1', username: 'hr1', role: 'hr', displayName: 'Salustiana Tower' };
const day = '2026-09-01';
function fixture(change = () => {}) {
  const store = new Store(':memory:'), state = completeState();
  state.loans = [];
  delete state.rules[0].overtimeApproval;
  change(state);
  store.write(state);
  return store;
}

test('overtime approval is blocked without approved attendance or payable hours unless an override reason is recorded', () => {
  const store = fixture(s => { s.attendance.find(a => a.date === day).approved = false; });
  try {
    const pending = fileOvertime(store, worker, { date: day, startTime: '17:00', endTime: '19:00', reason: 'Closing (demo)' });
    const kept = JSON.stringify(pending);
    assert.throws(() => decideOvertime(store, hr, pending.id, { decision: 'approve' }), /not approved/);
    assert.throws(() => decideOvertime(store, hr, pending.id, { decision: 'approve', overrideReason: '  ' }), /override needs a written reason/);
    assert.equal(JSON.stringify(store.db.prepare('SELECT data FROM overtime_requests WHERE id=?').get(pending.id) && JSON.parse(store.db.prepare('SELECT data FROM overtime_requests WHERE id=?').get(pending.id).data)), kept);
    const approved = decideOvertime(store, hr, pending.id, { decision: 'approve', overrideReason: 'Supervisor confirmed the attendance correction is in progress (demo)' });
    assert.equal(approved.overrideReason, 'Supervisor confirmed the attendance correction is in progress (demo)');
    assert.equal(approved.overrideBy, 'hr1');
    assert.equal(approved.overrideByName, 'Salustiana Tower');
    const audit = store.audit().find(a => a.action === 'approve' && a.kind === 'overtime');
    assert.match(JSON.stringify(audit.after), /Supervisor confirmed/);
    assert.equal(audit.actorName, 'Salustiana Tower');
    const queued = overtimeQueue(store, hr).find(o => o.id === pending.id);
    assert.equal(queued.attendanceId, `a-${day}`);
    assert.equal(queued.attendanceApproved, false);
    const none = fileOvertime(store, worker, { date: '2026-08-14', startTime: '17:00', endTime: '18:00', reason: 'Still no record (demo)' });
    assert.equal(overtimeQueue(store, hr).find(o => o.id === none.id).attendanceId, null);
    assert.throws(() => decideOvertime(store, hr, none.id, { decision: 'approve' }), /not approved|Payable hours are 0/);
  } finally { store.close(); }
});

test('approving more hours than are payable is blocked without an override, and an existing decision is left untouched', () => {
  const store = fixture(s => { s.attendance.find(a => a.date === day).timeOut = '17:30'; });
  try {
    const filing = fileOvertime(store, worker, { date: day, startTime: '16:00', endTime: '19:00', reason: 'Event (demo)' });
    assert.throws(() => decideOvertime(store, hr, filing.id, { decision: 'approve' }), /less than the 3 h/);
    const original = { id: 'legacy-ot', employeeId: 'EMP-001', date: '2026-10-26', startTime: '17:00', endTime: '21:35', breakMinutes: 0, hours: 4.58, reason: 'Legacy filing', status: 'approved', approvedHours: 4.58, filedBy: 'employee1', filedAt: '2026-10-26T10:00:00.000Z', decidedBy: 'hr1', decidedAt: '2026-10-26T11:00:00.000Z', history: [] };
    store.db.prepare('INSERT INTO overtime_requests(id, employee_id, date, status, data) VALUES(?,?,?,?,?)').run(original.id, original.employeeId, original.date, original.status, JSON.stringify(original));
    const before = store.db.prepare('SELECT data FROM overtime_requests WHERE id=?').get(original.id).data;
    assert.equal(store.db.prepare('SELECT data FROM overtime_requests WHERE id=?').get(original.id).data, before);
    assert.match(before, /4\.58/);
  } finally { store.close(); }
});
