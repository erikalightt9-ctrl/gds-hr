import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { addUser, login } from '../src/auth.mjs';
import { approvalMatrix, usersAndRoles } from '../src/access-matrix.mjs';
import { completeState } from './helpers.mjs';

test('two-factor sign-in is required for HR, Payroll and Management accounts; the matrix and roles screens read the enforced rules', async () => {
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const admin = await addUser(store, { username: 'boss.admin', password: 'Fictional-pass-123', role: 'admin' });
    for (const [username, role] of [['hr.one', 'hr'], ['pay.one', 'payroll'], ['mgmt.one', 'viewer']]) await addUser(store, { username, password: 'Fictional-pass-123', role }, admin);
    const signIn = async u => (await login(store, u, 'Fictional-pass-123', `t:${u}`)).user;
    assert.equal((await signIn('hr.one')).mfaRequired, true);
    assert.equal((await signIn('pay.one')).mfaRequired, true);
    assert.equal((await signIn('mgmt.one')).mfaRequired, true);
    assert.equal((await signIn('boss.admin')).mfaRequired, false, 'recommended, not forced, for Admin');
    process.env.HR_REQUIRE_MFA = 'off';
    assert.equal((await signIn('hr.one')).mfaRequired, false, 'switch for tests');
    delete process.env.HR_REQUIRE_MFA;
    assert.ok(approvalMatrix(store, { username: 'x', role: 'hr' }).some(r => r.action === 'Salary or rate change' && /Second person/.test(r.rule)));
    const roles = usersAndRoles(store, { username: 'x', role: 'admin' });
    assert.deepEqual(roles.find(r => r.role === 'hr'), { ...roles.find(r => r.role === 'hr'), accounts: 1, withMfa: 0, mfaRequired: true });
  } finally { store.close(); }
});

test('accounts: disable signs the person out and blocks sign-in; the last active Administrator cannot be disabled', async () => {
  const { setDisabled } = await import('../src/auth.mjs');
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const boss = await addUser(store, { username: 'only.admin', password: 'Fictional-pass-123', role: 'admin' });
    const staff = await addUser(store, { username: 'some.maker', password: 'Fictional-pass-123', role: 'maker' }, boss);
    const actor = { ...boss, username: 'only.admin', role: 'admin' };
    setDisabled(store, actor, staff.id, true);
    await assert.rejects(() => login(store, 'some.maker', 'Fictional-pass-123', 't:x'), /Incorrect|disabled/i);
    setDisabled(store, actor, staff.id, false);
    assert.ok((await login(store, 'some.maker', 'Fictional-pass-123', 't:y')).user);
    const second = await addUser(store, { username: 'other.admin', password: 'Fictional-pass-123', role: 'admin' }, boss);
    setDisabled(store, { ...second, role: 'admin' }, boss.id, true);
    assert.throws(() => setDisabled(store, actor, second.id, true), /last active System Administrator/);
  } finally { store.close(); }
});
