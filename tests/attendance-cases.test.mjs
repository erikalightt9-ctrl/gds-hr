import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll, saveRecord } from '../src/service.mjs';
import { completeState, admin } from './helpers.mjs';
import { dates, isRest } from '../src/engine.mjs';
import { dayStatuses } from '../src/attendance-days.mjs';
import { refreshCases, listCases, myCases, setTreatment, decideOverpayment } from '../src/attendance-cases.mjs';

// EMP-001: Mon-Fri 08:00-16:00 (8 h, no meal break). November 2026: Nov 4 has no record at all, Nov 5 only a time in.
const NOW = new Date('2026-11-14T02:00:00Z');   // Saturday Nov 14, 10:00 AM Manila
const worker = { username: 'emp', role: 'employee', employeeId: 'EMP-001' };
const day = (d, extra = {}) => ({ id: `a-${d}`, employeeId: 'EMP-001', date: d, status: 'present', scheduledIn: '08:00', timeIn: '08:00', timeOut: '16:00', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true, ...extra });
function fixture() {
  const store = new Store(':memory:'), s = completeState(); s.loans = []; s.holidays = [{ id: 'h', date: '2026-11-02', name: "All Souls' Day", kind: 'special', basis: 'Test' }];
  const e = s.employees[0];
  s.attendance = dates('2026-11-01', '2026-11-30').filter(d => !isRest(e, d) && !['2026-11-02', '2026-11-04', '2026-11-05'].includes(d)).map(d => day(d));
  s.leaves = []; store.write(s);
  store.db.prepare('INSERT INTO employee_profiles(employee_id,section,data) VALUES(?,?,?)').run(e.id, 'attendance', JSON.stringify({ scheduleEnd: '16:00', hoursPerDay: 8, mealBreakMinutes: 0 }));
  store.db.prepare('INSERT INTO clock_events VALUES(?,?,?,?,?)').run('in-nov5', e.id, 'in', '2026-11-05', JSON.stringify({ id: 'in-nov5', employeeId: e.id, kind: 'in', workDate: '2026-11-05', time: '08:00', recordedAt: '2026-11-05T00:00:00Z' }));
  return store;
}
const run = (store, s, e) => preview(store, s, e, false, ['EMP-001']);
const post = (store, s, e) => { const p = run(store, s, e); assert.deepEqual(p.blockers, [], `no blockers ${s}`); return postPayroll(store, admin, { start: s, end: e, pay13th: false, fingerprint: p.fingerprint, employeeIds: ['EMP-001'] }); };
const caseOf = (store, date) => listCases(store, admin).find(c => c.date === date);

