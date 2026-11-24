import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { reviewLeave } from '../src/service.mjs';
import { addUser } from '../src/auth.mjs';
import { completeState } from './helpers.mjs';

// Leave approval chain (Nov 24, 2026): Supervisor (staffing) → HR verification → approver.
async function fixture({ supervisor = true } = {}) {
  const store = new Store(':memory:'), s = completeState();
  s.employees.push({ ...s.employees[0], id: 'SUP-1', name: 'Boss, Team' });
  s.leaves = [{ id: 'lv1', employeeId: 'EMP-001', typeId: 'unpaid', startDate: '2026-09-21', endDate: '2026-09-21', days: 1, reason: 'Family', documentReference: '', status: 'pending', eligibilityVerified: false }];
  store.write(s);
  const admin = await addUser(store, { username: 'admin', password: 'initial-password-123', role: 'admin' });
  if (supervisor) await addUser(store, { username: 'team.boss', password: 'initial-password-123', role: 'dept_manager', employeeId: 'SUP-1' }, { id: admin.id, username: 'admin', role: 'admin' });
  return store;
}
const leave = store => store.read().leaves.find(l => l.id === 'lv1');
const boss = { username: 'team.boss', role: 'dept_manager', employeeId: 'SUP-1' }, staff = { username: 'hr.staff', role: 'hr_staff' }, head = { username: 'hr.head', role: 'hr' };

test('leave passes Supervisor, HR verification and approval in order, each recorded', async () => {
  const store = await fixture();
  try {
    assert.throws(() => reviewLeave(store, staff, 'lv1', { decision: 'approve' }), /Waiting for Supervisor/);
    reviewLeave(store, boss, 'lv1', { decision: 'approve', remarks: 'Team covered' });
    assert.deepEqual([leave(store).status, leave(store).approvals.map(a => a.decision)], ['pending', ['endorsed']]);
    assert.throws(() => reviewLeave(store, boss, 'lv1', { decision: 'approve' }), /Waiting for HR verification/);
    reviewLeave(store, staff, 'lv1', { decision: 'approve' });
    assert.equal(leave(store).status, 'pending', 'HR Staff verifies; the approver decides');
    reviewLeave(store, head, 'lv1', { decision: 'approve' });
    assert.deepEqual([leave(store).status, leave(store).approvals.map(a => `${a.step}:${a.decision}:${a.by}`)], ['approved', ['supervisor:endorsed:team.boss', 'verify:verified:hr.staff', 'approve:approved:hr.head']]);
  } finally { store.close(); }
});

test('no Supervisor: the step is skipped; one Company Admin verifies and approves at once (as before)', async () => {
  const store = await fixture({ supervisor: false });
  try {
    reviewLeave(store, head, 'lv1', { decision: 'approve' });
    assert.deepEqual(leave(store).approvals.map(a => a.decision), ['skipped', 'verified', 'approved']);
    assert.equal(leave(store).status, 'approved');
  } finally { store.close(); }
});

test('a Company Admin may decide before a waiting Supervisor only with a reason; rejection needs a reason', async () => {
  const store = await fixture();
  try {
    assert.throws(() => reviewLeave(store, head, 'lv1', { decision: 'approve' }), /Supervisor's check \(team\.boss\)/);
    reviewLeave(store, head, 'lv1', { decision: 'approve', remarks: 'Supervisor on leave; staffing confirmed by phone' });
    assert.deepEqual(leave(store).approvals.map(a => a.decision), ['overridden', 'verified', 'approved']);
    const s2 = await fixture();
    assert.throws(() => reviewLeave(s2, boss, 'lv1', { decision: 'reject' }), /reason/);
    reviewLeave(s2, boss, 'lv1', { decision: 'reject', remarks: 'Two others are on leave that day' });
    assert.equal(leave(s2).status, 'rejected');
    s2.close();
  } finally { store.close(); }
});

test('My approvals lists what waits for each person\'s step', async () => {
  const { inbox } = await import('../src/approval-chain.mjs');
  const store = await fixture();
  try {
    assert.deepEqual(inbox(store, boss).map(i => [i.id, i.stage, i.ownStep]), [['lv1', 'supervisor', true]]);
    assert.deepEqual(inbox(store, staff), [], 'HR Staff waits for the Supervisor');
    assert.deepEqual(inbox(store, head).map(i => [i.stage, i.ownStep]), [['supervisor', false]], 'the Company Admin sees it and may decide with a reason');
    reviewLeave(store, boss, 'lv1', { decision: 'approve' });
    assert.deepEqual(inbox(store, staff).map(i => i.stage), ['verify']);
    assert.deepEqual(inbox(store, boss), []);
  } finally { store.close(); }
});

test('overtime: the Supervisor approves the work, then HR decides the hours', async () => {
  const { fileOvertime, decideOvertime } = await import('../src/overtime.mjs');
  const store = await fixture();
  const worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
  try {
    const o = fileOvertime(store, worker, { date: '2026-09-02', startTime: '16:00', endTime: '18:00', reason: 'Month-end close (demo)' });
    assert.throws(() => decideOvertime(store, head, o.id, { decision: 'approve' }), /Supervisor's check/);
    const endorsed = decideOvertime(store, boss, o.id, { decision: 'approve', remarks: 'Needed for the close' });
    assert.deepEqual([endorsed.status, endorsed.approvals.map(a => a.decision)], ['pending', ['endorsed']]);
    assert.throws(() => decideOvertime(store, boss, o.id, { decision: 'approve' }), /Waiting for Approval/);
    const done = decideOvertime(store, head, o.id, { decision: 'approve', overrideReason: 'Attendance to be approved later (test)' });
    assert.deepEqual([done.status, done.approvals.map(a => a.decision)], ['approved', ['endorsed', 'approved']]);
  } finally { store.close(); }
});
