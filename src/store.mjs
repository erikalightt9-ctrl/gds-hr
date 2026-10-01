import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { initialState } from './defaults.mjs';

export class Store {
  constructor(file) {
    this.listeners = new Set(); this.changed = false; this.inTransaction = false;
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL, before_json TEXT, after_json TEXT);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, until_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS employee_profiles (employee_id TEXT NOT NULL, section TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(employee_id,section));
      CREATE TABLE IF NOT EXISTS employee_documents (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, metadata TEXT NOT NULL, content BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS clock_events (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, kind TEXT NOT NULL, work_date TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS clock_employee ON clock_events(employee_id,work_date);
      CREATE TRIGGER IF NOT EXISTS immutable_clock_update BEFORE UPDATE ON clock_events BEGIN SELECT RAISE(ABORT,'Original clock events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_clock_delete BEFORE DELETE ON clock_events BEGIN SELECT RAISE(ABORT,'Original clock events are immutable'); END;
      CREATE TABLE IF NOT EXISTS attendance_explanations (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attendance_corrections (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, attendance_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, employee_id TEXT, created_at TEXT NOT NULL, message TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS location_addresses (event_id TEXT PRIMARY KEY, address TEXT NOT NULL, fetched_at TEXT NOT NULL);
    `);
    const columns = new Set(this.db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
    for (const [name, definition] of [['employee_id', 'TEXT'], ['disabled', 'INTEGER NOT NULL DEFAULT 0'], ['mfa_secret', 'TEXT'], ['mfa_pending', 'TEXT'], ['mfa_last_step', 'INTEGER']]) if (!columns.has(name)) this.db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS user_employee ON users(employee_id) WHERE employee_id IS NOT NULL');
    this.db.prepare('INSERT OR IGNORE INTO state(id,data) VALUES(1,?)').run(JSON.stringify(initialState()));
  }
  read() {
    const state = JSON.parse(this.db.prepare('SELECT data FROM state WHERE id=1').get().data);
    state.employeeProfiles = this.db.prepare("SELECT * FROM employee_profiles WHERE section IN ('employment','attendance','payroll','leave')").all().map(r => ({ employeeId: r.employee_id, section: r.section, ...JSON.parse(r.data) }));
    return state;
  }
  write(state) { const copy = { ...state }; delete copy.employeeProfiles; this.db.prepare('UPDATE state SET data=? WHERE id=1').run(JSON.stringify(copy)); }
  transaction(fn) {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true; this.changed = false;
    try { const result = fn(); this.db.exec('COMMIT'); this.inTransaction = false; if (this.changed) this.emitChange(); return result; }
    catch (e) { this.db.exec('ROLLBACK'); this.inTransaction = false; this.changed = false; throw e; }
  }
  emitChange() { for (const listener of this.listeners) { try { listener(); } catch { /* Disconnected clients must not affect committed records. */ } } }
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify(employeeId, message) { this.db.prepare('INSERT INTO notifications VALUES(?,?,?,?)').run(randomUUID(), employeeId, new Date().toISOString(), message); }
  log(actor, action, kind, id, before, after) {
    this.db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), new Date().toISOString(), actor.username, action, kind, id, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));
    if (kind === 'leaves' && after?.employeeId) { this.notify(after.employeeId, `Leave request ${after.startDate} to ${after.endDate}: ${after.status}.`); this.notify(null, `${after.employeeId}: leave request ${after.status}.`); }
    if (kind === 'runs' && action === 'post') for (const row of after?.rows || []) this.notify(row.employeeId, `Your payslip for ${after.start} to ${after.end} is available.`);
    this.changed = true; if (!this.inTransaction) this.emitChange();
  }
  audit() { return this.db.prepare('SELECT * FROM audit ORDER BY at DESC LIMIT 1000').all().map(r => ({ id: r.id, at: r.at, actor: r.actor, action: r.action, kind: r.kind, recordId: r.record_id, before: JSON.parse(r.before_json), after: JSON.parse(r.after_json) })); }
  close() { this.db.close(); }
}
