import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { addUser, login, session, changePassword, checkLimit, deleteUser } from '../src/auth.mjs';

test('password changes revoke sessions; bad passwords and expired cookies cannot authenticate', async () => {
  const db = new Store(':memory:');
  try {
    const user = await addUser(db, { username: 'admin', password: 'initial-password-123', role: 'admin' });
    await assert.rejects(() => login(db, 'admin', 'incorrect', 'test'), /Incorrect/);
    await assert.rejects(() => login(db, 'missing', 'incorrect', 'test'), /Incorrect/);
    const signed = await login(db, 'admin', 'initial-password-123', 'test');
    assert.ok(session(db, `hr_session=${signed.token}`));
    assert.equal(session(db, 'hr_session=invalid'), null);
    await assert.rejects(() => changePassword(db, user, 'incorrect', 'replacement-pass-123'), /incorrect/);
    await assert.rejects(() => changePassword(db, user, 'initial-password-123', 'short'), /9–200/);
    await assert.rejects(() => changePassword(db, user, 'initial-password-123', 'eightch8'), /9–200/, '8 characters is too short');
    await changePassword(db, user, 'initial-password-123', 'replacement-pass-123');
    assert.equal(session(db, `hr_session=${signed.token}`), null);
    const again = await login(db, 'admin', 'replacement-pass-123', 'test');
    db.db.prepare('UPDATE sessions SET expires=0').run();
    assert.equal(session(db, `hr_session=${again.token}`), null);
    for (let i = 0; i < 10; i++) checkLimit(db, 'abusive-client');
    assert.throws(() => checkLimit(db, 'abusive-client'), /Too many/);
  } finally { db.close(); }
});

test('an admin can delete another login account after typing its username; the deletion is audited', async () => {
  const db = new Store(':memory:');
  try {
    const me = await addUser(db, { username: 'owner.admin', password: 'initial-password-123', role: 'admin' });
    const demo = await addUser(db, { username: 'demo.admin', password: 'demo-password-1234', role: 'admin' }, me);
    const signed = await login(db, 'demo.admin', 'demo-password-1234', 'test');
    assert.throws(() => deleteUser(db, me, me.id, 'owner.admin'), /own account/);
    assert.throws(() => deleteUser(db, me, demo.id, 'wrong'), /Type the account username/);
    assert.throws(() => deleteUser(db, { ...me, role: 'hr' }, demo.id, 'demo.admin'), /permission/);
    deleteUser(db, me, demo.id, 'DEMO.ADMIN');
    assert.equal(db.db.prepare('SELECT COUNT(*) n FROM users WHERE id=?').get(demo.id).n, 0);
    assert.equal(session(db, `hr_session=${signed.token}`), null, 'its sessions end');
    assert.equal(db.audit().find(a => a.action === 'delete-account').before.username, 'demo.admin');
    db.db.prepare('UPDATE users SET disabled=1 WHERE id<>?').run(me.id);
    const other = await addUser(db, { username: 'other.admin', password: 'other-password-1234', role: 'admin' }, me);
    db.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(me.id);
    assert.throws(() => deleteUser(db, me, other.id, 'other.admin'), /last enabled administrator/);
  } finally { db.close(); }
});

test('accounts for all registered employees: existing ones untouched, default password must be changed first', async () => {
  const { completeState } = await import('./helpers.mjs');
  const { createEmployeeAccounts } = await import('../src/auth.mjs');
  const db = new Store(':memory:');
  try {
    const s = completeState(); s.employees.push({ ...s.employees[0], id: 'EMP-002', name: 'Second Employee' }, { ...s.employees[0], id: 'EMP-003', name: 'Archived Employee', archived: true }); db.write(s);
    const me = await addUser(db, { username: 'owner.admin', password: 'initial-password-123', role: 'admin' });
    await addUser(db, { username: 'EMP-001', password: 'existing-password-1', role: 'employee', employeeId: 'EMP-001' }, me);
    await assert.rejects(() => createEmployeeAccounts(db, me, 'short'), /9–200/);
    await assert.rejects(() => createEmployeeAccounts(db, { ...me, role: 'hr' }, 'default-pass-123'), /permission/);
    const r = await createEmployeeAccounts(db, me, 'default-pass-123');
    assert.deepEqual(r.created.map(c => c.username), ['EMP-002']); assert.equal(r.alreadyHadAccount, 1);
    assert.equal((await createEmployeeAccounts(db, me, 'default-pass-123')).created.length, 0, 'running again creates nothing');
    const first = await login(db, 'EMP-002', 'default-pass-123', 'test');
    assert.equal(first.user.mustChangePassword, true);
    await changePassword(db, first.user, 'default-pass-123', 'my-own-password-99');
    assert.equal((await login(db, 'EMP-002', 'my-own-password-99', 'test')).user.mustChangePassword, false);
    assert.equal((await login(db, 'EMP-001', 'existing-password-1', 'test')).user.mustChangePassword, false, 'existing account unchanged');
    assert.ok(!JSON.stringify(db.audit()).includes('default-pass-123'), 'the password is never logged');
  } finally { db.close(); }
});
