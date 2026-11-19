// Employee phones and fingerprint sign-in (WebAuthn passkeys).
//   - The first phone an employee signs in on becomes the primary device (recognised by a long-lived device cookie).
//   - Signing in from another phone needs the employee's fingerprint (a passkey with user verification). The phone's own
//     fingerprint sensor confirms the person; the server only ever sees a signature, never a fingerprint.
//   - No fingerprint enrolled = no access from another phone. Attempts are reported to the employee and HR.
//   - A replacement phone works without an HR request when the passkey is available there: synced by the phone's
//     account (Google Password Manager / iCloud Keychain) or used from the old phone by scanning the QR code shown.
//     A fingerprint stored only on a lost phone cannot be read remotely; an administrator can then reset the phones.
// HR, payroll and admin accounts are not limited to registered phones.
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { AppError, permit } from './service.mjs';

const CHALLENGE_MS = 5 * 60000;
const LIMITED_ROLES = ['employee'];
const sha256 = data => createHash('sha256').update(data).digest();
const fromB64u = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new AppError('The fingerprint response could not be verified.', 400); return Buffer.from(value, 'base64url'); };
export const deviceHash = token => sha256(String(token)).toString('hex');
export const newDeviceToken = () => randomBytes(32).toString('hex');
export function deviceTokenFromCookie(cookie = '') {
  const token = cookie.split(';').map(v => v.trim()).find(v => v.startsWith('hr_device='))?.slice(10);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : '';
}