test('day-by-day status: every date in order, rest days / holidays labelled, gaps flagged without assuming anything', () => {
  const store = fixture();
  try {
    const s = store.read(), days = dayStatuses(store, s, s.employees[0], '2026-11-01', '2026-11-16', NOW);
    assert.equal(days.length, 16, 'every date, including those with no record');
    const by = Object.fromEntries(days.map(d => [d.date.slice(8), d]));
    assert.equal(by['01'].kind, 'rest'); assert.equal(by['01'].issue, null);
    assert.match(by['02'].label, /All Souls' Day \(special day\)/); assert.equal(by['02'].issue, null, 'an unworked holiday is not a gap');
    assert.deepEqual([by['04'].issue, by['04'].issueLabel], ['no-record', 'No Time-In / Time-Out']);
    assert.deepEqual([by['05'].issue, by['05'].timeIn], ['missing-out', '08:00']);
    assert.equal(by['13'].issue, null);
    assert.equal(by['16'].issue, null, 'a day not reached yet is not missing anything');
  } finally { store.close(); }
});

test('cases: detected once, employee and HR notified, 3 working days to correct, escalated when overdue', () => {
  const store = fixture();
  try {
    assert.deepEqual(refreshCases(store, NOW), { opened: 2, resolved: 0 });
    assert.deepEqual(refreshCases(store, NOW), { opened: 0, resolved: 0 }, 'never twice');
    const c4 = caseOf(store, '2026-11-04');
    assert.equal(c4.due, '2026-11-18', 'Nov 16, 17, 18 (weekend skipped)');
    assert.deepEqual([c4.correction.status, c4.payment.label], ['not-requested', 'Treatment needed before posting']);
    const notes = store.db.prepare('SELECT employee_id, message FROM notifications').all();
    assert.equal(notes.filter(n => n.employee_id === 'EMP-001' && /please submit a time correction request/.test(n.message)).length, 2);
    assert.ok(notes.some(n => n.employee_id === null && /2 incomplete attendance records detected/.test(n.message)));
    assert.equal(myCases(store, worker).length, 2);
    refreshCases(store, new Date('2026-11-19T02:00:00Z'));
    assert.ok(caseOf(store, '2026-11-04').escalatedAt, 'escalated after Nov 18');
    assert.ok(store.db.prepare('SELECT message FROM notifications WHERE employee_id IS NULL').all().some(n => /still has no approved correction/.test(n.message)));
  } finally { store.close(); }
});

test('payroll: unresolved days need HR documented treatment; credit pays the day, hold does not; nothing assumed', () => {
  const store = fixture();
  try {
    refreshCases(store, NOW);
    const before = run(store, '2026-11-01', '2026-11-15');
    assert.ok(before.reviewItems.some(i => i.date === '2026-11-04' && i.issue === 'missing-punch'));
    assert.ok(before.reviewItems.some(i => i.date === '2026-11-05' && /no time out/.test(i.detail)));
    assert.throws(() => setTreatment(store, admin, caseOf(store, '2026-11-04').id, { mode: 'credit', note: '' }), /reason/);
    setTreatment(store, admin, caseOf(store, '2026-11-04').id, { mode: 'credit', note: 'Supervisor confirms he worked; awaiting his request' });
    setTreatment(store, admin, caseOf(store, '2026-11-05').id, { mode: 'hold', note: 'No proof of the hours worked yet' });
    const after = run(store, '2026-11-01', '2026-11-15'), row = after.rows[0];
    assert.deepEqual(after.blockers, []);
    assert.ok(row.trace.some(t => /No time-in \/ time-out on 2026-11-04: HR treatment by admin \(credited pending verification\)/.test(t.formula)));
    assert.ok(row.trace.some(t => /2026-11-05.*held until corrected/.test(t.formula)));
    assert.ok(row.trace.some(t => t.date === '2026-11-05' && /not credited/.test(t.formula)), 'held day: not credited');
    assert.ok(!row.trace.some(t => t.date === '2026-11-04' && /not credited/.test(t.formula)), 'credited day: no deduction');
  } finally { store.close(); }
});

test('corrections after payment: only the difference; underpayment paid next payroll, overpayment waits for HR', () => {
  const store = fixture();
  try {
    refreshCases(store, NOW);
    setTreatment(store, admin, caseOf(store, '2026-11-04').id, { mode: 'hold', note: 'Not credited until he files' });
    setTreatment(store, admin, caseOf(store, '2026-11-05').id, { mode: 'credit', note: 'Time in verified' });
    post(store, '2026-11-01', '2026-11-15');
    // HR completes both days: Nov 4 a full day (it was not paid), Nov 5 out at 14:00 (paid as a full day).
    saveRecord(store, admin, 'attendance', day('2026-11-04'));
    saveRecord(store, admin, 'attendance', { ...day('2026-11-05', { timeOut: '14:00' }), id: 'clock-in-nov5' });
    refreshCases(store, NOW);
    const c4 = caseOf(store, '2026-11-04'), c5 = caseOf(store, '2026-11-05');
    assert.equal(c4.status, 'resolved'); assert.equal(c5.status, 'resolved');
    assert.equal(c4.adjustment.kind, 'underpayment'); assert.equal(c4.adjustment.status, 'pending');
    assert.ok(c4.adjustment.amount > 1000, `about one day's pay: ${c4.adjustment.amount}`);
    assert.equal(c5.adjustment.kind, 'overpayment'); assert.equal(c5.adjustment.status, 'review');
    const next = run(store, '2026-11-16', '2026-11-30').rows[0];
    assert.equal(next.caseAdjustments.length, 1, 'only the underpayment is released automatically');
    assert.ok(next.trace.some(t => /Attendance correction 2026-11-04: underpayment/.test(t.formula)));
    decideOverpayment(store, admin, c5.id, { action: 'recover', note: 'Left at 2 PM; recovered per policy' });
    const withRecovery = run(store, '2026-11-16', '2026-11-30').rows[0];
    assert.equal(withRecovery.caseAdjustments.length, 2);
    assert.ok(withRecovery.trace.some(t => t.side === 'deductions' && /overpayment in the 2026-11-01 to 2026-11-15 payroll recovered/.test(t.formula)));
    post(store, '2026-11-16', '2026-11-30');
    assert.equal(caseOf(store, '2026-11-04').adjustment.status, 'included');
    assert.match(caseOf(store, '2026-11-04').payment.label, /Included in payroll 2026-11-16 to 2026-11-30|Paid/);
    assert.equal(run(store, '2026-12-01', '2026-12-15').rows[0]?.caseAdjustments?.length ?? 0, 0, 'never paid twice');
  } finally { store.close(); }
});

test('end-of-day check: an hour after the shift, a time in without a time out reminds the employee once and HR once', async () => {
  const { endOfDayCheck } = await import('../src/attendance-cases.mjs');
  const store = fixture();
  try {
    assert.equal(endOfDayCheck(store, new Date('2026-11-05T08:30:00Z')), 0, '16:30: still within the hour after 16:00');
    assert.equal(endOfDayCheck(store, new Date('2026-11-05T09:30:00Z')), 1, '17:30: reminded');
    assert.equal(endOfDayCheck(store, new Date('2026-11-05T10:30:00Z')), 0, 'only once');
    const notes = store.db.prepare('SELECT employee_id, message FROM notifications').all();
    assert.ok(notes.some(n => n.employee_id === 'EMP-001' && /have not timed out/.test(n.message)));
    assert.ok(notes.some(n => n.employee_id === null && /still without a time out/.test(n.message)));
  } finally { store.close(); }
});

test('HR absent decision: the no-record day shows as Absent (verified by HR) and its case closes', async () => {
  const { recordPayrollDecision } = await import('../src/attendance-validation.mjs');
  const store = fixture();
  try {
    refreshCases(store, NOW);
    recordPayrollDecision(store, admin, { employeeId: 'EMP-001', date: '2026-11-04', mode: 'absent', note: 'HR: absent, no time in / out.' });
    const s = store.read(), d4 = dayStatuses(store, s, s.employees[0], '2026-11-04', '2026-11-04', NOW)[0];
    assert.deepEqual([d4.issue, d4.status, d4.absentByHr], [null, 'absent', true]);
    assert.deepEqual(refreshCases(store, NOW), { opened: 0, resolved: 1 });
    assert.deepEqual([caseOf(store, '2026-11-04').status, caseOf(store, '2026-11-04').resolution], ['resolved', 'Absent (verified by HR)']);
    assert.equal(caseOf(store, '2026-11-05').status, 'open', 'other gaps stay open');
  } finally { store.close(); }
});
