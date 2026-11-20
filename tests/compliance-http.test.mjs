import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { addUser } from '../src/auth.mjs';
import { completeState, admin } from './helpers.mjs';
import { workbook } from '../src/export.mjs';
import { localToday } from '../src/profiles.mjs';

const ORIGIN = 'http://127.0.0.1:3400';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
async function start(t) {
  const store = new Store(':memory:'); store.write(completeState());
  for (const [username, role, employeeId] of [['hr1', 'hr', null], ['boss', 'viewer', null], ['staff', 'hr_staff', null], ['emp1', 'employee', 'EMP-001']])
    await addUser(store, { username, password: 'test-pass-12345', role, ...(employeeId ? { employeeId } : {}) }, admin);
  const app = createApp({ store, origin: ORIGIN, setupToken: '' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  // A signed-in client: call(path, body?) returns { status, json, buffer, type }.
  const as = async username => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ username, password: 'test-pass-12345' }) });
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), { csrf } = await (await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).json();
    return async (path, body) => {
      const r = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie, 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined });
      const type = r.headers.get('content-type') || '', buffer = Buffer.from(await r.arrayBuffer());
      return { status: r.status, type, buffer, json: type.includes('json') ? JSON.parse(buffer.toString()) : null };
    };
  };
  return { as };
}

test('HTTP: due process case from incident to closure, with the employee portal routes and role limits', async t => {
  const { as } = await start(t), hr = await as('hr1'), boss = await as('boss'), staff = await as('staff'), emp = await as('emp1');
  assert.equal((await staff('/discipline/cases')).status, 403);
  assert.equal((await emp('/discipline/cases')).status, 403);
  assert.equal((await hr('/discipline/options')).json.minResponseDays, 5);
  const created = await hr('/discipline/cases', { employeeId: 'EMP-001', date: localToday(), offenseId: 'policy', description: 'Left the office without logging out the shared terminal.', issuingOfficer: 'HR Manager' });
  assert.equal(created.status, 201);
  const id = created.json.id, step = (action, body = {}, who = hr) => who(`/discipline/cases/${id}/${action}`, body);
  assert.equal((await step('files', { name: 'log.pdf', mime: 'application/pdf', data: PDF })).status, 200);
  assert.equal((await step('notes', { text: 'Supervisor to send the system log.' })).status, 200);
  assert.equal((await step('nte', { allegations: 'The shared terminal stayed logged in overnight.', rules: 'IT policy 2.1', possibleSanction: 'Written warning', responseDays: 5 })).status, 200);
  assert.equal((await step('issue-nte')).json.status, 'awaiting');
  assert.equal((await step('no-explanation')).status, 400, 'deadline not yet passed');
  // Employee side.
  const mine = (await emp('/hr/me/cases')).json;
  assert.equal(mine.length, 1);
  assert.equal((await emp(`/hr/me/cases/${id}/acknowledge/nte`, {})).status, 200);
  assert.match((await emp(`/hr/me/cases/${id}/nte.pdf`)).buffer.subarray(0, 5).toString(), /%PDF-/);
  assert.equal((await emp(`/hr/me/cases/${id}/explanation`, { text: 'I was called to an urgent client meeting and forgot to log out.', hearingRequested: false, files: [{ name: 'note.pdf', mime: 'application/pdf', data: PDF }] })).status, 201);
  const detail = (await hr(`/discipline/cases/${id}`)).json, employeeFile = detail.files.find(f => f.byEmployee);
  assert.equal((await emp(`/hr/me/cases/files/${employeeFile.id}`)).status, 200);
  assert.equal((await emp(`/hr/me/cases/files/${detail.files.find(f => !f.byEmployee).id}`)).status, 404, 'HR evidence is not served to the employee');
  assert.equal((await emp('/hr/me/cases/unknown')).status, 404);
  // HR / management.
  assert.equal((await step('evaluation', { findings: 'Admitted; first offense.', recommendation: 'Verbal warning' })).status, 200);
  assert.equal((await step('decision', { sanction: 'Verbal warning', findings: 'Admitted; first offense.' })).status, 200);
  assert.equal((await step('submit-decision')).status, 200);
  assert.equal((await step('review-decision', { action: 'approve' }, staff)).status, 403);
  assert.equal((await step('review-decision', { action: 'approve', note: 'OK' }, boss)).json.decision.status, 'approved');
  assert.equal((await step('issue-decision')).json.status, 'resolved');
  assert.equal((await step('close', { remarks: '' })).json.status, 'closed');
  assert.match((await hr(`/discipline/cases/${id}/decision.pdf`)).type, /pdf/);
  assert.equal((await hr(`/discipline/files/${employeeFile.id}`)).status, 200);
  assert.equal((await hr('/discipline/records')).json.length, 1);
  assert.equal((await hr('/discipline/records', { employeeId: 'EMP-001', type: 'Written warning', date: '2025-01-10', offense: 'Tardiness', remarks: 'Paper memo on file' })).status, 201);
  assert.equal((await hr('/discipline/settings')).status, 403, 'settings are for administrators');
  assert.equal((await hr('/discipline/cases/x/unknown', {})).status, 404);
});

test('HTTP: BIR 1601-C month, year, edits, filing, reopening and Excel; report library upload and download', async t => {
  const { as } = await start(t), hr = await as('hr1'), boss = await as('boss'), emp = await as('emp1'), staff = await as('staff');
  assert.equal((await emp('/bir1601c?month=2026-09')).status, 403);
  assert.equal((await staff('/bir1601c?month=2026-09')).status, 403);
  assert.ok((await boss('/bir1601c?month=2026-09')).json.rows.length);
  assert.equal((await hr('/bir1601c/year?year=2026')).json.months.length, 12);
  assert.equal((await hr('/bir1601c/row', { employeeId: 'EMP-001', month: '2026-09', values: { deMinimis: 500 }, reason: 'Rice subsidy' })).status, 200);
  assert.equal((await hr('/bir1601c/return', { month: '2026-09', surcharge: 10 })).status, 200);
  assert.equal((await hr('/bir1601c/file', { month: '2026-09', filedOn: '2026-10-08', confirmationNo: 'EBF-1' })).json.status, 'filed');
  assert.equal((await hr('/bir1601c/reopen', { month: '2026-09', reason: 'Amended return' })).status, 403);
  const xlsx = await hr('/bir1601c/2026-09.xlsx');
  assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');
  // Report library.
  const data = workbook({ Sheet1: [['Month', 'Amount'], ['Oct', 1]] }).toString('base64');
  const up = await hr('/report-library', { title: 'Accrual', category: 'Accounting', access: 'pay', fileName: 'a.xlsx', data });
  assert.equal(up.status, 201);
  assert.equal((await hr(`/report-library/${up.json.id}/versions`, { fileName: 'a.xlsx', data, note: 'November added' })).status, 201);
  assert.equal((await hr(`/report-library/${up.json.id}`, { title: 'Accrual 2026', category: 'Accounting', access: 'pay', description: '' })).status, 200);
  assert.equal((await hr('/report-library')).json.files[0].versions.length, 2);
  assert.equal((await hr(`/report-library/${up.json.id}/download?version=1`)).buffer.subarray(0, 2).toString(), 'PK');
  assert.equal((await staff(`/report-library/${up.json.id}/download`)).status, 404, 'pay files are hidden from HR staff');
  assert.equal((await emp('/report-library')).status, 403);
  assert.equal((await hr('/bir1601c/unknown')).status, 404);
});
