import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { runLocalBackup, checkBackupHealth, backupStatus, restoreTest, KEEP_DAYS } from '../src/local-backup.mjs';
import { completeState } from './helpers.mjs';

test('daily local backup: after 7 PM Manila, once a day, restore-tested, 14 kept; stale backups alert HR', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hr-backup-')), file = path.join(dir, 'live.sqlite');
  const store = new Store(file); store.write(completeState());
  try {
    assert.equal(runLocalBackup(store, dir, new Date('2026-11-24T10:00:00Z')), null, '6 PM Manila: not yet');
    const made = runLocalBackup(store, dir, new Date('2026-11-24T11:30:00Z'));   // 7:30 PM Manila
    assert.equal(made.ok, true);
    assert.equal(runLocalBackup(store, dir, new Date('2026-11-24T12:00:00Z')), null, 'once a day');
    assert.equal(restoreTest(made.file).integrity, 'ok');
    assert.equal(backupStatus(store)[0].detail.test.counts.employees, 1);
    for (let i = 1; i <= KEEP_DAYS + 2; i++) writeFileSync(path.join(dir, 'daily', `hr-2026-10-${String(i).padStart(2, '0')}.sqlite`), '');
    runLocalBackup(store, dir, new Date('2026-11-25T11:30:00Z'));
    assert.equal(readdirSync(path.join(dir, 'daily')).length, KEEP_DAYS);
    assert.equal(checkBackupHealth(store, new Date('2026-11-26T00:00:00Z')), null, 'fresh: no alert');
    assert.ok(checkBackupHealth(store, new Date('2026-11-29T00:00:00Z')), 'more than 2 days old: alert');
    assert.equal(checkBackupHealth(store, new Date('2026-11-29T05:00:00Z')), null, 'once a day');
    assert.ok(store.db.prepare('SELECT message FROM notifications WHERE employee_id IS NULL').all().some(n => /No good backup for/.test(n.message)));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
