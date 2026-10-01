import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { saveRecord, preview, postPayroll } from '../src/service.mjs';
import { initialState } from '../src/defaults.mjs';

const admin = { id: 'admin', username: 'admin', role: 'admin' };
function setup() { return new Store(':memory:'); }
test('schema rejects invalid money and viewer writes', () => {
  const db = setup();
  assert.throws(() => saveRecord(db, { ...admin, role: 'viewer' }, 'holidays', {}), /permission/i);
  assert.throws(() => saveRecord(db, admin, 'loans', { balance: -1 }));
  db.close();
});
test('audit records before/after and transaction rolls back failure', () => {
  const db = setup();
  saveRecord(db, admin, 'holidays', { id: 'h1', date: '2026-09-01', name: 'Test', kind: 'regular', basis: 'Test' });
  assert.equal(db.audit().length, 1);
  assert.equal(db.audit()[0].actor, 'admin');
  assert.throws(() => db.transaction(() => { db.write(initialState()); throw new Error('rollback'); }));
  assert.equal(db.read().holidays.length, 1);
  db.close();
});
test('unconfigured payroll cannot be posted', () => {
  const db = setup(); const p = preview(db, '2026-09-01', '2026-09-15');
  assert.throws(() => postPayroll(db, admin, { start: p.start, end: p.end, pay13th: false, fingerprint: p.fingerprint }), /resolve/i);
  assert.equal(db.read().runs.length, 0); db.close();
});
