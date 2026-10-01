import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { punch, employeeDashboard, applyLeave, cancelLeave, submitExplanation, reviewExplanation, liveDashboard, ownPayslip, geofence, correctClock, payslipPdf, locationAddress, earlierHistory } from '../src/portal.mjs';
import { addUser, login, issuePasswordReset, redeemPasswordReset, session, totpCode, configureMfa, setDisabled, requestRecovery } from '../src/auth.mjs';
import { saveProfile } from '../src/profiles.mjs';
import { saveRecord, preview, postPayroll } from '../src/service.mjs';
import { createApp } from '../src/server.mjs';
const worker = { id: 'worker', username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
function fixture() { const store = new Store(':memory:'); const state = completeState(); state.attendance = []; store.write(state); return store; }
const reading = (kind, id, now) => ({ kind, requestId: id, latitude: 14.55, longitude: 121.02, accuracy: 15, capturedAt: now.toISOString() });
test('clock events are immutable, server-timed, idempotent and become payroll attendance on checkout', () => {
  const store = fixture();
  try {
    const now = new Date('2026-09-18T00:17:00Z');
    const event = punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', now), now);
    assert.equal(event.time, '08:17'); assert.equal(event.employeeId, worker.employeeId);
    assert.equal(punch(store, worker, reading('in', event.id, now), now).id, event.id);
    assert.throws(() => punch(store, worker, reading('in', '22222222-2222-4222-8222-222222222222', now), now));
    assert.equal(liveDashboard(store, admin, now).employees[0].status, 'Late');
    const end = new Date('2026-09-18T09:00:00Z');
    punch(store, worker, reading('out', '33333333-3333-4333-8333-333333333333', end), end);
    assert.equal(store.read().attendance[0].timeIn, '08:17');
    assert.equal(store.read().attendance[0].timeOut, '17:00');
    assert.equal(store.read().attendance[0].approved, false);
    assert.throws(() => store.db.prepare('DELETE FROM clock_events WHERE id=?').run(event.id), /immutable/);
    assert.equal(employeeDashboard(store, worker, end).history.length, 2);
    assert.equal(earlierHistory(store, worker, '33333333-3333-4333-8333-333333333333')[0].id, event.id);
    assert.throws(() => earlierHistory(store, worker, 'missing'), /not found/);
  } finally { store.close(); }
});
test('HR corrections preserve original clock events and record their approver and reason', () => {
  const store = fixture();
  try {
    const now = new Date('2026-09-18T00:17:00Z');
    const original = punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', now), now);
    assert.throws(() => correctClock(store, worker, {}));
    const corrected = correctClock(store, admin, { employeeId: worker.employeeId, date: original.workDate, timeOut: '17:00', endNextDay: false, reason: 'Employee forgot to clock out; schedule verified.' });
    assert.equal(corrected.timeIn, original.time);
    assert.equal(employeeDashboard(store, worker, new Date('2026-09-18T10:00:00Z')).today.open, false);
    assert.equal(store.db.prepare('SELECT data FROM clock_events WHERE id=?').get(original.id).data, JSON.stringify(original));
    assert.equal(employeeDashboard(store, worker, now).corrections[0].approver, admin.username);
    assert.throws(() => saveRecord(store, admin, 'attendance', { ...corrected, timeOut: '18:00' }), /reason/);
    saveRecord(store, admin, 'attendance', { ...corrected, timeOut: '18:00', correctionReason: 'Approved additional work, verified by HR.' });
    const explanation = submitExplanation(store, worker, { date: original.workDate, reason: 'Transit delay', explanation: 'Train disruption documented', requestedOffset: 17, documentId: '' });
    reviewExplanation(store, admin, explanation.id, { status: 'approved', approvedOffset: 17, note: 'Verified transit disruption' });
    assert.equal(store.read().attendance[0].offsetMinutes, 17);
    assert.equal(store.read().attendance[0].approved, false);
  } finally { store.close(); }
});
test('employees receive only their own posted payslip and payroll posting notifications', () => {
  const store = fixture(); store.write(completeState());
  try {
    const computed = preview(store, '2026-09-01', '2026-09-15');
    const run = postPayroll(store, admin, { start: computed.start, end: computed.end, fingerprint: computed.fingerprint, pay13th: false });
    const payslip = ownPayslip(store, worker, run.id);
    assert.equal(payslip.employeeId, worker.employeeId); assert.equal(payslip.loans[0].type, 'Salary Loan');
    assert.ok(!('sources' in payslip)); assert.match(payslipPdf(payslip).toString(), /^%PDF-1.4/);
    assert.ok(employeeDashboard(store, worker).notifications.some(n => n.message.includes('payslip')));
    const state = store.read(); state.employees.push({ ...state.employees[0], id: 'OTHER', name: 'Other Employee' }); store.write(state);
    assert.throws(() => ownPayslip(store, { ...worker, employeeId: 'OTHER' }, run.id), /not found/);
  } finally { store.close(); }
});
test('downloaded payslips itemize contributions, individual loans and adjustments without double counting', () => {
  const store = fixture(); store.write(completeState());
  try {
    const computed = preview(store, '2026-09-01', '2026-09-15');
    const run = postPayroll(store, admin, { start: computed.start, end: computed.end, fingerprint: computed.fingerprint, pay13th: false });
    const state = store.read(), row = state.runs.find(r => r.id === run.id).rows[0];
    row.loanDeductions.push({ type: 'SSS Loan', reference: 'TEST-SSS', amount: 250, previousBalance: 1000, remainingBalance: 750 });
    row.deductions.loans += 250; row.deductions.other += 75;
    row.trace.push({ component: 'other', side: 'deductions', amount: 25, formula: 'Authorized uniform repayment', date: run.end }, { component: 'other', side: 'deductions', amount: 50, formula: 'Authorized cash advance', date: run.end });
    row.totalDeductions += 325; row.net -= 325; store.write(state);
    const p = ownPayslip(store, worker, run.id), pdf = payslipPdf(p).toString();
    assert.equal(Math.round(p.deductionItems.reduce((sum, i) => sum + i.amount, 0) * 100), Math.round(p.totalDeductions * 100));
    for (const label of ['SSS', 'PhilHealth', 'Pag-IBIG', 'Salary Loan', 'SSS Loan (TEST-SSS)', 'Authorized uniform repayment', 'Authorized cash advance']) assert.ok(p.deductionItems.some(i => i.label === label || i.label.startsWith(`${label} (`)), label);
    assert.ok(p.computation.some(t => t.component === 'basic' && t.formula));
    assert.ok(p.computation.every(t => !('sourceId' in t)));
    assert.equal(p.monthlySalary, row.monthlySalary);
    assert.match(pdf, /ITEMIZED DEDUCTIONS/); assert.match(pdf, /SALARY COMPUTATION/); assert.match(pdf, /SSS Loan/); assert.match(pdf, /PHP 1000.00 - PHP 250.00 = PHP 750.00/);
  } finally { store.close(); }
});
test('two-factor setup, replay protection, recovery and disabled accounts', async () => {
  const store = fixture();
  try {
    assert.equal(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082', 'RFC 6238 SHA-1 vector truncated to six digits');
    const user = await addUser(store, { username: 'mfa.employee', password: 'Original-password-123', role: 'employee', employeeId: 'EMP-001' }, admin);
    const setup = await configureMfa(store, user, { action: 'begin', password: 'Original-password-123' });
    const code = totpCode(setup.secret);
    await configureMfa(store, user, { action: 'confirm', password: 'Original-password-123', code });
    await assert.rejects(login(store, user.username, 'Original-password-123', 'mfa1'), /authenticator/);
    await assert.rejects(login(store, user.username, 'Original-password-123', 'mfa2', code), /already used/);
    const nextCode = totpCode(setup.secret, Date.now() + 30000);
    const signed = await login(store, user.username, 'Original-password-123', 'mfa3', nextCode);
    assert.equal(signed.user.mfaEnabled, true);
    requestRecovery(store, user.username); assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM recovery_requests').get().n, 1);
    const reset = issuePasswordReset(store, admin, user.id, true); await redeemPasswordReset(store, reset.token, 'Replacement-password-123');
    setDisabled(store, admin, user.id, true);
    await assert.rejects(login(store, user.username, 'Replacement-password-123', 'mfa4'), /Incorrect/);
    setDisabled(store, admin, user.id, false);
    assert.equal((await login(store, user.username, 'Replacement-password-123', 'mfa5')).user.mfaEnabled, false);
  } finally { store.close(); }
});
test('employee HTTP isolation, uploads, SSE delivery, approvals and password recovery', async t => {
  const store = fixture(), origin = 'http://127.0.0.1:3400';
  const app = createApp({ store, origin, setupToken: '' });
  await addUser(store, { username: 'admin', password: 'Portal-test-password-123', role: 'admin' });
  await addUser(store, { username: worker.username, password: 'Portal-test-password-123', role: 'employee', employeeId: worker.employeeId }, admin);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = (path, body, auth = {}) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: auth.cookie || '', 'X-CSRF-Token': auth.csrf || '' }, body: body ? JSON.stringify(body) : undefined });
  const signIn = async username => { const response = await call('/api/login', { username, password: 'Portal-test-password-123' }); return { cookie: response.headers.get('set-cookie').split(';')[0], ...(await response.json()) }; };
  const a = await signIn('admin'), e = await signIn(worker.username);
  for (const path of ['/api/state', '/api/audit', '/api/users', '/api/live', '/api/employees/EMP-001/profile', '/api/runs/fake.xlsx', '/api/documents/fake/content', '/api/recovery/requests']) assert.equal((await call(path, null, e)).status, 403, path);
  assert.equal((await call('/api/me/dashboard')).status, 401);
  assert.equal((await call('/api/me/dashboard', null, a)).status, 403);
  const dashboard = await (await call('/api/me/dashboard', null, e)).json(); assert.equal(dashboard.employee.id, worker.employeeId);
  const now = new Date(), clockInput = reading('in', '11111111-1111-4111-8111-111111111111', now);
  assert.equal((await call('/api/me/clock', { ...clockInput, employeeId: 'OTHER' }, e)).status, 400);
  assert.equal((await call('/api/me/clock', clockInput, e)).status, 200);
  assert.equal((await call('/api/me/history?before=' + clockInput.requestId, null, e)).status, 200);
  assert.equal((await call('/api/live', null, a)).status, 200);
  const stream = await call('/api/events', null, a), reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
  const response = await call('/api/me/leaves', { typeId: 'vacation', startDate: '2026-10-01', endDate: '2026-10-01', reason: 'Personal appointment', documentId: '' }, e);
  assert.equal(response.status, 201); const leave = await response.json();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: change/); await reader.cancel();
  assert.equal((await call('/api/me/leaves', { ...leave, employeeId: 'OTHER' }, e)).status, 400);
  assert.equal((await call(`/api/me/leaves/${leave.id}/cancel`, {}, { cookie: e.cookie })).status, 403);
  assert.equal((await call(`/api/me/leaves/${leave.id}/cancel`, {}, e)).status, 200);
  const upload = await call('/api/me/documents', { type: 'Leave Supporting', name: 'note.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4\nfixture').toString('base64') }, e);
  assert.equal(upload.status, 201); const doc = await upload.json();
  assert.equal((await call(`/api/me/documents/${doc.id}/content`, null, e)).status, 200);
  assert.equal((await call('/api/me/documents', { type: 'Government ID' }, e)).status, 403);
  const otherDoc = await call('/api/employees/EMP-001/documents', { type: 'Disciplinary', name: 'private.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4\nfixture').toString('base64') }, a);
  assert.equal((await call(`/api/me/documents/${(await otherDoc.json()).id}/content`, null, e)).status, 403);
  assert.equal((await call('/api/recovery/request', { identifier: worker.employeeId })).status, 200);
  assert.equal((await (await call('/api/recovery/requests', null, a)).json()).length, 1);
  const reset = await (await call(`/api/users/${e.user.id}/reset`, { resetMfa: false }, a)).json();
  assert.equal((await call('/api/recovery/reset', { token: reset.token, password: 'Replacement-password-123' })).status, 200);
  assert.equal((await call('/api/me/dashboard', null, e)).status, 401);
});
test('profile geofences and stale location validation', async () => {
  const store = fixture();
  try {
    saveProfile(store, admin, worker.employeeId, 'attendance', { latitude: 14.55, longitude: 121.02, radiusMeters: 100, approvedLocation: 'Test workplace' });
    const now = new Date('2026-09-18T00:00:00Z');
    assert.throws(() => punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', new Date('2026-09-17T00:00:00Z')), now), /stale/);
    const event = punch(store, worker, reading('in', '22222222-2222-4222-8222-222222222222', now), now);
    assert.equal(event.geofence.status, 'Within');
    assert.equal((await locationAddress(store, worker, event.id, '')).address, null);
    await assert.rejects(locationAddress(store, { ...worker, employeeId: 'OTHER' }, event.id, ''), /not found/);
  } finally { store.close(); }
});
test('geofence accounts for uncertainty and does not promise precise GPS', () => {
  const workplace = { latitude: 14.55, longitude: 121.02, radiusMeters: 100 };
  assert.equal(geofence(reading('in', '', new Date()), workplace).status, 'Within');
  assert.equal(geofence({ latitude: 15, longitude: 121.02, accuracy: 10 }, workplace).status, 'Outside');
  assert.equal(geofence({ latitude: 14.55, longitude: 121.02, accuracy: 200 }, workplace).status, 'Uncertain');
});
test('employees submit and cancel only their own pending leaves and explanations require HR review', () => {
  const store = fixture();
  try {
    const leave = applyLeave(store, worker, { typeId: 'vacation', startDate: '2026-09-21', endDate: '2026-09-21', reason: 'Appointment', documentId: '' });
    assert.equal(leave.status, 'pending'); assert.equal(leave.employeeId, worker.employeeId);
    assert.throws(() => cancelLeave(store, { ...worker, employeeId: 'other' }, leave.id));
    cancelLeave(store, worker, leave.id); assert.equal(store.read().leaves[0].status, 'cancelled');
    const explanation = submitExplanation(store, worker, { date: '2026-09-18', reason: 'Transit delay', explanation: 'Train service disruption', requestedOffset: 17, documentId: '' });
    assert.throws(() => reviewExplanation(store, worker, explanation.id, { status: 'approved', approvedOffset: 17, note: 'Reviewed' }));
  } finally { store.close(); }
});
test('employee account binding and one-time password recovery revoke old sessions', async () => {
  const store = fixture();
  try {
    await addUser(store, { username: 'employee1', password: 'Original-password-123', role: 'employee', employeeId: 'EMP-001' }, admin);
    await assert.rejects(addUser(store, { username: 'employee2', password: 'Original-password-123', role: 'employee', employeeId: 'EMP-001' }, admin));
    const signed = await login(store, 'EMP-001', 'Original-password-123', 'login1'); assert.equal(signed.user.employeeId, 'EMP-001');
    const reset = issuePasswordReset(store, admin, signed.user.id);
    assert.equal(session(store, `hr_session=${signed.token}`), null);
    await redeemPasswordReset(store, reset.token, 'Replacement-password-123');
    await assert.rejects(redeemPasswordReset(store, reset.token, 'Another-password-123'));
    assert.equal((await login(store, 'employee1', 'Replacement-password-123', 'login2')).user.role, 'employee');
    assert.match(totpCode('JBSWY3DPEHPK3PXP', 1234567890000), /^\d{6}$/);
  } finally { store.close(); }
});

