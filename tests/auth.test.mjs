import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { addUser, login, session, changePassword, checkLimit } from '../src/auth.mjs';

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
