import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { addUser, login } from '../src/auth.mjs';
import { completeState } from './helpers.mjs';

// Access removal (Nov 24, 2026): separation applied / 201 archived -> linked logins disabled, records kept.
test('separation on its effective date disables the linked logins and signs them out; records stay', async () => {
  const { requestMovement, decideMovement, applyDueMovements } = await import('../src/movements.mjs');
  const store = new Store(':memory:'); store.write(completeState());
  store.db.prepare('INSERT INTO employee_profiles(employee_id,section,data) VALUES(?,?,?)').run('EMP-001', 'employment', JSON.stringify({ position: 'Clerk' }));
  const a1 = { username: 'admin1', role: 'admin' }, a2 = { username: 'admin2', role: 'admin' };
  try {
    await addUser(store, { username: 'admin1', password: 'initial-password-123', role: 'admin' });
    const emp = await addUser(store, { username: 'EMP-001', password: 'employee-password-1', role: 'employee', employeeId: 'EMP-001' }, a1);
    await login(store, 'EMP-001', 'employee-password-1', 'test');
    const sep = requestMovement(store, a1, { employeeId: 'EMP-001', type: 'separation', effectiveDate: '2099-01-31', reason: 'Resignation letter received and accepted', separationKind: 'Resignation' });
    decideMovement(store, a2, sep.id, { decision: 'approve' });
    assert.equal(store.db.prepare('SELECT disabled FROM users WHERE id=?').get(emp.id).disabled, 0, 'still working until the effective date');
    applyDueMovements(store, new Date('2099-02-01T00:00:00Z'));
    assert.equal(store.db.prepare('SELECT disabled FROM users WHERE id=?').get(emp.id).disabled, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(emp.id).n, 0, 'signed out everywhere');
    await assert.rejects(() => login(store, 'EMP-001', 'employee-password-1', 'test'));
    assert.ok(store.read().employees.some(e => e.id === 'EMP-001'), 'the employee record is kept');
    assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE action='disable-on-separation'").get());
  } finally { store.close(); }
});

test('archiving a 201 file disables its logins; the last active administrator is never disabled', async () => {
  const { archiveEmployee } = await import('../src/hr201.mjs');
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const admin = await addUser(store, { username: 'only.admin', password: 'initial-password-123', role: 'admin' });
    store.db.prepare('UPDATE users SET employee_id=? WHERE id=?').run('EMP-001', admin.id);
    const emp = await addUser(store, { username: 'EMP-001', password: 'employee-password-1', role: 'employee', employeeId: 'EMP-001' }, { username: 'only.admin', role: 'admin' });
    archiveEmployee(store, { username: 'only.admin', role: 'admin' }, 'EMP-001', { reason: 'Left the company' });
    assert.equal(store.db.prepare('SELECT disabled FROM users WHERE id=?').get(emp.id).disabled, 1);
    assert.equal(store.db.prepare('SELECT disabled FROM users WHERE id=?').get(admin.id).disabled, 0, 'last administrator kept');
  } finally { store.close(); }
});

test('Resigned Employees: a separation that has taken effect leaves the working list; records stay', async () => {
  const { directory, isResigned } = await import('../src/hr201.mjs');
  const store = new Store(':memory:'), s = completeState();
  s.employees.push({ ...s.employees[0], id: 'EMP-LEFT', name: 'Gone, Already', endDate: '2026-01-31' });
  s.employees.push({ ...s.employees[0], id: 'EMP-SOON', name: 'Leaving, Soon', endDate: '2099-12-31' });
  store.write(s);
  try {
    const list = directory(store, { username: 'hr1', role: 'hr' });
    assert.deepEqual(list.filter(p => p.resigned).map(p => p.id), ['EMP-LEFT'], 'only once the last day has passed');
    assert.equal(isResigned({ endDate: '', archived: false }, { employeeStatus: 'Resigned' }), true);
    assert.equal(isResigned({ endDate: '2026-01-31', archived: true }, {}), false, 'archived files stay under Archived');
  } finally { store.close(); }
});
