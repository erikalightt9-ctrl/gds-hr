import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { signRequest, encryptBackup, decryptBackup, snapshotDatabase, runBackup, backupDue, backupKey, keysToDelete, validateConfig } from '../src/backup-r2.mjs';

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'gds-backup-test-'));

test('AWS Signature V4 matches the published S3 example (GET object with Range)', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — "Example: GET Object"
  const signed = signRequest({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    headers: { range: 'bytes=0-9' }, payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(signed.headers.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('backups are compressed and encrypted; only the right key opens them', () => {
  const key = randomBytes(32), data = Buffer.from('employee 201 data '.repeat(500));
  const sealed = encryptBackup(data, key);
  assert.ok(sealed.length < data.length, 'compressed');
  assert.ok(!sealed.includes(Buffer.from('employee 201 data')), 'no readable content');
  assert.deepEqual(decryptBackup(sealed, key), data);
  assert.throws(() => decryptBackup(sealed, randomBytes(32)), 'a wrong key is refused');
  const tampered = Buffer.from(sealed); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptBackup(tampered, key), 'a changed file is refused');
});

test('the snapshot is a complete, consistent copy of the live database', () => {
  const dir = tempDir();
  try {
    const live = path.join(dir, 'hr.sqlite'), db = new DatabaseSync(live);
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('a'), ('b');");
    const out = snapshotDatabase(live, path.join(dir, 'snap.sqlite'));
    db.close();
    const copy = new DatabaseSync(out, { readOnly: true });
    assert.deepEqual(copy.prepare('SELECT v FROM t ORDER BY v').all().map(r => r.v), ['a', 'b'], 'includes rows still in the WAL');
    copy.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a backup is due once a day from the set time (Manila), and catches up after the PC was off', () => {
  const at = iso => new Date(iso);
  assert.equal(backupDue(at('2026-11-12T10:29:00Z'), '18:30', '2026-11-11'), false, '18:29 Manila: not yet');
  assert.equal(backupDue(at('2026-11-12T10:30:00Z'), '18:30', '2026-11-11'), true, '18:30 Manila');
  assert.equal(backupDue(at('2026-11-12T13:00:00Z'), '18:30', '2026-11-12'), false, 'already done today');
  assert.equal(backupDue(at('2026-11-13T01:00:00Z'), '18:30', '2026-11-11'), true, 'missed yesterday: catch up next morning');
  assert.equal(backupDue(at('2026-11-12T10:30:00Z'), '18:30', ''), true, 'never run');
});

test('keys are dated; backups older than the kept days are removed, never the newest 7', () => {
  assert.equal(backupKey(new Date('2026-11-12T10:30:05Z')), 'hr/2026-11-12/gds-hr-2026-11-12T183005.sqlite.gz.enc');
  const keys = Array.from({ length: 40 }, (_, i) => backupKey(new Date(Date.UTC(2026, 9, 1 + i, 10, 30))));
  const gone = keysToDelete(keys, new Date('2026-11-09T11:00:00Z'), 30);
  assert.ok(gone.every(k => k < 'hr/2026-10-10/'), 'only older than 30 days');
  assert.equal(gone.length, 9);
  assert.deepEqual(keysToDelete(keys.slice(0, 5), new Date('2027-06-01T00:00:00Z'), 30), [], 'the newest 7 always stay');
  assert.deepEqual(keysToDelete(['other/file.txt'], new Date('2027-06-01T00:00:00Z'), 30), [], 'other files untouched');
});

test('setup is validated: endpoint, bucket, keys and a 32-byte encryption key', () => {
  const ok = { endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'gds-hr-backups', accessKeyId: 'a'.repeat(32), secretAccessKey: 'b'.repeat(64), encryptionKey: randomBytes(32).toString('base64'), time: '18:30', keepDays: 30 };
  assert.deepEqual(validateConfig(ok), ok);
  assert.throws(() => validateConfig({ ...ok, endpoint: 'http://abc.r2.cloudflarestorage.com' }), /endpoint/i);
  assert.throws(() => validateConfig({ ...ok, bucket: 'HRM System' }), /bucket/i);
  assert.throws(() => validateConfig({ ...ok, encryptionKey: 'short' }), /encryption key/i);
  assert.throws(() => validateConfig({ ...ok, time: '25:00' }), /time/i);
});

test('runBackup uploads the encrypted snapshot, removes expired backups and records the result', async () => {
  const dir = tempDir();
  try {
    const live = path.join(dir, 'hr.sqlite'), db = new DatabaseSync(live);
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('payroll');"); db.close();
    const encryptionKey = randomBytes(32);
    const config = { endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'gds-hr-backups', accessKeyId: 'AK', secretAccessKey: 'SK', encryptionKey: encryptionKey.toString('base64'), time: '18:30', keepDays: 30 };
    const old = Array.from({ length: 10 }, (_, i) => backupKey(new Date(Date.UTC(2026, 8, 1 + i, 10, 30))));
    const recent = Array.from({ length: 8 }, (_, i) => backupKey(new Date(Date.UTC(2026, 10, 1 + i, 10, 30))));
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body, auth: init.headers.authorization });
      if (init.method === 'GET') return new Response(`<ListBucketResult>${[...old, ...recent].map(k => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`, { status: 200 });
      return init.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response('', { status: 200 });
    };
    const statusFile = path.join(dir, 'status.json'), logFile = path.join(dir, 'backup.log');
    const result = await runBackup({ config, dbFile: live, workDir: dir, statusFile, logFile, fetch, now: new Date('2026-11-12T10:30:00Z') });
    const put = calls.find(c => c.method === 'PUT');
    assert.equal(put.url, 'https://acct.r2.cloudflarestorage.com/gds-hr-backups/hr/2026-11-12/gds-hr-2026-11-12T183000.sqlite.gz.enc');
    assert.match(put.auth, /^AWS4-HMAC-SHA256 Credential=AK\/20261112\/auto\/s3\/aws4_request/);
    const restored = path.join(dir, 'restored.sqlite'); writeFileSync(restored, decryptBackup(Buffer.from(put.body), encryptionKey));
    const copy = new DatabaseSync(restored, { readOnly: true });
    assert.equal(copy.prepare('SELECT v FROM t').get().v, 'payroll', 'the uploaded file restores the database');
    copy.close();
    assert.deepEqual(calls.filter(c => c.method === 'DELETE').map(c => decodeURIComponent(c.url.split('/gds-hr-backups/')[1])), old, 'September backups removed');
    assert.equal(result.key, 'hr/2026-11-12/gds-hr-2026-11-12T183000.sqlite.gz.enc');
    const status = JSON.parse(readFileSync(statusFile, 'utf8'));
    assert.equal(status.lastSuccessDate, '2026-11-12'); assert.equal(status.lastError, '');
    assert.match(readFileSync(logFile, 'utf8'), /uploaded hr\/2026-11-12/);
    assert.equal(existsSync(path.join(dir, 'backup-tmp')), false, 'no unencrypted copy left behind');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed upload is recorded, keeps the last success and leaves no snapshot behind', async () => {
  const dir = tempDir();
  try {
    const live = path.join(dir, 'hr.sqlite'); new DatabaseSync(live).close();
    const statusFile = path.join(dir, 'status.json'), logFile = path.join(dir, 'backup.log');
    writeFileSync(statusFile, JSON.stringify({ lastSuccessDate: '2026-11-11', lastKey: 'x' }));
    const config = { endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'gds-hr-backups', accessKeyId: 'AK', secretAccessKey: 'SK', encryptionKey: randomBytes(32).toString('base64'), time: '18:30', keepDays: 30 };
    const fetch = async () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    await assert.rejects(runBackup({ config, dbFile: live, workDir: dir, statusFile, logFile, fetch, now: new Date('2026-11-12T10:30:00Z') }), /403/);
    const status = JSON.parse(readFileSync(statusFile, 'utf8'));
    assert.equal(status.lastSuccessDate, '2026-11-11'); assert.match(status.lastError, /403/);
    assert.match(readFileSync(logFile, 'utf8'), /FAILED/);
    assert.equal(existsSync(path.join(dir, 'backup-tmp')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
