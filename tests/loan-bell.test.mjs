import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { addUser } from '../src/auth.mjs';
import { applyLoan } from '../src/loans.mjs';
import { completeState } from './helpers.mjs';

test('a pending loan application appears in the HR bell and opens Employee Loans', async t => {
  const store = new Store(':memory:'); store.write(completeState());
  const adminUser = await addUser(store, { username: 'admin', password: 'strong-admin-pass', role: 'admin' });
  const app = createApp({ store, origin: 'http://127.0.0.1:3400', setupToken: '' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`, headers = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3400' };
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'admin', password: 'strong-admin-pass' }) });
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const bell = async () => { const body = await (await fetch(`${base}/api/hr/notifications`, { headers: { ...headers, Cookie: cookie } })).json(); assert.ok(body.items, JSON.stringify(body)); return body.items.filter(i => i.nav === 'loans'); };

  assert.deepEqual(await bell(), [], 'nothing before an application');
  applyLoan(store, { id: 'u-emp', username: 'emp1', role: 'employee', employeeId: 'EMP-001' }, { type: 'Salary Loan', amount: 5000, months: 5, purpose: 'School fees' });
  const items = await bell();
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Sample Employee: Salary Loan application ₱5,000\.00 \(5 months\) waiting for approval/);
  assert.ok(items[0].date, 'shows the date applied');
  assert.ok(adminUser.id);
});
