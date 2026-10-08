import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';
import { addUser, login, signOutEverywhere } from '../src/auth.mjs';
import { createHash } from 'node:crypto';

const hash = t => createHash('sha256').update(t).digest('hex');

test('an account signed in on one device cannot sign in on another until signed out (admins exempt)', async () => {
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const admin = { username: 'boss', role: 'admin' };
    const emp = await addUser(store, { username: 'worker1', password: 'Worker-pass-2026!', role: 'employee', employeeId: 'EMP-001' }, admin);
    const first = await login(store, 'worker1', 'Worker-pass-2026!', 'k1');
    await assert.rejects(login(store, 'worker1', 'Worker-pass-2026!', 'k2'), /already signed in on another device/);
    const again = await login(store, 'worker1', 'Worker-pass-2026!', 'k3', '', { currentTokenHash: hash(first.token) });
    assert.ok(again.token, 'the same device may sign in again');
    assert.throws(() => signOutEverywhere(store, { username: 'x', role: 'employee' }, emp.id), /permission/i);
    assert.equal(signOutEverywhere(store, admin, emp.id).signedOut, 1);
    assert.ok((await login(store, 'worker1', 'Worker-pass-2026!', 'k4')).token, 'signs in on the new device after HR signs the old one out');
    await addUser(store, { username: 'boss2', password: 'Admin-pass-2026!!', role: 'admin' }, admin);
    await login(store, 'boss2', 'Admin-pass-2026!!', 'k5');
    assert.ok((await login(store, 'boss2', 'Admin-pass-2026!!', 'k6')).token, 'administrators are not limited');
  } finally { store.close(); }
});