const ready = new WeakSet();
function tables(store) {
  if (ready.has(store)) return;
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS user_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_hash TEXT NOT NULL, label TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, verified_by TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, UNIQUE(user_id, device_hash));
    CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, last_used TEXT);
    CREATE TABLE IF NOT EXISTS device_settings (id INTEGER PRIMARY KEY CHECK(id=1), enforce INTEGER NOT NULL DEFAULT 0, changed_by TEXT, changed_at TEXT);
    CREATE TABLE IF NOT EXISTS webauthn_challenges (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, challenge TEXT NOT NULL, device_hash TEXT, label TEXT, expires INTEGER NOT NULL);`);
  ready.add(store);
}
const deviceLabel = (ua = '') => /iPhone/i.test(ua) ? 'iPhone' : /iPad/i.test(ua) ? 'iPad' : /Android/i.test(ua) ? 'Android phone' : /Windows/i.test(ua) ? 'Windows computer' : /Macintosh/i.test(ua) ? 'Mac' : 'Device';

// ---------- CBOR (the subset WebAuthn uses) ----------
export function cborDecode(buf, start = 0) {
  let pos = start;
  const read = () => {
    const ib = buf[pos++], major = ib >> 5, ai = ib & 31;
    const n = () => {
      if (ai < 24) return ai;
      if (ai === 24) return buf[pos++];
      if (ai === 25) { const v = buf.readUInt16BE(pos); pos += 2; return v; }
      if (ai === 26) { const v = buf.readUInt32BE(pos); pos += 4; return v; }
      if (ai === 27) { const v = Number(buf.readBigUInt64BE(pos)); pos += 8; return v; }
      throw new AppError('The fingerprint response could not be verified.', 400);
    };
    if (major === 0) return n();
    if (major === 1) return -1 - n();
    if (major === 2) { const l = n(), v = buf.subarray(pos, pos + l); pos += l; return v; }
    if (major === 3) { const l = n(), v = buf.subarray(pos, pos + l).toString('utf8'); pos += l; return v; }
    if (major === 4) { const l = n(), v = []; for (let i = 0; i < l; i++) v.push(read()); return v; }
    if (major === 5) { const l = n(), v = new Map(); for (let i = 0; i < l; i++) { const k = read(); v.set(k, read()); } return v; }
    if (major === 7) return { 20: false, 21: true, 22: null }[ai] ?? null;
    throw new AppError('The fingerprint response could not be verified.', 400);
  };
  const value = read();
  return { value, length: pos - start };
}

// COSE public key → a Node key object + algorithm (ES256, RS256 or EdDSA).
function coseKey(map) {
  const kty = map.get(1), alg = map.get(3);
  if (kty === 2 && map.get(-1) === 1) return { alg: alg ?? -7, jwk: { kty: 'EC', crv: 'P-256', x: Buffer.from(map.get(-2)).toString('base64url'), y: Buffer.from(map.get(-3)).toString('base64url') } };
  if (kty === 3) return { alg: alg ?? -257, jwk: { kty: 'RSA', n: Buffer.from(map.get(-1)).toString('base64url'), e: Buffer.from(map.get(-2)).toString('base64url') } };
  if (kty === 1 && map.get(-1) === 6) return { alg: alg ?? -8, jwk: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(map.get(-2)).toString('base64url') } };
  throw new AppError('This phone uses a key type the system does not support.', 400);
}
function parseAuthData(data, rpId) {
  if (data.length < 37) throw new AppError('The fingerprint response could not be verified.', 400);
  const flags = data[32], signCount = data.readUInt32BE(33);
  if (!sha256(rpId).equals(data.subarray(0, 32))) throw new AppError('The fingerprint response could not be verified (wrong site).', 400);
  if (!(flags & 0x01)) throw new AppError('The fingerprint response could not be verified.', 400);
  if (!(flags & 0x04)) throw new AppError('The phone did not confirm your fingerprint (user verification). Use the fingerprint or screen lock to confirm.', 400);
  if (!(flags & 0x40)) return { flags, signCount };
  const idLength = data.readUInt16BE(53), credentialId = data.subarray(55, 55 + idLength), key = cborDecode(data, 55 + idLength).value;
  return { flags, signCount, credentialId, key: coseKey(key) };
}
function clientData(response, type, challenge, origin) {
  const json = fromB64u(response.clientDataJSON);
  let data; try { data = JSON.parse(json.toString('utf8')); } catch { throw new AppError('The fingerprint response could not be verified.', 400); }
  if (data.type !== type || data.challenge !== challenge || data.origin !== origin) throw new AppError('The fingerprint response could not be verified.', 400);
  return json;
}

// ---------- On / off (Settings → Phone & fingerprint sign-in; off until an administrator turns it on) ----------
// While off, phones are still recorded (the first one becomes the registered phone) but no phone is refused.
export function phoneCheck(store) {
  tables(store);
  const row = store.db.prepare('SELECT * FROM device_settings WHERE id=1').get();
  return { enforce: !!row?.enforce, changedBy: row?.changed_by || '', changedAt: row?.changed_at || '' };
}
export function setPhoneCheck(store, actor, enforce) {
  tables(store);
  permit(actor, ['admin']);
  const before = phoneCheck(store), at = new Date().toISOString();
  store.db.prepare('INSERT INTO device_settings(id, enforce, changed_by, changed_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET enforce=excluded.enforce, changed_by=excluded.changed_by, changed_at=excluded.changed_at').run(enforce ? 1 : 0, actor.username, at);
  store.log(actor, enforce ? 'turn-on-phone-check' : 'turn-off-phone-check', 'devices', 'settings', { enforce: before.enforce }, { enforce: !!enforce });
  return phoneCheck(store);
}

// ---------- Device recognition at sign-in ----------
// Called after the password (and two-factor code) are correct. Returns { allow: true } or a fingerprint challenge.
export function loginGate(store, user, hash, { rpId }, userAgent = '') {
  tables(store);
  if (!LIMITED_ROLES.includes(user.role)) return { allow: true };
  const now = new Date().toISOString(), devices = store.db.prepare('SELECT * FROM user_devices WHERE user_id=?').all(user.id);
  const known = devices.find(d => d.device_hash === hash);
  if (known) { store.db.prepare('UPDATE user_devices SET last_seen=? WHERE id=?').run(now, known.id); return { allow: true }; }
  if (!devices.length || !phoneCheck(store).enforce) {
    // Off: every phone is let in and remembered (the first one is the registered phone).
    store.db.prepare('INSERT INTO user_devices VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), user.id, hash, deviceLabel(userAgent), devices.length ? 0 : 1, devices.length ? 'sign-in (check off)' : 'first sign-in', now, now);
    if (!devices.length) store.log({ id: user.id, username: user.username, role: user.role }, 'register-primary-device', 'devices', user.id, null, { label: deviceLabel(userAgent) });
    return { allow: true };
  }
  const keys = store.db.prepare('SELECT id FROM passkeys WHERE user_id=?').all(user.id);
  if (!keys.length) {
    store.notify(user.employee_id, `A sign-in to your account from a new phone (${deviceLabel(userAgent)}) was blocked. Only your registered phone can sign in until you set up fingerprint sign-in.`);
    store.notify(null, `${user.employee_id || user.username}: sign-in from a new phone was blocked (no fingerprint enrolled).`);
    store.log({ id: user.id, username: user.username, role: user.role }, 'blocked-new-device', 'devices', user.id, null, { label: deviceLabel(userAgent) });
    throw new AppError('This account is registered on another phone. Sign in on your registered phone, or set up fingerprint sign-in there first (Account & security → Fingerprint sign-in).', 403);
  }
  const pendingToken = randomBytes(32).toString('hex'), challenge = randomBytes(32).toString('base64url');
  store.db.prepare('DELETE FROM webauthn_challenges WHERE expires < ?').run(Date.now());
  store.db.prepare('INSERT INTO webauthn_challenges VALUES(?,?,?,?,?,?,?)').run(pendingToken, user.id, 'login', challenge, hash, deviceLabel(userAgent), Date.now() + CHALLENGE_MS);
  return { needsPasskey: true, pendingToken, options: { challenge, rpId, timeout: CHALLENGE_MS, userVerification: 'required', allowCredentials: keys.map(k => ({ type: 'public-key', id: k.id })) } };
}

// Checks a fingerprint signature (navigator.credentials.get) against a stored passkey and records its use.
function verifyAssertion(store, key, credential, challenge, { origin, rpId }) {
  const response = credential?.response || {};
  const json = clientData(response, 'webauthn.get', challenge, origin), authData = fromB64u(response.authenticatorData);
  const parsed = parseAuthData(authData, rpId);
  const publicKey = createPublicKey({ key: JSON.parse(key.public_key), format: 'jwk' }), signed = Buffer.concat([authData, sha256(json)]);
  const ok = key.alg === -8 ? verify(null, signed, publicKey, fromB64u(response.signature)) : verify('sha256', signed, key.alg === -7 ? { key: publicKey, dsaEncoding: 'der' } : publicKey, fromB64u(response.signature));
  if (!ok) throw new AppError('The fingerprint response could not be verified.', 401);
  // A counter that goes backwards means a copied key (synced passkeys always report 0).
  if (key.sign_count && parsed.signCount && parsed.signCount <= key.sign_count) throw new AppError('The fingerprint response could not be verified (possible copied key). Contact HR.', 401);
  store.db.prepare('UPDATE passkeys SET sign_count=?, last_used=? WHERE id=?').run(parsed.signCount, new Date().toISOString(), key.id);
}

// ---------- Sign in with the fingerprint alone (login screen; employees) ----------
// The phone offers the passkeys it holds for this site; the employee picks one and confirms with the fingerprint.
// The passkey identifies the account, the fingerprint (user verification) confirms the person, so no password or
// two-factor code is asked. The phone used is added to the employee's phones (verified by fingerprint).
export function fingerprintOptions(store, hash, { rpId }, userAgent = '') {
  tables(store);
  const token = randomBytes(32).toString('hex'), challenge = randomBytes(32).toString('base64url');
  store.db.prepare('DELETE FROM webauthn_challenges WHERE expires < ?').run(Date.now());
  store.db.prepare('INSERT INTO webauthn_challenges VALUES(?,?,?,?,?,?,?)').run(token, '', 'signin', challenge, hash || null, deviceLabel(userAgent), Date.now() + CHALLENGE_MS);
  return { token, options: { challenge, rpId, timeout: CHALLENGE_MS, userVerification: 'required', allowCredentials: [] } };
}
export function fingerprintSignIn(store, token, credential, { origin, rpId }) {
  tables(store);
  const row = typeof token === 'string' ? store.db.prepare("SELECT * FROM webauthn_challenges WHERE token=? AND kind='signin'").get(token) : null;
  if (!row || row.expires < Date.now()) throw new AppError('The fingerprint sign-in expired or was not found. Try again.', 401);
  store.db.prepare('DELETE FROM webauthn_challenges WHERE token=?').run(token);
  const key = store.db.prepare('SELECT * FROM passkeys WHERE id=?').get(String(credential?.id || ''));
  if (!key) throw new AppError('This fingerprint is not recognised. Sign in with your username and password, then set up fingerprint sign-in in Account & security.', 401);
  const user = store.db.prepare('SELECT * FROM users WHERE id=?').get(key.user_id);
  const handle = credential?.response?.userHandle;
  if (!user || (handle && fromB64u(handle).toString() !== user.id)) throw new AppError('This fingerprint is not recognised.', 401);
  if (user.disabled) throw new AppError('This account is disabled. Contact HR.', 403);
  if (!LIMITED_ROLES.includes(user.role)) throw new AppError('Fingerprint sign-in is for employee accounts. Sign in with your username and password.', 403);
  verifyAssertion(store, key, credential, row.challenge, { origin, rpId });
  const actor = { id: user.id, username: user.username, role: user.role }, now = new Date().toISOString();
  if (row.device_hash) {
    const devices = store.db.prepare('SELECT * FROM user_devices WHERE user_id=?').all(user.id);
    store.db.prepare('INSERT INTO user_devices VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id, device_hash) DO UPDATE SET last_seen=excluded.last_seen').run(randomUUID(), user.id, row.device_hash, row.label || 'Device', devices.length ? 0 : 1, 'fingerprint', now, now);
  }
  store.log(actor, 'fingerprint-sign-in', 'devices', user.id, null, { label: row.label || 'Device' });
  return user;
}

export function finishPasskeyLogin(store, pendingToken, credential, { origin, rpId }) {
  tables(store);
  const row = typeof pendingToken === 'string' ? store.db.prepare("SELECT * FROM webauthn_challenges WHERE token=? AND kind='login'").get(pendingToken) : null;
  if (!row || row.expires < Date.now()) throw new AppError('The fingerprint sign-in expired or was not found. Sign in again.', 401);
  store.db.prepare('DELETE FROM webauthn_challenges WHERE token=?').run(pendingToken);
  const key = store.db.prepare('SELECT * FROM passkeys WHERE id=? AND user_id=?').get(String(credential?.id || ''), row.user_id);
  if (!key) throw new AppError('The fingerprint response could not be verified.', 401);
  verifyAssertion(store, key, credential, row.challenge, { origin, rpId });
  const now = new Date().toISOString();
  const user = store.db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  store.db.prepare('INSERT INTO user_devices VALUES(?,?,?,?,0,?,?,?) ON CONFLICT(user_id, device_hash) DO UPDATE SET last_seen=excluded.last_seen').run(randomUUID(), user.id, row.device_hash, row.label || 'Device', 'fingerprint', now, now);
  store.notify(user.employee_id, `A new phone (${row.label || 'Device'}) was added to your account after fingerprint verification. If this was not you, tell HR at once.`);
  store.log({ id: user.id, username: user.username, role: user.role }, 'add-device-fingerprint', 'devices', user.id, null, { label: row.label });
  return user;
}

// ---------- Enrolment (from a recognised device) ----------
export function passkeyOptions(store, actor, { rpId, rpName }) {
  tables(store);
  permit(actor, ['employee']);
  const challenge = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('hex');
  store.db.prepare('INSERT INTO webauthn_challenges VALUES(?,?,?,?,?,?,?)').run(token, actor.id, 'register', challenge, null, null, Date.now() + CHALLENGE_MS);
  const existing = store.db.prepare('SELECT id FROM passkeys WHERE user_id=?').all(actor.id);
  return {
    token, challenge, rp: { id: rpId, name: rpName }, user: { id: Buffer.from(actor.id).toString('base64url'), name: actor.username, displayName: actor.username },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none', timeout: CHALLENGE_MS, excludeCredentials: existing.map(k => ({ type: 'public-key', id: k.id })), userVerification: 'required',
  };
}
export function registerPasskey(store, actor, credential, { origin, rpId }) {
  tables(store);
  permit(actor, ['employee']);
  const rows = store.db.prepare("SELECT * FROM webauthn_challenges WHERE user_id=? AND kind='register' AND expires>=?").all(actor.id, Date.now());
  const response = credential?.response || {};
  let challengeRow = null, json = null;
  for (const r of rows) { try { json = clientData(response, 'webauthn.create', r.challenge, origin); challengeRow = r; break; } catch { /* try the next open challenge */ } }
  if (!challengeRow) throw new AppError('The fingerprint setup could not be verified. Try again.', 400);
  store.db.prepare('DELETE FROM webauthn_challenges WHERE token=?').run(challengeRow.token);
  const attestation = cborDecode(fromB64u(response.attestationObject)).value, authData = attestation?.get?.('authData');
  if (!authData) throw new AppError('The fingerprint setup could not be verified. Try again.', 400);
  const parsed = parseAuthData(Buffer.from(authData), rpId);
  if (!parsed.credentialId || !parsed.key) throw new AppError('The fingerprint setup could not be verified. Try again.', 400);
  createPublicKey({ key: parsed.key.jwk, format: 'jwk' });   // rejects malformed keys
  const id = Buffer.from(parsed.credentialId).toString('base64url');
  if (json && store.db.prepare('SELECT 1 FROM passkeys WHERE id=?').get(id)) throw new AppError('This fingerprint is already set up.', 409);
  store.db.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?,?,NULL)').run(id, actor.id, JSON.stringify(parsed.key.jwk), parsed.key.alg, parsed.signCount, new Date().toISOString());
  store.log(actor, 'enrol-fingerprint', 'devices', actor.id, null, { passkey: id.slice(0, 12) });
  return { id, created: true };
}

// A signed-in phone that is not on the list yet (signed in before phones were recorded, or its device cookie was new):
// remembered by the same rule as sign-in — the first phone becomes the registered phone; later ones only while the check is off.
export function rememberDevice(store, actor, hash, userAgent = '') {
  tables(store);
  if (!hash || !LIMITED_ROLES.includes(actor.role)) return false;
  const now = new Date().toISOString(), devices = store.db.prepare('SELECT * FROM user_devices WHERE user_id=?').all(actor.id);
  const known = devices.find(d => d.device_hash === hash);
  if (known) { store.db.prepare('UPDATE user_devices SET last_seen=? WHERE id=?').run(now, known.id); return false; }
  if (devices.length && phoneCheck(store).enforce) return false;
  const label = deviceLabel(userAgent);
  store.db.prepare('INSERT INTO user_devices VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), actor.id, hash, label, devices.length ? 0 : 1, devices.length ? 'signed in (check off)' : 'already signed in', now, now);
  if (!devices.length) store.log(actor, 'register-primary-device', 'devices', actor.id, null, { label });
  return true;
}

// ---------- Lists and reset ----------
export function myDevices(store, actor) {
  tables(store);
  return {
    limited: LIMITED_ROLES.includes(actor.role), enforced: phoneCheck(store).enforce,
    devices: store.db.prepare('SELECT label, is_primary, verified_by, first_seen, last_seen FROM user_devices WHERE user_id=? ORDER BY is_primary DESC, first_seen').all(actor.id).map(d => ({ label: d.label, primary: !!d.is_primary, verifiedBy: d.verified_by, firstSeen: d.first_seen, lastSeen: d.last_seen })),
    fingerprints: store.db.prepare('SELECT id, created, last_used FROM passkeys WHERE user_id=? ORDER BY created').all(actor.id).map(k => ({ id: k.id, created: k.created, lastUsed: k.last_used })),
  };
}
export function removePasskey(store, actor, id) {
  tables(store);
  permit(actor, ['employee']);
  const result = store.db.prepare('DELETE FROM passkeys WHERE id=? AND user_id=?').run(String(id), actor.id);
  if (!result.changes) throw new AppError('Fingerprint not found.', 404);
  store.log(actor, 'remove-fingerprint', 'devices', actor.id, { passkey: String(id).slice(0, 12) }, null);
  return { removed: true };
}
// Lost phone with no synced fingerprint: an administrator clears the employee's phones and fingerprints; the next
// phone they sign in on becomes the new primary. Audited.
export function resetDevices(store, actor, userId) {
  tables(store);
  permit(actor, ['admin']);
  const user = store.db.prepare('SELECT id, username, employee_id FROM users WHERE id=?').get(String(userId));
  if (!user) throw new AppError('Account not found.', 404);
  const before = myDevices(store, { id: user.id, role: 'employee' });
  store.db.prepare('DELETE FROM user_devices WHERE user_id=?').run(user.id);
  store.db.prepare('DELETE FROM passkeys WHERE user_id=?').run(user.id);
  store.log(actor, 'reset-devices', 'devices', user.id, { devices: before.devices.length, fingerprints: before.fingerprints.length }, null);
  store.notify(user.employee_id, 'HR reset the phones registered to your account. The next phone you sign in on becomes your registered phone.');
  return { reset: true };
}
