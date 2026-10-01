import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { saveProfile, getProfile, uploadDocument, getDocument, updateDocument, visibleAudit, derivedInformation } from '../src/profiles.mjs';
import { completeState } from './helpers.mjs';
import { leaveBalance, calculatePayroll } from '../src/engine.mjs';
import { saveRecord, postPayroll } from '../src/service.mjs';
import { createApp } from '../src/server.mjs';
const admin = { username: 'admin', role: 'admin' }, viewer = { username: 'viewer', role: 'viewer' };
function fixture() {
  const store = new Store(':memory:');
  const state = store.read();
  state.employees.push({ id: '2017-0420', name: 'HERNANDO, ERIKA L.', draft: true, active: false, startDate: '', endDate: '', monthlySalary: null, department: '', restDays: [], scheduleStart: '', leaveEligibility: [] });
  store.write(state); return store;
}
test('employment requires a position and invalid updates preserve the saved position', () => {
  const store = fixture();
  try {
    for (const position of [undefined, '', '   ']) assert.throws(() => saveProfile(store, admin, '2017-0420', 'employment', { position }), /Position is required/);
    saveProfile(store, admin, '2017-0420', 'employment', { position: '  HR Officer  ' });
    assert.equal(getProfile(store, admin, '2017-0420').sections.employment.position, 'HR Officer');
    assert.throws(() => saveProfile(store, admin, '2017-0420', 'employment', { position: ' ' }), /Position is required/);
    assert.equal(getProfile(store, admin, '2017-0420').sections.employment.position, 'HR Officer');
  } finally { store.close(); }
});
test('private profile sections stay out of shared state and viewer audit', () => {
  const store = fixture();
  try {
    saveProfile(store, admin, '2017-0420', 'government', { sss: 'PRIVATE-SSS' });
    assert.equal(getProfile(store, admin, '2017-0420').sections.government.sss, 'PRIVATE-SSS');
    assert.equal(getProfile(store, viewer, '2017-0420').sections.government, undefined);
    assert.ok(!JSON.stringify(store.read()).includes('PRIVATE-SSS'));
    assert.ok(!JSON.stringify(visibleAudit(store, viewer)).includes('PRIVATE-SSS'));
    assert.throws(() => saveProfile(store, viewer, '2017-0420', 'personal', {}));
    assert.throws(() => saveProfile(store, admin, 'missing', 'personal', {}));
  } finally { store.close(); }
});
test('profile settings drive leave approval, wage rates, working hours and payroll holds', () => {
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const original = store.read(), type = original.leaveTypes.find(t => t.id === 'vacation'), employee = original.employees[0];
    saveProfile(store, admin, employee.id, 'leave', { entitlements: [{ typeId: 'vacation', annualDays: 7, effectiveYear: 2026 }] });
    assert.equal(leaveBalance(store.read(), employee, type, '2026-09-18').entitled, 7);
    assert.equal(leaveBalance(store.read(), employee, type, '2025-09-18').entitled, type.entitledDays);
    const request = { id: 'l1', employeeId: employee.id, typeId: type.id, startDate: '2026-09-16', endDate: '2026-09-16', days: 1, reason: 'Test leave', documentReference: '', status: 'approved', eligibilityVerified: true };
    saveRecord(store, admin, 'leaves', request);
    assert.equal(leaveBalance(store.read(), employee, type, '2026-09-18').available, 6);
    assert.throws(() => saveProfile(store, admin, employee.id, 'leave', { entitlements: [{ typeId: 'vacation', annualDays: 0, effectiveYear: 2026 }] }), /below leave/);
    assert.equal(leaveBalance(store.read(), employee, type, '2026-09-18').entitled, 7, 'failed update rolls back');
    saveProfile(store, admin, employee.id, 'payroll', { dailyRate: 1600, hourlyRate: 200, status: 'Hold', frequency: 'monthly' });
    saveProfile(store, admin, employee.id, 'attendance', { hoursPerDay: 7, graceMinutes: 15 });
    const computed = calculatePayroll(store.read(), '2026-09-01', '2026-09-15');
    assert.equal(computed.rows[0].dailyRate, 1600); assert.equal(computed.rows[0].hourlyRate, 200);
    assert.ok(computed.rows[0].earnings.regularOT > 0);
    assert.ok(computed.blockers.some(b => b.includes('on hold')));
    assert.ok(computed.blockers.some(b => b.includes('frequency differs')));
    assert.throws(() => postPayroll(store, admin, { start: computed.start, end: computed.end, fingerprint: computed.fingerprint, pay13th: false }));
    saveProfile(store, admin, employee.id, 'payroll', { dailyRate: 1600, hourlyRate: 200, status: 'Active', frequency: 'semi-monthly' });
    saveProfile(store, admin, employee.id, 'government', { sss: 'PRIVATE-PAYROLL-EXCLUDED' });
    const next = calculatePayroll(store.read(), '2026-09-01', '2026-09-15');
    const run = postPayroll(store, admin, { start: next.start, end: next.end, fingerprint: next.fingerprint, pay13th: false });
    assert.ok(!JSON.stringify(run).includes('PRIVATE-PAYROLL-EXCLUDED'));
    assert.equal(run.sources.employeeProfiles.find(p => p.section === 'payroll').dailyRate, 1600);
    assert.equal(getProfile(store, admin, employee.id).payroll.length, 1);
  } finally { store.close(); }
});
test('profile validation, shared name and document metadata', () => {
  const store = fixture(), id = '2017-0420';
  try {
    assert.equal(getProfile(store, admin, id).sections.personal.firstName, 'ERIKA');
    saveProfile(store, admin, id, 'personal', { firstName: 'ERIKA', lastName: 'HERNANDO', middleName: 'L.', birthDate: '2000-01-01' });
    assert.equal(store.read().employees[0].name, 'HERNANDO, ERIKA L.');
    assert.throws(() => saveProfile(store, admin, id, 'personal', { firstName: 'Test', birthDate: '2200-01-01' }));
    assert.throws(() => saveProfile(store, admin, id, 'unknown', {}));
    assert.throws(() => saveProfile(store, admin, id, 'leave', { entitlements: [{ typeId: 'missing', annualDays: 7, effectiveYear: 2026 }] }));
    assert.throws(() => saveProfile(store, admin, id, 'attendance', { latitude: 1 }));
    saveProfile(store, admin, id, 'employment', { position: 'Test role', employeeStatus: 'Active' });
    assert.equal(store.read().employees[0].active, false, 'draft stays excluded');
    const doc = uploadDocument(store, admin, id, { type: 'Tax', name: 'tax.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.7\nfixture').toString('base64') });
    const updated = updateDocument(store, admin, doc.id, { status: 'Archived', expiry: '2026-09-17', remarks: 'Test archive' });
    assert.equal(updated.status, 'Archived'); assert.ok(!('content' in updated));
    assert.equal(getDocument(store, { role: 'payroll' }, doc.id).status, 'Archived');
    assert.throws(() => getDocument(store, admin, 'missing'));
    assert.throws(() => uploadDocument(store, viewer, id, {}));
    assert.throws(() => uploadDocument(store, admin, id, { type: 'Photo', name: 'x.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.7').toString('base64') }));
    assert.ok(getProfile(store, admin, id).audit.some(a => a.kind === 'profile:personal'));
  } finally { store.close(); }
});
test('HTTP profile and document routes do not leak restricted sections to viewers', async t => {
  const store = fixture(), origin = 'http://127.0.0.1:3400';
  const app = createApp({ store, origin, setupToken: 'profile-test-token' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = (path, body, auth = {}) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: auth.cookie || '', 'X-CSRF-Token': auth.csrf || '' }, body: body ? JSON.stringify(body) : undefined });
  await call('/api/setup', { token: 'profile-test-token', username: 'admin', password: 'profile-test-password' });
  const login = async username => { const res = await call('/api/login', { username, password: 'profile-test-password' }); return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()) }; };
  const a = await login('admin');
  await call('/api/users', { username: 'viewer', password: 'profile-test-password', role: 'viewer' }, a);
  const v = await login('viewer');
  assert.equal((await call('/api/employees/2017-0420/profiles/bank', { accountNumber: 'PRIVATE-ACCOUNT' }, a)).status, 200);
  const docResponse = await call('/api/employees/2017-0420/documents', { type: 'Medical', name: 'test.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.7\nfixture').toString('base64') }, a);
  assert.equal(docResponse.status, 201); const doc = await docResponse.json();
  assert.equal((await call(`/api/documents/${doc.id}/content`, null, v)).status, 403);
  const download = await call(`/api/documents/${doc.id}/content`, null, a);
  assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /attachment/); assert.match(await download.text(), /^%PDF/);
  assert.equal((await call(`/api/documents/${doc.id}`, { status: 'Archived', remarks: 'archived' }, a)).status, 200);
  for (const path of ['/api/state', '/api/audit', '/api/employees/2017-0420/profile']) {
    const response = await call(path, null, v); assert.equal(response.status, 200); assert.ok(!(await response.text()).includes('PRIVATE-ACCOUNT'));
  }
  assert.equal((await call('/api/employees/2017-0420/profiles/bank', {}, v)).status, 403);
  assert.equal((await call('/api/employees/2017-0420/documents', {}, v)).status, 403);
  assert.equal((await call('/api/employees/2017-0420/profiles/government', {}, { cookie: a.cookie })).status, 403);
});
test('age, service and leap-day anniversary calculations', () => {
  const info = derivedInformation({ startDate: '2020-02-29', endDate: '', monthlySalary: null }, { birthDate: '2000-09-19' }, '2026-09-18');
  assert.equal(info.age, 25); assert.equal(info.serviceMonths, 78); assert.equal(info.nextAnniversary, '2027-02-28');
  assert.equal(derivedInformation({ startDate: '', monthlySalary: null }, {}, '2026-09-18').age, null);
});
test('documents enforce content validation and role restrictions', () => {
  const store = fixture();
  try {
    const doc = uploadDocument(store, admin, '2017-0420', { type: 'Medical', name: 'medical.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.7\nfixture').toString('base64'), expiry: '', remarks: '' });
    assert.equal(getDocument(store, admin, doc.id).name, 'medical.pdf');
    assert.throws(() => getDocument(store, viewer, doc.id));
    assert.equal(getProfile(store, viewer, '2017-0420').documents.length, 0);
    assert.throws(() => uploadDocument(store, admin, '2017-0420', { type: 'Other HR', name: 'bad.pdf', mime: 'application/pdf', data: Buffer.from('<html>bad</html>').toString('base64') }));
  } finally { store.close(); }
});
