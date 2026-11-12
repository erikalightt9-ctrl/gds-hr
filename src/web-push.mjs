// Web Push without dependencies: VAPID (RFC 8292) authentication and aes128gcm payload encryption (RFC 8291), so a
// reminder reaches a phone or computer even while the HR app is closed. Keys are generated once and kept in the
// database (never in code). Only well-known browser push services are contacted.
import { createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, createCipheriv, sign } from 'node:crypto';

const b64url = buffer => Buffer.from(buffer).toString('base64url');
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/, /^android\.googleapis\.com$/];
export function allowedEndpoint(endpoint) {
  try { const url = new URL(endpoint); return url.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(url.hostname)); } catch { return false; }
}

// VAPID key pair, created on first use and stored in app_secrets.
export function vapidKeys(store) {
  const row = store.db.prepare("SELECT value FROM app_secrets WHERE key='vapid'").get();
  if (row) return JSON.parse(row.value);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' }), publicKey = b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
  const keys = { publicKey, privateJwk: jwk };
  store.db.prepare("INSERT INTO app_secrets(key,value) VALUES('vapid',?)").run(JSON.stringify(keys));
  return keys;
}

function vapidHeader(keys, endpoint, subject) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: createPrivateKey({ key: keys.privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

// RFC 8291: one aes128gcm record addressed to the subscription's p256dh key and auth secret.
export function encryptPayload(subscription, payload, { salt = randomBytes(16), serverKeys = null } = {}) {
  const uaPublic = Buffer.from(subscription.keys.p256dh, 'base64url'), authSecret = Buffer.from(subscription.keys.auth, 'base64url');
  const ecdh = serverKeys || createECDH('prime256v1');
  if (!serverKeys) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// Sends one notification. Returns 'sent', 'gone' (subscription expired: delete it) or 'failed'.
export async function sendPush(store, subscription, message, { subject = 'https://hr.blkstone.site', fetchImpl = fetch } = {}) {
  if (!allowedEndpoint(subscription.endpoint)) return 'gone';
  const keys = vapidKeys(store);
  createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: keys.privateJwk.x, y: keys.privateJwk.y }, format: 'jwk' });   // key sanity check
  try {
    const response = await fetchImpl(subscription.endpoint, { method: 'POST', headers: { Authorization: vapidHeader(keys, subscription.endpoint, subject), TTL: '1800', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' }, body: encryptPayload(subscription, JSON.stringify(message)), signal: AbortSignal.timeout(10000) });
    if (response.status === 404 || response.status === 410) return 'gone';
    return response.ok ? 'sent' : 'failed';
  } catch { return 'failed'; }
}
