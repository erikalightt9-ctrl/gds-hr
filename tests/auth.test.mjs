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
    await assert.rejects(() => changePassword(db, user, 'initial-password-123', 'short'), /12/);
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
