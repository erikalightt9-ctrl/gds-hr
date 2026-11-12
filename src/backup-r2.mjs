// Daily off-site backup to Cloudflare R2 (S3-compatible). A consistent SQLite snapshot (VACUUM INTO; employee documents
// and memo attachments are stored inside the database) is gzip-compressed, encrypted with AES-256-GCM using a key kept
// only on this PC, and uploaded with a dated name. Backups older than keepDays are removed (the newest 7 always stay).
// No dependencies: AWS Signature V4 is implemented with node:crypto. Keys live in data/backup-r2.json (git-ignored).
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MAGIC = Buffer.from('GDSHRBK1'), PREFIX = 'hr/', KEEP_NEWEST = 7, REGION = 'auto';
const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const rfc3986 = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const manila = now => new Date(now.getTime() + 8 * 3600000).toISOString();   // Asia/Manila has no daylight saving

// ---------- Configuration ----------
export function validateConfig(c) {
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.r2\.cloudflarestorage\.com\/?$/.test(c?.endpoint || '')) throw new Error('Backup endpoint must be the https://<account id>.r2.cloudflarestorage.com address from R2.');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(c.bucket || '')) throw new Error('Backup bucket name may contain only lowercase letters, numbers and hyphens.');
  if (!c.accessKeyId || !c.secretAccessKey) throw new Error('Backup Access Key ID and Secret Access Key are required.');
  if (Buffer.from(c.encryptionKey || '', 'base64').length !== 32) throw new Error('Backup encryption key must be 32 bytes (base64).');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.time || '')) throw new Error('Backup time must be HH:MM (Philippine Time).');
  if (!Number.isInteger(c.keepDays) || c.keepDays < 7 || c.keepDays > 3650) throw new Error('Backups must be kept between 7 and 3650 days.');
  return c;
}
export function loadConfig(file) {
  if (!existsSync(file)) return null;
  return validateConfig({ time: '18:30', keepDays: 30, ...JSON.parse(readFileSync(file, 'utf8')) });
}

// ---------- AWS Signature Version 4 (header-based) ----------
export function signRequest({ method, url, region = REGION, accessKeyId, secretAccessKey, headers = {}, payloadHash, now = new Date() }) {
  const u = new URL(url), amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).sort(), signedHeaders = names.join(';');
  const query = [...u.searchParams].map(([k, v]) => [rfc3986(k), rfc3986(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalPath = u.pathname.split('/').map(s => rfc3986(decodeURIComponent(s))).join('/');
  const canonical = [method, canonicalPath, query, names.map(n => `${n}:${all[n]}\n`).join(''), signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const signature = createHmac('sha256', hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request')).update(`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`).digest('hex');
  const { host, ...sent } = all;
  return { url: u.toString(), headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}` }, host };
}

async function s3(config, fetch, method, key = '', { query = '', body = null, now = new Date() } = {}) {
  const base = config.endpoint.replace(/\/$/, ''), objectPath = key ? `/${key.split('/').map(rfc3986).join('/')}` : '';
  const url = `${base}/${config.bucket}${objectPath}${query ? `?${query}` : ''}`;
  const signed = signRequest({ method, url, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, payloadHash: sha256(body || ''), now, headers: body ? { 'content-type': 'application/octet-stream' } : {} });
  const res = await fetch(signed.url, { method, headers: signed.headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`R2 ${method} ${key || config.bucket} failed (HTTP ${res.status})${/<Code>([^<]+)<\/Code>/.exec(text)?.[1] ? `: ${/<Code>([^<]+)<\/Code>/.exec(text)[1]}` : ''}`);
  return text;
}

// ---------- Snapshot and encryption ----------
export function snapshotDatabase(dbFile, outFile) {
  rmSync(outFile, { force: true });
  const db = new DatabaseSync(dbFile);
  try { db.exec('PRAGMA busy_timeout=10000'); db.exec(`VACUUM INTO '${outFile.replace(/'/g, "''")}'`); } finally { db.close(); }
  return outFile;
}
export function encryptBackup(data, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(gzipSync(data, { level: 9 })), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), sealed]);
}
export function decryptBackup(file, key) {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a GDS HR backup file.');
  const iv = file.subarray(8, 20), tag = file.subarray(20, 36), decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return gunzipSync(Buffer.concat([decipher.update(file.subarray(36)), decipher.final()]));
}

