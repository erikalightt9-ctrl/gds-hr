import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { addUser, login, session } from '../src/auth.mjs';
import { setAccountScope, scopeOf } from '../src/account-scope.mjs';
import { ROLE_LABELS } from '../src/roles.mjs';

const cookieOf = s => `hr_session=${s.token}`;
test('roles follow the Nov 24, 2026 spec; Finance signs in read-only', async () => {
  assert.deepEqual([ROLE_LABELS.hr, ROLE_LABELS.maker, ROLE_LABELS.dept_manager, ROLE_LABELS.payroll, ROLE_LABELS.finance, ROLE_LABELS.viewer], ['Company Admin / HR Head', 'HR Maker', 'Supervisor / Approver', 'Payroll Officer', 'Finance / Releasing Officer', 'Auditor / Viewer']);
  const store = new Store(':memory:');
  try {
    const admin = await addUser(store, { username: 'admin', password: 'initial-password-123', role: 'admin' });
    await addUser(store, { username: 'fin.one', password: 'initial-password-123', role: 'finance', employeeId: undefined }, { id: admin.id, username: 'admin', role: 'admin' });
    const s = await login(store, 'fin.one', 'initial-password-123', 'test');
    const auth = session(store, cookieOf(s));
    assert.deepEqual([auth.user.role, auth.user.finance], ['viewer', true]);
  } finally { store.close(); }
});

test('account scope: companies and separate salary / sensitive permissions, admin only, audited', async () => {
  const store = new Store(':memory:');
  try {
    const admin = await addUser(store, { username: 'admin', password: 'initial-password-123', role: 'admin' }), actor = { id: admin.id, username: 'admin', role: 'admin' };
    const maker = await addUser(store, { username: 'maker.one', password: 'initial-password-123', role: 'maker' }, actor);
    assert.deepEqual(scopeOf(store.db.prepare('SELECT * FROM users WHERE id=?').get(maker.id)), { companies: [], permissions: { salary: false, sensitive: true } }, 'defaults keep what the role saw before');
    assert.deepEqual(scopeOf({ role: 'admin' }).permissions, { salary: true, sensitive: true });
    const saved = setAccountScope(store, actor, maker.id, { companies: ['PDMN'], salary: true, sensitive: false }, ['GDS Capital HQ', 'PDMN']);
    assert.deepEqual(saved, { companies: ['PDMN'], permissions: { salary: true, sensitive: false } });
    assert.throws(() => setAccountScope(store, actor, maker.id, { companies: ['Nope'], salary: false, sensitive: false }, ['PDMN']), /Unknown company/);
    assert.throws(() => setAccountScope(store, { username: 'h', role: 'hr' }, maker.id, { companies: [], salary: false, sensitive: false }, []), /permission/i);
    const s = await login(store, 'maker.one', 'initial-password-123', 'test');
    assert.deepEqual(session(store, cookieOf(s)).user.companies, ['PDMN']);
    assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE action='set-account-scope'").get());
  } finally { store.close(); }
});

test('salary and sensitive permissions: pay modules closed, values stripped, 201 tabs follow them', async () => {
  const { canSeePay, canSeeSensitive, stripForPermissions, PAY_PATHS } = await import('../src/account-scope.mjs');
  assert.equal(canSeePay({ role: 'admin', permissions: { salary: false, sensitive: true } }), false, 'an administrator without the Salary permission');
  assert.equal(canSeePay({ role: 'admin' }), true, 'internal calls keep the role access');
  assert.equal(canSeePay({ role: 'maker', permissions: { salary: true, sensitive: true } }), true, 'HR Maker granted salary access');
  assert.equal(canSeeSensitive({ role: 'hr_staff', permissions: { salary: false, sensitive: false } }), false);
  assert.equal(canSeePay({ role: 'employee', permissions: { salary: true } }), false);
  for (const p of ['/api/runs', '/api/payroll/preview', '/api/loans', '/api/final-pay/x.pdf', '/api/contributions', '/api/thirteenth']) assert.ok(PAY_PATHS.test(p), p);
  assert.ok(!PAY_PATHS.test('/api/state') && !PAY_PATHS.test('/api/hr/employees'));
  const out = stripForPermissions({ employees: [{ id: 'E', monthlySalary: 30000, name: 'X' }], runs: [{ id: 'r' }], government: { tin: '123456789', sss: '' }, bank: { accountNumber: '0011223344' } }, { pay: false, sensitive: false });
  assert.deepEqual(out, { employees: [{ id: 'E', monthlySalary: null, name: 'X' }], runs: [], government: { tin: '•••• 789', sss: '' }, bank: {} });
});

test('an unlinked staff login gets the person\'s name (admin only, audited); employee logins keep their 201 name', async () => {
  const { setDisplayName } = await import('../src/auth.mjs');
  const { staffNames } = await import('../src/staff-names.mjs').catch(() => ({}));
  const store = new Store(':memory:');
  try {
    const admin = await addUser(store, { username: 'admin', password: 'initial-password-123', role: 'admin' }), actor = { id: admin.id, username: 'admin', role: 'admin' };
    assert.deepEqual(setDisplayName(store, actor, admin.id, '  Erika   Lima Hernando '), { displayName: 'Erika Lima Hernando' });
    assert.equal(store.db.prepare('SELECT display_name FROM users WHERE id=?').get(admin.id).display_name, 'Erika Lima Hernando');
    assert.throws(() => setDisplayName(store, { username: 'x', role: 'hr' }, admin.id, 'Someone Else'), /permission/i);
    assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE action='set-display-name'").get());
    if (staffNames) assert.equal(staffNames(store).admin, 'Erika Lima Hernando', 'shown in every by line');
  } finally { store.close(); }
});
