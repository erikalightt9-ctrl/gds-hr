import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createApp } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';

process.env.HR_REQUIRE_MFA = 'off';
// Company separation (Nov 24, 2026): a Company Admin limited to "Operations" must not receive anything about the
// PDMN employee from any GET endpoint (JSON, PDF, Excel), nor open or change that employee's records by id.
const OTHER = { id: 'EMP-777', name: 'Outsider, Zeta' }, MARKERS = ['EMP-777', 'Outsider', 'Zeta Outsider'];
function state() {
  const s = completeState();
  const e = { ...s.employees[0], id: OTHER.id, name: OTHER.name, department: 'PDMN' };
  s.employees.push(e);
  s.attendance.push(...s.attendance.filter(a => a.employeeId === 'EMP-001').map(a => ({ ...a, id: `z-${a.date}`, employeeId: OTHER.id })));
  s.loans.push({ ...s.loans[0], id: 'loan-z', employeeId: OTHER.id, reference: 'TEST-777' });
  return s;
}
// Every GET path the server names literally (parameterless ones).
const PATHS = [...new Set(readdirSync('src').filter(f => f.endsWith('.mjs')).flatMap(f => [...readFileSync(`src/${f}`, 'utf8').matchAll(/pathname === '(\/api\/[a-z0-9/._-]+)'/g)].map(m => m[1])))]
  .filter(p => !/\/(logout|setup|login|recovery|password|version|events)/.test(p));

test('a company-limited login sees nothing of another company on any GET endpoint', async t => {
  const store = new Store(':memory:');
  const app = createApp({ store, origin: 'http://127.0.0.1:3400', setupToken: 'test-only-setup-code' });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise(r => app.close(r)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = (path, body, cookie = '', csrf = '') => fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3400', Cookie: cookie, 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined });
  await call('/api/setup', { token: 'test-only-setup-code', username: 'admin', password: 'strong-test-password' });
  const a = await call('/api/login', { username: 'admin', password: 'strong-test-password' }), ac = a.headers.get('set-cookie').split(';')[0], acsrf = (await a.json()).csrf;
  store.write(state());
  const created = await (await call('/api/users', { username: 'ops.head', password: 'strong-head-password', role: 'hr' }, ac, acsrf)).json();
  assert.equal((await call(`/api/users/${created.user.id}/scope`, { companies: ['Operations'], salary: true, sensitive: true }, ac, acsrf)).status, 200);
  const h = await call('/api/login', { username: 'ops.head', password: 'strong-head-password' }), hc = h.headers.get('set-cookie').split(';')[0], hcsrf = (await h.json()).csrf;

  assert.match(await (await call('/api/state', null, ac)).text(), /Outsider/, 'an unlimited admin still sees every company');
  // A company-limited System Administrator reaches almost every endpoint: the strongest check.
  const opsAdmin = await (await call('/api/users', { username: 'ops.admin', password: 'strong-admin-password', role: 'admin' }, ac, acsrf)).json();
  await call(`/api/users/${opsAdmin.user.id}/scope`, { companies: ['Operations'], salary: true, sensitive: true }, ac, acsrf);
  const oc = (await call('/api/login', { username: 'ops.admin', password: 'strong-admin-password' })).headers.get('set-cookie').split(';')[0];
  for (const [who, cookie, minimum] of [['Company Admin', hc, 30], ['limited System Administrator', oc, 40]]) {
    const leaks = [], statuses = {};
    for (const path of PATHS) {
      const res = await fetch(`${base}${path}`, { headers: { Origin: 'http://127.0.0.1:3400', Cookie: cookie }, signal: AbortSignal.timeout(8000) }).catch(e => ({ status: 599, arrayBuffer: async () => new ArrayBuffer(0), error: e }));
      statuses[res.status] = (statuses[res.status] || 0) + 1;
      if (res.status >= 500) leaks.push(`${path}: HTTP ${res.status}`);
      const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
      if (MARKERS.some(m => text.includes(m))) leaks.push(`${path}: shows ${MARKERS.find(m => text.includes(m))}`);
    }
    assert.deepEqual(leaks, [], `${who}: checked ${PATHS.length} GET endpoints`);
    assert.ok((statuses[200] || 0) >= minimum, `${who}: ${JSON.stringify(statuses)}`);
  }
  assert.match(await (await call('/api/state', null, hc)).text(), /Sample Employee/, 'own company still visible');
  // Direct links and actions on the other company's records are refused.
  assert.equal((await call(`/api/hr/employees/${OTHER.id}`, null, hc)).status, 403);
  assert.equal((await call('/api/loans/loan-z.pdf', null, hc)).status, 403);
  assert.equal((await call(`/api/attendance-days?employeeId=${OTHER.id}&month=2026-09`, null, hc)).status, 403);
  assert.equal((await call('/api/payroll/preview', { start: '2026-09-01', end: '2026-09-15', pay13th: false, employeeIds: [OTHER.id] }, hc, hcsrf)).status, 403);
  // The whole-state data is untouched by the limited reads.
  assert.equal(store.read().employees.length, 2);
});

test('payroll preview by a company-limited login covers only its company', async t => {
  const store = new Store(':memory:');
  const app = createApp({ store, origin: 'http://127.0.0.1:3400', setupToken: 'test-only-setup-code' });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise(r => app.close(r)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = (path, body, cookie = '', csrf = '') => fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3400', Cookie: cookie, 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined });
  await call('/api/setup', { token: 'test-only-setup-code', username: 'admin', password: 'strong-test-password' });
  const a = await call('/api/login', { username: 'admin', password: 'strong-test-password' }), ac = a.headers.get('set-cookie').split(';')[0], acsrf = (await a.json()).csrf;
  store.write(state());
  const u = await (await call('/api/users', { username: 'ops.pay', password: 'strong-pay-password', role: 'payroll' }, ac, acsrf)).json();
  await call(`/api/users/${u.user.id}/scope`, { companies: ['Operations'], salary: true, sensitive: false }, ac, acsrf);
  const p = await call('/api/login', { username: 'ops.pay', password: 'strong-pay-password' }), pc = p.headers.get('set-cookie').split(';')[0], pcsrf = (await p.json()).csrf;
  const run = await (await call('/api/payroll/preview', { start: '2026-09-01', end: '2026-09-15', pay13th: false }, pc, pcsrf)).json();
  assert.deepEqual(run.rows.map(r => r.employeeId), ['EMP-001']);
  assert.deepEqual(run.employeeIds, ['EMP-001'], 'the run itself is limited, so totals and posting cover only this company');
});