// ---------- Schedule and retention ----------
export const backupKey = now => { const m = manila(now); return `${PREFIX}${m.slice(0, 10)}/gds-hr-${m.slice(0, 10)}T${m.slice(11, 19).replace(/:/g, '')}.sqlite.gz.enc`; };
export function backupDue(now, time, lastSuccessDate) {
  const m = manila(now), today = m.slice(0, 10);
  if (lastSuccessDate === today) return false;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  // Today's time reached, or a whole day was missed (the PC was off at that time): catch up straight away.
  return m.slice(11, 16) >= time || (!!lastSuccessDate && lastSuccessDate < yesterday);
}
export function keysToDelete(keys, now, keepDays) {
  const dated = keys.filter(k => /^hr\/\d{4}-\d{2}-\d{2}\//.test(k)).sort(), keep = new Set(dated.slice(-KEEP_NEWEST));
  const cutoff = new Date(Date.parse(`${manila(now).slice(0, 10)}T00:00:00Z`) - keepDays * 86400000).toISOString().slice(0, 10);
  return dated.filter(k => !keep.has(k) && k.slice(3, 13) < cutoff);
}
async function listKeys(config, fetch, now) {
  const keys = []; let token = '';
  do {
    const xml = await s3(config, fetch, 'GET', '', { query: `list-type=2&prefix=${rfc3986(PREFIX)}${token ? `&continuation-token=${rfc3986(token)}` : ''}`, now });
    keys.push(...[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1].replace(/&amp;/g, '&')));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] || '') : '';
  } while (token);
  return keys;
}

// Remove backups from the bucket (e.g. ones made with an encryption key that was exposed).
export async function deleteBackups(config, keys, fetch = globalThis.fetch) { for (const key of keys) await s3(config, fetch, 'DELETE', key); return keys.length; }
export const listBackups = (config, fetch = globalThis.fetch) => listKeys(config, fetch, new Date());

// ---------- One backup run ----------
const readStatus = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };
export async function runBackup({ config, dbFile, workDir, statusFile, logFile, fetch = globalThis.fetch, now = new Date() }) {
  const tmp = path.join(workDir, 'backup-tmp'), log = line => { mkdirSync(path.dirname(logFile), { recursive: true }); appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); };
  const status = readStatus(statusFile), key = backupKey(now);
  try {
    mkdirSync(tmp, { recursive: true });
    const snapshot = readFileSync(snapshotDatabase(dbFile, path.join(tmp, 'snapshot.sqlite')));
    const body = encryptBackup(snapshot, Buffer.from(config.encryptionKey, 'base64'));
    await s3(config, fetch, 'PUT', key, { body, now });
    const expired = keysToDelete(await listKeys(config, fetch, now), now, config.keepDays);
    for (const old of expired) await s3(config, fetch, 'DELETE', old, { now });
    const result = { key, bytes: body.length, databaseBytes: snapshot.length, removed: expired.length };
    writeFileSync(statusFile, JSON.stringify({ ...status, lastSuccessDate: manila(now).slice(0, 10), lastSuccessAt: now.toISOString(), lastKey: key, lastBytes: body.length, lastError: '', lastErrorAt: '' }, null, 2));
    log(`OK uploaded ${key} (${(body.length / 1048576).toFixed(1)} MB encrypted; database ${(snapshot.length / 1048576).toFixed(1)} MB); removed ${expired.length} old backup(s)`);
    return result;
  } catch (error) {
    writeFileSync(statusFile, JSON.stringify({ ...status, lastError: error.message, lastErrorAt: now.toISOString() }, null, 2));
    log(`FAILED ${key}: ${error.message}`);
    throw error;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
export const backupStatus = readStatus;

// ---------- Daily schedule inside the HR server ----------
// Checked every 10 minutes; does nothing until data/backup-r2.json exists (npm run backup:setup). A failure is logged and
// retried at the next check (at most one attempt per hour, so a wrong key does not flood the log).
export const backupFiles = dataDir => ({ configFile: path.join(dataDir, 'backup-r2.json'), statusFile: path.join(dataDir, 'backup-status.json'), logFile: path.join(dataDir, 'logs', 'backup.log'), dbFile: path.join(dataDir, 'hr.sqlite'), workDir: dataDir });
export function startBackupSchedule(dataDir, { every = 600000 } = {}) {
  const files = backupFiles(dataDir);
  let running = false;
  const check = async () => {
    if (running) return;
    try {
      const config = loadConfig(files.configFile); if (!config) return;
      const status = readStatus(files.statusFile), now = new Date();
      if (!backupDue(now, config.time, status.lastSuccessDate || '')) return;
      if (status.lastErrorAt && now - new Date(status.lastErrorAt) < 3600000) return;
      running = true;
      await runBackup({ config, ...files, now });
    } catch (error) { console.error('R2 backup failed:', error.message); } finally { running = false; }
  };
  check(); return setInterval(check, every).unref();
}
