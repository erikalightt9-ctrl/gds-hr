// Local daily backups, failure alerts and restore tests (Nov 24, 2026; role / workflow spec, Phase 3).
//   • Every day after 19:00 Philippine Time (or the first check after a missed day) a full copy of the database is
//     written to data/backups/daily/hr-YYYY-MM-DD.sqlite (SQLite VACUUM INTO: consistent, documents included).
//     The newest 14 are kept.
//   • Each new copy is restore-tested at once: opened on its own, PRAGMA integrity_check must answer "ok" and the
//     employee, user and audit counts must match the live database at the time of the copy.
//   • Results are kept in backup_log. HR / Admin get a notice when a backup or restore test fails, or when the last
//     good backup is more than 2 days old (once a day). The encrypted off-site copy (backup-r2.mjs) is separate.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const KEEP_DAYS = 14, BACKUP_TIME = '19:00', STALE_DAYS = 2;
const manila = (now = new Date()) => new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const ensureLog = db => db.exec('CREATE TABLE IF NOT EXISTS backup_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT NOT NULL)');
// Logged at the time of the run (the run's `now`), so a backup is dated when it was made, also in tests.
const record = (db, kind, ok, detail, at = new Date()) => { ensureLog(db); db.prepare('INSERT INTO backup_log(at,kind,ok,detail) VALUES(?,?,?,?)').run(at.toISOString(), kind, ok ? 1 : 0, JSON.stringify(detail)); };
const counts = db => ({
  employees: JSON.parse(db.prepare('SELECT data FROM state WHERE id=1').get()?.data || '{"employees":[]}').employees.length,
  users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
  audit: db.prepare('SELECT COUNT(*) n FROM audit').get().n,
});

// Opens a backup on its own and checks it can be restored from.
export function restoreTest(file, expected = null) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const ok = Object.values(integrity)[0] === 'ok', found = counts(db);
    const matches = !expected || (found.employees === expected.employees && found.users === expected.users && found.audit >= expected.audit);
    return { ok: ok && matches, integrity: Object.values(integrity)[0], counts: found, expected };
  } finally { db.close(); }
}
export function runLocalBackup(store, dir, now = new Date()) {
  const day = manila(now).slice(0, 10), daily = path.join(dir, 'daily'), file = path.join(daily, `hr-${day}.sqlite`);
  if (manila(now).slice(11) < BACKUP_TIME || existsSync(file)) return null;
  mkdirSync(daily, { recursive: true });
  try {
    const expected = counts(store.db);
    store.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const test = restoreTest(file, expected), size = statSync(file).size;
    record(store.db, 'local-backup', test.ok, { file: path.basename(file), size, test }, now);
    if (!test.ok) store.notify(null, `Backup restore test FAILED for ${path.basename(file)} (integrity: ${test.integrity}). Check the server disk and run the backup again.`);
    const old = readdirSync(daily).filter(f => /^hr-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().slice(0, -KEEP_DAYS);
    for (const f of old) rmSync(path.join(daily, f));
    return { file, size, ok: test.ok, removed: old.length };
  } catch (error) {
    record(store.db, 'local-backup', false, { file: path.basename(file), error: error.message }, now);
    store.notify(null, `Daily backup FAILED (${error.message}). The database was not copied today.`);
    return { file, ok: false, error: error.message };
  }
}
// Alert when the last good backup is too old (once a day).
export function checkBackupHealth(store, now = new Date()) {
  ensureLog(store.db);
  const last = store.db.prepare("SELECT at FROM backup_log WHERE kind='local-backup' AND ok=1 ORDER BY id DESC LIMIT 1").get();
  const age = last ? (now.getTime() - Date.parse(last.at)) / 86400000 : Infinity, key = `backup-stale:${manila(now).slice(0, 10)}`;
  if (age <= STALE_DAYS || store.db.prepare('SELECT 1 FROM hr_counters WHERE key=?').get(key)) return null;
  store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run(key);
  store.notify(null, last ? `No good backup for ${Math.floor(age)} days (last ${last.at.slice(0, 10)}). Check that the HR server PC stays on in the evening.` : 'No database backup has been made yet. The first one runs after 7:00 PM.');
  return { age };
}
export function backupStatus(store) {
  ensureLog(store.db);
  return store.db.prepare('SELECT at, kind, ok, detail FROM backup_log ORDER BY id DESC LIMIT 20').all().map(r => ({ ...r, ok: !!r.ok, detail: JSON.parse(r.detail) }));
}
