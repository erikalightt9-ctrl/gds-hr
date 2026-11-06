import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview } from '../src/service.mjs';
import { completeState } from './helpers.mjs';
import { fileOvertime, editOvertime, cancelOvertime, decideOvertime, overtimeQueue, myOvertime } from '../src/overtime.mjs';

const worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' }, hr = { username: 'hr1', role: 'hr' };
const day = '2026-09-01';
// Approval policy "separate" (the default); EMP-001 works 08:00-16:00 (8 h) in the fixture.
function fixture(change = () => {}) { const store = new Store(':memory:'), s = completeState(); s.loans = []; delete s.rules[0].overtimeApproval; change(s); store.write(s); return store; }
const run = store => preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
const otHours = row => row.trace.filter(x => /OT$/.test(x.component) && x.amount > 0).reduce((s, x) => s + x.quantity, 0);
const leaveAt = time => s => { s.attendance.find(a => a.date === day).timeOut = time; };

test('an application computes hours less unpaid breaks, past midnight too, and refuses overlapping periods', () => {
  const store = fixture();
  try {
    const night = fileOvertime(store, worker, { date: day, startTime: '22:00', endTime: '01:00', breakMinutes: 30, reason: 'Server migration (demo)' });
    assert.equal(night.hours, 2.5, '3 h period less a 30-minute break');
    assert.equal(night.status, 'pending'); assert.equal(night.history[0].action, 'submitted');
    assert.throws(() => fileOvertime(store, worker, { date: day, startTime: '23:00', endTime: '23:30', reason: 'Overlap (demo)' }), /already filed for an overlapping time/);
    assert.throws(() => fileOvertime(store, worker, { date: '2026-09-02', startTime: '00:00', endTime: '00:45', reason: 'Overlap next day (demo)' }), /overlapping/, 'the period continues into the next date');
    assert.doesNotThrow(() => fileOvertime(store, worker, { date: day, startTime: '17:00', endTime: '19:00', reason: 'Separate period (demo)' }));
    assert.throws(() => fileOvertime(store, worker, { date: '2026-09-03', startTime: '17:00', endTime: '18:00', breakMinutes: 60, reason: 'All break (demo)' }), /break must be shorter/);
  } finally { store.close(); }
});

