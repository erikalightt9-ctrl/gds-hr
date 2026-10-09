import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { staffNames, fullNameOf, displayName } from '../src/staff-names.mjs';
import { completeState } from './helpers.mjs';

test('usernames show as the full name of the linked employee record (staff and employees); unlinked stay as is', () => {
  const store = new Store(':memory:');
  try {
    const s = completeState(); store.write(s);
    const e = s.employees[0];
    store.db.prepare('INSERT INTO users(id,username,password_hash,role,employee_id) VALUES(?,?,?,?,?)').run('u1', 'hr.admin', 'x', 'admin', e.id);
    store.db.prepare('INSERT INTO users(id,username,password_hash,role,employee_id) VALUES(?,?,?,?,?)').run('u2', 'plain.admin', 'x', 'admin', null);
    store.db.prepare('INSERT INTO users(id,username,password_hash,role,employee_id) VALUES(?,?,?,?,?)').run('u3', 'worker', 'x', 'employee', e.id === 'EMP-001' ? 'EMP-002' : 'EMP-001');
    const full = displayName(e.name);
    assert.equal(staffNames(store)['hr.admin'], full);
    assert.equal(fullNameOf(store, 'hr.admin'), full);
    assert.equal(fullNameOf(store, 'hr.admin (encoded from sheets)'), `${full} (encoded from sheets)`);
    assert.equal(fullNameOf(store, 'plain.admin'), 'plain.admin');
    assert.ok(!('worker' in staffNames(store, { staffOnly: true })), 'employees only see staff names');
    assert.equal(displayName('Hernando, Erika Lima'), 'Erika Lima Hernando');
    store.db.prepare("UPDATE users SET display_name='GDS Capital Inc' WHERE username='plain.admin'").run();
    assert.equal(fullNameOf(store, 'plain.admin'), 'GDS Capital Inc', 'a login display name');
  } finally { store.close(); }
});
