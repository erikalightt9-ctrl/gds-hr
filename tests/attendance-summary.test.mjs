import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';
import { attendanceSummary, myAttendanceSummary } from '../src/attendance-summary.mjs';

const rec = (date, timeIn, timeOut) => ({ id: `t-${date}`, employeeId: 'EMP-001', date, status: 'present', scheduledIn: '08:00', timeIn, timeOut, endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true });
function fixture() {
  const store = new Store(':memory:'), state = completeState();
  // September 2026: 22 weekdays (Saturday and Sunday are rest days). Three days worked, one approved leave day,
  // a Saturday worked (rest day: not a working day), the rest without a record.
  state.attendance = [rec('2026-09-01', '08:00', '16:00'), rec('2026-09-02', '08:20', '16:20'), rec('2026-09-03', '08:10', '16:00'), rec('2026-09-05', '08:00', '12:00')];
  state.leaves = [{ id: 'lv1', employeeId: 'EMP-001', typeId: 'vacation', startDate: '2026-09-04', endDate: '2026-09-04', days: 1, countedDates: ['2026-09-04'], partialDates: [], reason: 'Family', status: 'approved' }];
  store.write(state);
  return store;
}
const now = new Date('2026-10-05T04:00:00Z');

test('month figures follow the day-by-day statuses HR uses (working days, present, absent, leave, late by the grace threshold)', () => {
  const store = fixture();
  try {
    const s = attendanceSummary(store, 'EMP-001', '2026-09', now);
    assert.equal(s.workdays, 22, 'weekdays only: the Saturday worked is a rest day');
    assert.equal(s.present, 3); assert.equal(s.leave, 1); assert.equal(s.absent, 18);
    assert.equal(s.presentRate, Math.round(3 / 22 * 1000) / 10);
    assert.equal(s.late, 1, 'only the 20-minute late counts: 10 minutes is within the 15-minute grace');
    assert.equal(s.lateMinutes, 20);
    assert.equal(s.onTimeRate, Math.round(2 / 3 * 1000) / 10);
    assert.deepEqual(s.bars.map(b => b.date), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05'], 'hours per day include the rest-day work');
    assert.equal(s.hours, Math.round(s.bars.reduce((n, b) => n + b.hours, 0) * 10) / 10);
    assert.equal(s.absences.length, 18); assert.equal(s.absences[0].date, '2026-09-30', 'newest absence first');
    assert.equal(s.leaves[0].type, 'Vacation Leave'); assert.equal(s.leaves[0].status, 'approved');
    assert.ok(s.months.includes('2026-09') && s.months[0] === '2026-10');
  } finally { store.close(); }
});

test('the current month counts only days already reached; employees see only their own; future months refused', () => {
  const store = fixture();
  try {
    const oct = attendanceSummary(store, 'EMP-001', '2026-10', now);
    assert.equal(oct.workdays, 2, 'Oct 1-2 reached (Oct 3-4 weekend, Oct 5 not over and no record)');
    assert.throws(() => attendanceSummary(store, 'EMP-001', '2026-11', now), /started/);
    assert.throws(() => myAttendanceSummary(store, { role: 'hr', username: 'h' }, '2026-09'), /Only employees/);
    assert.equal(myAttendanceSummary(store, { role: 'employee', employeeId: 'EMP-001' }, '2026-09', now).present, 3);
  } finally { store.close(); }
});
