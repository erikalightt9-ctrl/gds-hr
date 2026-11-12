// GDS HR off-site backups to Cloudflare R2.
//   npm run backup:setup                       save the R2 keys on this PC, create the encryption key, upload a first backup
//   npm run backup                             upload a backup now
//   npm run backup:status                      last success / last error
//   npm run backup:restore -- <file> <out>     decrypt a downloaded backup into a .sqlite file (never over data/hr.sqlite)
// Keys are typed here, on this PC only, and saved in data/backup-r2.json (git-ignored). Never paste them in chats or email.
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupFiles, loadConfig, validateConfig, runBackup, backupStatus, decryptBackup } from '../src/backup-r2.mjs';

const dataDir = path.resolve(process.env.HR_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../data'));
const files = backupFiles(dataDir);

function ask(question, { hidden = false, fallback = '' } = {}) {
  const prompt = `${question}${fallback ? ` [${fallback}]` : ''}: `;
  if (hidden) return askHidden(prompt, fallback);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise(resolve => rl.question(prompt, answer => { rl.close(); resolve(answer.trim() || fallback); }));
}

// Secrets are read key by key in raw mode and echoed as one '*' per character (pasted text included); nothing typed is
// ever written to the screen.
function askHidden(prompt, fallback) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error('Run this in a terminal window so the keys can be typed hidden.')); return; }
    process.stdout.write(prompt);
    let value = '';
    const done = result => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); result instanceof Error ? reject(result) : resolve(result); };
    const onData = chunk => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') { done(value.trim() || fallback); return; }
        if (ch === '\u0003') { done(new Error('Setup cancelled.')); return; }
        if (ch === '\u0008' || ch === '\u007f') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (ch >= ' ') { value += ch; process.stdout.write('*'); }
      }
    };
    stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
  });
}

// The bucket page's "S3 API" address has /<bucket> at the end, and pasting may add spaces or capitals: keep only
// https://<account id>.r2.cloudflarestorage.com.
function endpointOrigin(text) {
  const raw = text.trim().replace(/^['"<]+|['">]+$/g, '');
  try { const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); return `https://${u.hostname.toLowerCase()}`; } catch { return raw; }
}

async function setup() {
  const existing = existsSync(files.configFile) ? JSON.parse(readFileSync(files.configFile, 'utf8')) : {};
  console.log('GDS HR → Cloudflare R2 backup setup. Copy the values from the R2 API token page (do not paste them anywhere else).\n');
  const endpoint = endpointOrigin(await ask('S3 endpoint (https://<account id>.r2.cloudflarestorage.com)', { fallback: existing.endpoint || '' }));
  const bucket = await ask('Bucket name', { fallback: existing.bucket || 'gds-hr-backups' });
  const accessKeyId = await ask('Access Key ID', { hidden: true, fallback: existing.accessKeyId ? '(keep saved)' : '' });
  const secretAccessKey = await ask('Secret Access Key', { hidden: true, fallback: existing.secretAccessKey ? '(keep saved)' : '' });
  const time = await ask('Daily backup time, Philippine Time (HH:MM)', { fallback: existing.time || '18:30' });
  const keepDays = Number(await ask('Days to keep', { fallback: String(existing.keepDays || 30) }));
  const newKey = !existing.encryptionKey;
  const config = validateConfig({
    endpoint, bucket, time, keepDays,
    accessKeyId: accessKeyId === '(keep saved)' ? existing.accessKeyId : accessKeyId,
    secretAccessKey: secretAccessKey === '(keep saved)' ? existing.secretAccessKey : secretAccessKey,
    encryptionKey: existing.encryptionKey || randomBytes(32).toString('base64'),
  });
  writeFileSync(files.configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
  console.log(`\nSaved to ${files.configFile}.`);
  if (newKey) {
    console.log('\nDo NOT take a screenshot of this window or paste the key below into any chat or email.');
    console.log('\n================  BACKUP ENCRYPTION KEY  ================');
    console.log(config.encryptionKey);
    console.log('=========================================================');
    console.log('Save this key NOW in a password manager or on paper kept OUTSIDE this PC.');
    console.log('Without it the backups cannot be opened — e.g. if this PC is lost or its disk fails.\n');
  }
  console.log('Uploading a first backup to test the connection…');
  await runNow(config);
}

async function runNow(config = loadConfig(files.configFile)) {
  if (!config) throw new Error('Backups are not set up yet. Run: npm run backup:setup');
  const result = await runBackup({ config, ...files });
  console.log(`Backup uploaded: ${result.key} (${(result.bytes / 1048576).toFixed(1)} MB encrypted). Old backups removed: ${result.removed}.`);
}

function status() {
  const config = loadConfig(files.configFile), s = backupStatus(files.statusFile);
  if (!config) { console.log('Backups are not set up yet. Run: npm run backup:setup'); return; }
  console.log(`Bucket: ${config.bucket} · daily at ${config.time} Philippine Time · kept ${config.keepDays} days`);
  console.log(`Last success: ${s.lastSuccessAt || 'never'}${s.lastKey ? ` (${s.lastKey})` : ''}`);
  console.log(`Last error:   ${s.lastError ? `${s.lastErrorAt} — ${s.lastError}` : 'none'}`);
}

async function restore(input, output) {
  if (!input || !output) throw new Error('Usage: npm run backup:restore -- <downloaded .enc file> <output .sqlite>');
  const target = path.resolve(output);
  if (target === path.resolve(files.dbFile)) throw new Error('Restore into a new file, never over data/hr.sqlite. Stop the app and swap files by hand after checking it.');
  if (existsSync(target)) throw new Error(`${target} already exists.`);
  const config = loadConfig(files.configFile);
  const key = config?.encryptionKey || await ask('Backup encryption key', { hidden: true });
  writeFileSync(target, decryptBackup(readFileSync(input), Buffer.from(key, 'base64')));
  console.log(`Restored to ${target}. Open it with the app only after checking it (HR_DATA_DIR pointing to a copy).`);
}

const [command = 'run', ...args] = process.argv.slice(2);
const commands = { setup, run: () => runNow(), status, restore: () => restore(...args) };
if (!commands[command]) { console.error(`Unknown command "${command}". Use setup, run, status or restore.`); process.exit(1); }
Promise.resolve(commands[command]()).catch(error => { console.error(`Error: ${error.message}`); process.exit(1); });