test('the employee edits or cancels a pending application; decided ones are locked; every step is kept', () => {
  const store = fixture();
  try {
    const o = fileOvertime(store, worker, { date: day, startTime: '17:00', endTime: '19:00', reason: 'Report (demo)' });
    const edited = editOvertime(store, worker, o.id, { date: day, startTime: '17:00', endTime: '20:00', breakMinutes: 15, reason: 'Report and review (demo)' });
    assert.equal(edited.hours, 2.75);
    assert.deepEqual(edited.history.map(h => h.action), ['submitted', 'edited']);
    assert.match(edited.history[1].note, /was 2026-09-01 17:00–19:00, 2 h/);
    assert.throws(() => editOvertime(store, { ...worker, employeeId: 'EMP-002' }, o.id, { date: day, startTime: '17:00', endTime: '18:00', reason: 'Not mine (demo)' }), /not found/);
    assert.throws(() => decideOvertime(store, hr, o.id, { decision: 'approve', hours: 2 }), /reason for approving 2 h instead of the 2.75 h/);
    const approved = decideOvertime(store, hr, o.id, { decision: 'approve', hours: 2, adjustReason: 'Review was not authorised (demo)', remarks: 'Thanks' });
    assert.equal(approved.approvedHours, 2); assert.equal(approved.adjustReason, 'Review was not authorised (demo)');
    assert.equal(approved.history.at(-1).action, 'approved');
    assert.throws(() => editOvertime(store, worker, o.id, { date: day, startTime: '17:00', endTime: '18:00', reason: 'Too late (demo)' }), /Only pending/);
    assert.throws(() => cancelOvertime(store, worker, o.id), /Only pending/);
    const notice = store.db.prepare("SELECT message FROM notifications WHERE employee_id='EMP-001' ORDER BY rowid DESC").get().message;
    assert.match(notice, /approved \(2 h of 2.75 h filed: Review was not authorised/);
    assert.ok(store.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE employee_id IS NULL AND message LIKE '%overtime%'").get().n >= 2, 'HR is told about the application and the change');
    const second = fileOvertime(store, worker, { date: '2026-09-02', startTime: '17:00', endTime: '18:00', reason: 'Close (demo)' });
    assert.equal(cancelOvertime(store, worker, second.id).history.at(-1).action, 'cancelled');
    assert.equal(myOvertime(store, worker).length, 2, 'cancelled applications stay in the history');
  } finally { store.close(); }
});

test('payroll pays only time worked inside the approved period, in 30-minute blocks', () => {
  const store = fixture(leaveAt('19:00'));
  try {
    const o = fileOvertime(store, worker, { date: day, startTime: '17:00', endTime: '19:00', reason: 'Closing (demo)' });
    decideOvertime(store, hr, o.id, { decision: 'approve' });
    const row = run(store).rows[0];
    assert.equal(otHours(row), 2, '17:00-19:00 is paid; 16:00-17:00 is outside the approved period');
    assert.ok(row.trace.some(x => /outside the approved overtime period/.test(x.formula)));
    const q = overtimeQueue(store, hr)[0];
    assert.deepEqual([q.workedInPeriod, q.payableHours, q.flags], [2, 2, []]);
  } finally { store.close(); }
});

test('approved overtime the attendance does not support is flagged before posting', () => {
  const store = fixture(s => { leaveAt('19:00')(s); s.attendance = s.attendance.filter(a => a.date !== '2026-09-02'); });
  try {
    const short = fileOvertime(store, worker, { date: day, startTime: '18:00', endTime: '21:00', reason: 'Event (demo)' });
    decideOvertime(store, hr, short.id, { decision: 'approve' });
    const missing = fileOvertime(store, hr, { employeeId: 'EMP-001', date: '2026-09-02', startTime: '17:00', endTime: '19:00', reason: 'Recorded by HR (demo)' });
    assert.equal(missing.status, 'approved');
    const computed = run(store);
    assert.equal(otHours(computed.rows[0]), 1, 'only 18:00-19:00 was worked inside the approved 18:00-21:00');
    assert.ok(computed.blockers.some(b => /approved overtime on 2026-09-01 is 3 h but attendance shows 1 h/.test(b)));
    assert.ok(computed.blockers.some(b => /approved overtime on 2026-09-02 \(2 h\) has no attendance record/.test(b)));
    const q = overtimeQueue(store, hr);
    assert.match(q.find(x => x.id === short.id).flags.join(), /Worked 1 h within the period, 2 h less than approved/);
    assert.match(q.find(x => x.id === missing.id).flags.join(), /No attendance recorded/);
  } finally { store.close(); }
});

test('overtime past midnight is paid within the approved period, with night differential', () => {
  const store = fixture(s => { const a = s.attendance.find(x => x.date === day); a.timeOut = '01:00'; a.endNextDay = true; });
  try {
    const o = fileOvertime(store, worker, { date: day, startTime: '22:00', endTime: '01:00', breakMinutes: 30, reason: 'Deployment (demo)' });
    decideOvertime(store, hr, o.id, { decision: 'approve' });
    const row = run(store).rows[0];
    assert.equal(otHours(row), 2.5, '2.5 approved hours inside 22:00-01:00');
    assert.ok(row.earnings.nsd > 0, 'night differential applies');
  } finally { store.close(); }
});

test('HR can waive the unsupported-overtime check for a cutoff: only the supported hours are paid', () => {
  const store = fixture(leaveAt('19:00'));
  try {
    const short = fileOvertime(store, worker, { date: day, startTime: '18:00', endTime: '21:00', reason: 'Event (demo)' });
    decideOvertime(store, hr, short.id, { decision: 'approve' });
    store.db.prepare('INSERT INTO payroll_inputs(employee_id,start,end,data) VALUES(?,?,?,?)').run('EMP-001', '2026-09-01', '2026-09-15', JSON.stringify({ employeeId: 'EMP-001', start: '2026-09-01', end: '2026-09-15', mode: 'add', hours: {}, overrides: [], waiveOvertimeCheck: true, updatedBy: 'hr1' }));
    const computed = run(store);
    assert.ok(!computed.blockers.some(b => /approved overtime on 2026-09-01/.test(b)), 'waived');
    assert.equal(otHours(computed.rows[0]), 1, 'still only the hour worked inside the approved period');
    assert.ok(computed.rows[0].trace.some(x => /Waived by hr1: approved overtime on 2026-09-01 is 3 h; only 1 h/.test(x.formula)));
  } finally { store.close(); }
});
