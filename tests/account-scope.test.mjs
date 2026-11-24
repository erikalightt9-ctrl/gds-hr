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
