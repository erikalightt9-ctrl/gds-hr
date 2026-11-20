import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { login, passwordHash } from '../src/auth.mjs';
import { assertNamedActor, authenticateService, createServiceAccount, getPolicy, namedActorProblem, savePolicy } from '../src/actors.mjs';
import { decideOvertime, fileOvertime } from '../src/overtime.mjs';
import { completeState } from './helpers.mjs';

const admin = { id: 'admin-1', username: 'admin', role: 'admin', displayName: 'Erika Hernando' };

test('a service account cannot sign in as System Administrator and is attributed by name', async () => {
  const store = new Store(':memory:');
  try {
    store.db.prepare("INSERT INTO audit(id, at, actor, action, kind, record_id, before_json, after_json) VALUES('old', '2026-11-10T01:21:00.000Z', 'GDS Capital Inc', 'approve', 'datasheets', 'sheet-1', NULL, NULL)").run();
    const created = await createServiceAccount(store, admin, { name: 'TimeHub AI', integration: 'Claude', permissions: ['overtime'] }, passwordHash);
    assert.equal(created.role, 'service');
    assert.equal(store.db.prepare('SELECT role FROM users WHERE id=?').get(created.id).role, 'service');
    assert.notEqual(created.role, 'admin');
    const audit = store.audit().find(a => a.kind === 'service-account');
    assert.equal(audit.actor, 'admin');
    assert.equal(audit.actorName, 'Erika Hernando');
    assert.equal(JSON.stringify(audit).includes(created.token), false);
    await assert.rejects(() => login(store, created.username, 'not-the-token-password', 'login:test'), /cannot sign in/);
    const actor = authenticateService(store, created.token);
    assert.equal(actor.role, 'service');
    assert.equal(actor.displayName, 'TimeHub AI');
    assert.equal(actor.via, 'Claude');
    assert.deepEqual(actor.permissions, ['overtime']);
    assert.equal(authenticateService(store, `${created.token}nope`), null);
    assert.equal(namedActorProblem(actor, getPolicy(store), 'rules'), 'This service account is not allowed to do that. Its permissions are limited to what management authorized.');
    assert.equal(namedActorProblem(actor, getPolicy(store), 'overtime'), '');
    store.log(actor, 'approve', 'overtime', 'ot-1', { status: 'pending' }, { status: 'approved' });
    const step = store.audit().find(a => a.recordId === 'ot-1');
    assert.equal(step.actor, created.username);
    assert.equal(step.actorName, 'TimeHub AI');
    assert.equal(step.via, 'Claude');
    assert.notEqual(step.actor, 'GDS Capital Inc');
    const preserved = store.audit().find(a => a.id === 'old');
    assert.equal(preserved.actor, 'GDS Capital Inc');
    assert.equal(preserved.action, 'approve');
    assert.equal(preserved.actorName, '');
  } finally { store.close(); }
});

test('routine approval refuses the shared admin login and a system slug, and keeps the matrix configurable', () => {
  const store = new Store(':memory:');
  try {
    const policy = getPolicy(store);
    assert.match(policy.openDecisions.join(' '), /Management has not confirmed/);
    const shared = { username: 'GDS Capital Inc', role: 'admin' };
    assert.match(namedActorProblem(shared, policy, 'overtime'), /shared admin login/);
    const slug = { username: 'contribution-timing-update', role: 'admin' };
    assert.match(namedActorProblem(slug, policy, 'rules'), /named person/);
    assert.doesNotThrow(() => assertNamedActor({ username: 'hr1', role: 'hr', displayName: 'Salustiana Tower' }, policy, 'overtime'));
    const saved = savePolicy(store, admin, { matrix: { ...policy.matrix, overtime: { roles: ['hr'], usernames: ['salustiana'] } }, sharedAdminNames: ['GDS Capital Inc'] });
    assert.deepEqual(saved.matrix.overtime, { roles: ['hr'], usernames: ['salustiana'] });
    assert.match(namedActorProblem({ username: 'admin', role: 'admin', displayName: 'Erika Hernando' }, saved, 'overtime'), /not on the approval list/);
    assert.equal(namedActorProblem({ username: 'salustiana', role: 'employee', displayName: 'Salustiana Tower' }, saved, 'overtime'), '');
    assert.equal(store.audit().some(a => a.kind === 'approval-policy' && a.actorName === 'Erika Hernando'), true);
  } finally { store.close(); }
});

test('an overtime decision is stored against the named approver, not the shared admin label', () => {
  const store = new Store(':memory:');
  const state = completeState();
  state.loans = [];
  store.write(state);
  const worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
  const hr = { id: 'hr-1', username: 'hr1', role: 'hr', displayName: 'Salustiana Tower' };
  try {
    const filing = fileOvertime(store, worker, { date: '2026-09-02', startTime: '17:00', endTime: '18:00', reason: 'Close the books (demo)' });
    assert.throws(() => decideOvertime(store, { username: 'GDS Capital Inc', role: 'admin' }, filing.id, { decision: 'reject', remarks: 'Not this login' }), /shared admin/);
    decideOvertime(store, hr, filing.id, { decision: 'reject', remarks: 'Not authorised (demo)' });
    const row = store.audit().find(a => a.kind === 'overtime' && a.action === 'reject');
    assert.equal(row.actor, 'hr1');
    assert.equal(row.actorName, 'Salustiana Tower');
    assert.equal(row.actorUserId, 'hr-1');
    assert.notEqual(row.actor, 'GDS Capital Inc');
  } finally { store.close(); }
});
