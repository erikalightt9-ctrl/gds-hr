import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { addUser } from '../src/auth.mjs';
import { completeState, admin } from './helpers.mjs';
import { setPhoneCheck } from '../src/devices.mjs';

test('HTTP: an employee\'s first phone is remembered; another phone without fingerprint sign-in is refused', async t => {
  const store = new Store(':memory:'); store.write(completeState());
  await addUser(store, { username: 'emp1', password: 'employee-pass-123', role: 'employee', employeeId: 'EMP-001' }, admin);
  setPhoneCheck(store, admin, true);
  const app = createApp({ store, origin: 'http://127.0.0.1:3400', setupToken: '' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const login = (cookie = '') => fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3400', Cookie: cookie }, body: JSON.stringify({ username: 'emp1', password: 'employee-pass-123' }) });
  const cookies = response => response.headers.getSetCookie().map(c => c.split(';')[0]);

  const first = await login();
  assert.equal(first.status, 200);
  const phoneA = cookies(first).find(c => c.startsWith('hr_device='));
  assert.ok(phoneA, 'a device cookie is set on the first sign-in');
  assert.match(first.headers.getSetCookie().find(c => c.startsWith('hr_device=')), /HttpOnly; SameSite=Strict; Max-Age=157680000/);

  assert.equal((await login(phoneA)).status, 200, 'the registered phone signs in again');
  const other = await login('hr_device=' + 'c'.repeat(64));
  assert.equal(other.status, 403, 'another phone is refused without fingerprint sign-in');
  assert.match((await other.json()).error, /registered on another phone/);
  const noCookie = await login();
  assert.equal(noCookie.status, 403, 'a browser with no device cookie is a new phone too');
  assert.ok(cookies(noCookie).some(c => c.startsWith('hr_device=')), 'it still receives a device cookie for later fingerprint sign-in');
});

test('HTTP: the login screen\'s fingerprint sign-in starts a challenge and refuses an unknown fingerprint', async t => {
  const store = new Store(':memory:'); store.write(completeState());
  const app = createApp({ store, origin: 'http://127.0.0.1:3400', setupToken: '' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`, headers = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3400' };
  const start = await fetch(`${base}/api/login/fingerprint/options`, { method: 'POST', headers, body: '{}' });
  assert.equal(start.status, 200);
  const body = await start.json();
  assert.ok(body.token); assert.equal(body.options.rpId, '127.0.0.1'); assert.equal(body.options.userVerification, 'required');
  assert.ok(start.headers.getSetCookie().some(c => c.startsWith('hr_device=')), 'the phone gets a device cookie');
  const credential = { id: 'unknown', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' } };
  const finish = await fetch(`${base}/api/login/fingerprint`, { method: 'POST', headers, body: JSON.stringify({ token: body.token, credential }) });
  assert.equal(finish.status, 401); assert.match((await finish.json()).error, /not recognised/);
  assert.ok(!finish.headers.getSetCookie().some(c => c.startsWith('hr_session=')), 'no session');
});
