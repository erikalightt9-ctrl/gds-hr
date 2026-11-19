import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { addUser } from '../src/auth.mjs';
import { completeState, admin } from './helpers.mjs';
import { loginGate, finishPasskeyLogin, passkeyOptions, registerPasskey, myDevices, resetDevices, deviceHash, cborDecode, phoneCheck, setPhoneCheck, rememberDevice, fingerprintOptions, fingerprintSignIn } from '../src/devices.mjs';

const ORIGIN = 'https://hr.example.test', RP_ID = 'hr.example.test', rp = { origin: ORIGIN, rpId: RP_ID, rpName: 'Example HR' };
const b64u = b => Buffer.from(b).toString('base64url');

// ---- A simulated phone authenticator: a P-256 key, CBOR encoding and WebAuthn byte layouts. ----
function cbor(value) {
  const head = (major, n) => n < 24 ? Buffer.from([major << 5 | n]) : n < 256 ? Buffer.from([major << 5 | 24, n]) : Buffer.from([major << 5 | 25, n >> 8, n & 255]);
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') { const b = Buffer.from(value); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error('unsupported');
}
function phone({ uv = true } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }), credId = randomBytes(16);
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const flags = 0x01 | (uv ? 0x04 : 0);
  let counter = 0;
  const rpHash = createHash('sha256').update(RP_ID).digest();
  const count = () => { const b = Buffer.alloc(4); b.writeUInt32BE(++counter); return b; };
  return {
    create(options, origin = ORIGIN) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin }));
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([rpHash, Buffer.from([flags | 0x40]), count(), Buffer.alloc(16), len, credId, cose]);
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) } };
    },
    get(options, origin = ORIGIN) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin }));
      const authData = Buffer.concat([rpHash, Buffer.from([flags]), count()]);
      const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]), { key: privateKey, dsaEncoding: 'der' });
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) } };
    },
  };
}

async function setup() {
  const store = new Store(':memory:'); store.write(completeState());
  const user = await addUser(store, { username: 'emp1', password: 'employee-pass-123', role: 'employee', employeeId: 'EMP-001' }, admin);
  const row = store.db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  const actor = { id: row.id, username: row.username, role: row.role, employeeId: row.employee_id };
  setPhoneCheck(store, admin, true);
  return { store, row, actor };
}
const PHONE_A = deviceHash('a'.repeat(64)), PHONE_B = deviceHash('b'.repeat(64));

test('CBOR decoder reads maps, byte strings, text and negative numbers', () => {
  const v = cborDecode(cbor(new Map([['a', -7], [1, Buffer.from([1, 2])]]))).value;
  assert.equal(v.get('a'), -7); assert.deepEqual([...v.get(1)], [1, 2]);
});

test('the first phone an employee signs in on becomes the primary device', async () => {
  const { store, row, actor } = await setup();
  assert.deepEqual(loginGate(store, row, PHONE_A, rp), { allow: true });
  const devices = myDevices(store, actor).devices;
  assert.equal(devices.length, 1); assert.equal(devices[0].primary, true);
  assert.deepEqual(loginGate(store, row, PHONE_A, rp), { allow: true }, 'the same phone signs in again');
});

test('another phone is refused when no fingerprint is enrolled, and the attempt is reported', async () => {
  const { store, row } = await setup();
  loginGate(store, row, PHONE_A, rp);
  assert.throws(() => loginGate(store, row, PHONE_B, rp), /registered phone/);
  const notes = store.db.prepare('SELECT message FROM notifications').all().map(n => n.message).join(' ');
  assert.match(notes, /new phone/i);
});

test('with a fingerprint enrolled, another phone signs in only after fingerprint verification', async () => {
  const { store, row, actor } = await setup(), device = phone();
  loginGate(store, row, PHONE_A, rp);
  registerPasskey(store, actor, device.create(passkeyOptions(store, actor, rp)), rp);
  const gate = loginGate(store, row, PHONE_B, rp);
  assert.equal(gate.needsPasskey, true); assert.ok(gate.pendingToken); assert.equal(gate.options.userVerification, 'required');
  const user = finishPasskeyLogin(store, gate.pendingToken, device.get(gate.options), rp);
  assert.equal(user.id, row.id);
  assert.deepEqual(loginGate(store, row, PHONE_B, rp), { allow: true }, 'the new phone is now recognised');
  assert.equal(myDevices(store, actor).devices.length, 2);
  assert.throws(() => finishPasskeyLogin(store, gate.pendingToken, device.get(gate.options), rp), /expired|not found/i, 'a sign-in challenge works once');
});

test('verification fails for another key, another site, or no fingerprint (user verification)', async () => {
  const { store, row, actor } = await setup(), device = phone();
  loginGate(store, row, PHONE_A, rp);
  registerPasskey(store, actor, device.create(passkeyOptions(store, actor, rp)), rp);
  const stranger = phone();
  let gate = loginGate(store, row, PHONE_B, rp);
  assert.throws(() => finishPasskeyLogin(store, gate.pendingToken, { ...stranger.get(gate.options), id: device.get(gate.options).id, rawId: device.get(gate.options).rawId }, rp), /could not be verified/i);
  gate = loginGate(store, row, PHONE_B, rp);
  assert.throws(() => finishPasskeyLogin(store, gate.pendingToken, device.get(gate.options, 'https://evil.example'), rp), /could not be verified/i);
  assert.throws(() => registerPasskey(store, actor, phone({ uv: false }).create(passkeyOptions(store, actor, rp)), rp), /fingerprint|verification/i);
});

