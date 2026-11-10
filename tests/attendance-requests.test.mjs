import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { punch } from '../src/portal.mjs';
import { submitAttendanceRequest, ownAttendanceRequests, cancelAttendanceRequest, replyAttendanceRequest, attendanceRequestsOverview, startReview, requestInformation, rejectAttendanceRequest, approveAttendanceRequest, remindOverdueRequests } from '../src/attendance-requests.mjs';

const worker = { id: 'worker', username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
const NOW = new Date('2026-09-03T03:00:00Z');   // Sep 3, 11:00 Manila
function fixture() { const store = new Store(':memory:'); const state = completeState(); state.attendance = []; store.write(state); return store; }
const dayRecord = (store, day) => store.read().attendance.find(a => a.employeeId === 'EMP-001' && a.date === day);
const forgotIn = extra => ({ category: 'forgot-in', date: '2026-09-02', timeIn: '08:55', timeOut: '18:05', location: 'Head office, Makati', reason: 'Phone battery was empty in the morning', ...extra });

test('submit: reference number, Pending HR approval, notices; nothing in attendance changes yet', () => {
  const store = fixture();
  try {
    const r = submitAttendanceRequest(store, worker, forgotIn(), NOW);
    assert.match(r.reference, /^AR-2026-0001$/); assert.equal(r.status, 'pending');
    assert.equal(dayRecord(store, '2026-09-02'), undefined, 'never automatically approved');
    assert.equal(submitAttendanceRequest(store, worker, forgotIn({ date: '2026-09-01' }), NOW).reference, 'AR-2026-0002');
    assert.throws(() => submitAttendanceRequest(store, worker, forgotIn(), NOW), /already have an open request/);
    assert.throws(() => submitAttendanceRequest(store, worker, forgotIn({ date: '2026-07-20' }), NOW), /30 days/);
    assert.throws(() => submitAttendanceRequest(store, worker, forgotIn({ date: '2026-09-04' }), NOW), /today or earlier/);
    assert.throws(() => submitAttendanceRequest(store, worker, forgotIn({ location: '' }), NOW), /exact place/);
    assert.throws(() => submitAttendanceRequest(store, worker, { category: 'failed', date: '2026-09-02', timeIn: '09:00', reason: 'Wi-Fi was down all morning' }, NOW), /Describe the problem/);
    assert.throws(() => submitAttendanceRequest(store, worker, { category: 'offsite', date: '2026-09-02', timeIn: '09:00', location: 'Client site', reason: 'Forgot to time in' }, NOW), /purpose/);
    assert.throws(() => submitAttendanceRequest(store, worker, { category: 'system', date: '2026-09-02', timeIn: '09:00', reason: 'The app showed an error' }, NOW), /Describe the problem/);
    const system = submitAttendanceRequest(store, worker, { category: 'system', transaction: 'in', date: '2026-09-02', timeIn: '09:00', problem: 'The time in button showed a server error', reason: 'System error' }, NOW);
    assert.equal(system.category, 'system');
    assert.ok(store.db.prepare('SELECT message FROM notifications').all().some(n => /System error \(app, website or server problem\)/.test(n.message)));
    assert.equal(ownAttendanceRequests(store, worker).length, 3);
    const notices = store.db.prepare('SELECT message FROM notifications').all().map(n => n.message);
    assert.ok(notices.some(m => /AR-2026-0001.*submitted/.test(m)) && notices.some(m => /new attendance request AR-2026-0001/.test(m)));
  } finally { store.close(); }
});

test('HR flow: review, ask for information, employee replies, approve with a different time (remark required) → HR-approved adjustment', () => {
  const store = fixture();
  try {
    const r = submitAttendanceRequest(store, worker, forgotIn(), NOW);
    assert.equal(startReview(store, admin, r.id).status, 'review');
    assert.equal(requestInformation(store, admin, r.id, { note: 'Please attach your gate log.' }).status, 'info');
    assert.throws(() => approveAttendanceRequest(store, admin, r.id, { timeIn: '09:10', remarks: 'x' }), /different time than filed needs a remark/);
    assert.equal(replyAttendanceRequest(store, worker, r.id, { note: 'The guard confirmed 08:55.' }).status, 'pending');
    const done = approveAttendanceRequest(store, admin, r.id, { timeIn: '09:10', remarks: 'Guard log shows 09:10' });
    assert.equal(done.status, 'approved'); assert.deepEqual(done.decision.requested, { timeIn: '08:55', timeOut: '18:05', endNextDay: false });
    assert.equal(done.decision.approved.timeIn, '09:10'); assert.equal(done.decision.by, admin.username);
    const record = dayRecord(store, '2026-09-02');
    assert.equal(record.timeIn, '09:10'); assert.equal(record.timeOut, '18:05'); assert.equal(record.approved, true);
    assert.match(record.explanation, /^HR-approved adjustment AR-2026-0001/);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM attendance_corrections WHERE attendance_id=?').get(record.id).n, 1, 'kept in the correction history');
    assert.throws(() => rejectAttendanceRequest(store, admin, r.id, { remarks: 'Too late now' }), /already decided/);
  } finally { store.close(); }
});

test('forgot time out: approval completes the open time in; the original time in stays', () => {
  const store = fixture(), day = '2026-09-02', at = new Date(`${day}T09:00:00+08:00`);
  try {
    punch(store, worker, { kind: 'in', requestId: '91111111-1111-4111-8111-111111111111', latitude: 14.55, longitude: 121.02, accuracy: 10, capturedAt: at.toISOString() }, at, { ip: '1.2.3.4' });
    const r = submitAttendanceRequest(store, worker, { category: 'forgot-out', date: day, timeOut: '18:20', reason: 'Left in a hurry for a client call' }, NOW);
    approveAttendanceRequest(store, admin, r.id, {});
    const record = dayRecord(store, day);
    assert.equal(record.timeIn, '09:00'); assert.equal(record.timeOut, '18:20');
    assert.ok(!store.read().openClockIns.some(c => c.workDate === day), 'no longer an open time in');
  } finally { store.close(); }
});

test('reject needs a reason and leaves the record unchanged; cancel by employee; overview counts; overdue reminder once a day', () => {
  const store = fixture();
  try {
    const a = submitAttendanceRequest(store, worker, forgotIn(), NOW), b = submitAttendanceRequest(store, worker, forgotIn({ date: '2026-09-01' }), NOW);
    assert.throws(() => rejectAttendanceRequest(store, admin, a.id, { remarks: 'no' }), /reason for rejecting/);
    assert.equal(rejectAttendanceRequest(store, admin, a.id, { remarks: 'No proof of attendance that day' }).status, 'rejected');
    assert.equal(dayRecord(store, '2026-09-02'), undefined);
    assert.equal(cancelAttendanceRequest(store, worker, b.id).status, 'cancelled');
    const c = submitAttendanceRequest(store, worker, forgotIn({ date: '2026-08-31' }), NOW);
    const overview = attendanceRequestsOverview(store, admin);
    assert.equal(overview.requests.length, 3); assert.equal(overview.requests.find(x => x.id === c.id).current, null);
    assert.throws(() => attendanceRequestsOverview(store, worker), /permission/i);
    const later = new Date(Date.now() + 49 * 3600000);
    assert.deepEqual(remindOverdueRequests(store, later), [c.reference]);
    assert.deepEqual(remindOverdueRequests(store, later), [], 'one reminder per request per day');
  } finally { store.close(); }
});