test('HR and admin accounts are not limited to registered phones', async () => {
  const { store } = await setup();
  const hr = await addUser(store, { username: 'hr1', password: 'hr-password-123', role: 'hr' }, admin);
  const row = store.db.prepare('SELECT * FROM users WHERE id=?').get(hr.id);
  assert.deepEqual(loginGate(store, row, PHONE_A, rp), { allow: true });
  assert.deepEqual(loginGate(store, row, PHONE_B, rp), { allow: true });
});

test('an administrator can reset an employee\'s phones (lost phone without a synced fingerprint)', async () => {
  const { store, row, actor } = await setup();
  loginGate(store, row, PHONE_A, rp);
  resetDevices(store, admin, row.id);
  assert.equal(myDevices(store, actor).devices.length, 0);
  assert.deepEqual(loginGate(store, row, PHONE_B, rp), { allow: true }, 'the next phone becomes the new primary');
  assert.throws(() => resetDevices(store, actor, row.id), /permission|not allowed|Forbidden/i);
});

test('the phone check is off until an administrator turns it on: phones are only remembered', async () => {
  const store = new Store(':memory:'); store.write(completeState());
  const user = await addUser(store, { username: 'emp2', password: 'employee-pass-123', role: 'employee', employeeId: 'EMP-001' }, admin);
  const row = store.db.prepare('SELECT * FROM users WHERE id=?').get(user.id), actor = { id: row.id, username: row.username, role: 'employee' };
  assert.equal(phoneCheck(store).enforce, false, 'off by default');
  assert.deepEqual(loginGate(store, row, PHONE_A, rp), { allow: true });
  assert.deepEqual(loginGate(store, row, PHONE_B, rp), { allow: true }, 'another phone is let in while off');
  assert.deepEqual(myDevices(store, actor).devices.map(d => d.primary), [true, false], 'both remembered; the first is the registered phone');
  assert.throws(() => setPhoneCheck(store, actor, true), /permission/);
  setPhoneCheck(store, admin, true);
  assert.deepEqual(loginGate(store, row, PHONE_B, rp), { allow: true }, 'phones remembered while off stay recognised');
  assert.throws(() => loginGate(store, row, deviceHash('d'.repeat(64)), rp), /registered phone/);
});

test('a phone already signed in (before phones were recorded) is remembered when the employee opens the list', async () => {
  const { store, row, actor } = await setup();
  assert.equal(myDevices(store, actor).devices.length, 0);
  assert.equal(rememberDevice(store, actor, PHONE_A, 'Mozilla/5.0 (Linux; Android 14)'), true);
  assert.deepEqual(myDevices(store, actor).devices.map(d => d.primary), [true], 'the first one becomes the registered phone');
  assert.equal(rememberDevice(store, actor, PHONE_A), false, 'the same phone is not added twice');
  assert.equal(rememberDevice(store, actor, PHONE_B), false, 'with the check on, another phone is not added this way');
  assert.deepEqual(loginGate(store, row, PHONE_A, rp), { allow: true }, 'the remembered phone signs in');
  assert.equal(rememberDevice(store, { ...actor, role: 'hr' }, PHONE_B), false, 'HR accounts are not recorded');
});

// ---- Fingerprint sign-in from the login screen (no password) ----
async function enrolled() {
  const { store, row, actor } = await setup(), device = phone();
  loginGate(store, row, PHONE_A, rp);
  registerPasskey(store, actor, device.create(passkeyOptions(store, actor, rp)), rp);
  return { store, row, actor, device };
}

test('an employee signs in with the fingerprint alone, without typing a username or password', async () => {
  const { store, row, device } = await enrolled();
  const start = fingerprintOptions(store, PHONE_A, rp, 'Android');
  assert.ok(start.token); assert.equal(start.options.userVerification, 'required'); assert.deepEqual(start.options.allowCredentials, []);
  const user = fingerprintSignIn(store, start.token, device.get(start.options), rp);
  assert.equal(user.id, row.id);
  assert.throws(() => fingerprintSignIn(store, start.token, device.get(start.options), rp), /expired|not found/i, 'a challenge works once');
  assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE action='fingerprint-sign-in'").get(), 'audited');
});

test('fingerprint sign-in on another phone adds that phone, even with the phone check on', async () => {
  const { store, row, actor, device } = await enrolled();
  const start = fingerprintOptions(store, PHONE_B, rp, 'Mozilla/5.0 (Linux; Android 14)');
  fingerprintSignIn(store, start.token, device.get(start.options), rp);
  assert.equal(myDevices(store, actor).devices.length, 2);
  assert.deepEqual(loginGate(store, row, PHONE_B, rp), { allow: true });
});

test('fingerprint sign-in is refused for an unknown key, another site, a disabled account or a non-employee', async () => {
  const { store, row, device } = await enrolled();
  let start = fingerprintOptions(store, PHONE_A, rp);
  assert.throws(() => fingerprintSignIn(store, start.token, phone().get(start.options), rp), /not recognised|could not be verified/i);
  start = fingerprintOptions(store, PHONE_A, rp);
  assert.throws(() => fingerprintSignIn(store, start.token, device.get(start.options, 'https://evil.example'), rp), /could not be verified/i);
  store.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(row.id);
  start = fingerprintOptions(store, PHONE_A, rp);
  assert.throws(() => fingerprintSignIn(store, start.token, device.get(start.options), rp), /disabled|not recognised/i);
  store.db.prepare("UPDATE users SET disabled=0, role='hr' WHERE id=?").run(row.id);
  start = fingerprintOptions(store, PHONE_A, rp);
  assert.throws(() => fingerprintSignIn(store, start.token, device.get(start.options), rp), /employee/i);
});
