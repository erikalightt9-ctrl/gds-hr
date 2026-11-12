import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, withScheduledLunch } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';

// 9:00 AM - 6:00 PM includes a 1-hour lunch: when no break is recorded, the scheduled lunch (12:00 - 1:00 PM) is not
// counted as work time.
const DAY = '2026-11-11';
function state(timeOut, breaks = []) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, dailyDivisor: 26 }];
  s.employees = [{ id: 'E1', name: 'Lunch, Test', department: 'Admin', monthlySalary: 19630, startDate: '2025-01-01', endDate: '', restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
  s.employeeProfiles = [{ employeeId: 'E1', section: 'payroll', basis: 'daily', dailyRate: 755 }, { employeeId: 'E1', section: 'attendance', scheduleEnd: '18:00', hoursPerDay: 8, mealBreakMinutes: 60, paidFrom: 'schedule' }];
  s.attendance = [{ id: 'a1', employeeId: 'E1', date: DAY, status: 'present', scheduledIn: '09:00', timeIn: '08:26', timeOut, endNextDay: false, breaks, approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }];
  return s;
}
const undertimeOn = s => calculatePayroll(s, '2026-11-01', '2026-11-15').rows[0].undertime.find(u => u.date === DAY);

test('leaving at 4:59 PM on a 9-6 day with no lunch recorded is 61 minutes undertime', () => {
  assert.deepEqual(undertimeOn(state('16:59')), { date: DAY, minutes: 61, amount: 95.95 });
});

test('9 AM - 6 PM with no lunch recorded is a full day: no undertime and no overtime', () => {
  const row = calculatePayroll(state('18:00'), '2026-11-01', '2026-11-15').rows[0];
  assert.equal(row.undertime.length, 0); assert.equal(row.earnings.regularOT, 0);
});

test('a recorded break is used as it is; a day ending before lunch has no lunch taken out', () => {
  assert.equal(undertimeOn(state('18:00', [{ start: `${DAY}T12:30`, end: `${DAY}T13:00` }])), undefined, 'only the recorded 30 minutes are out');
  assert.equal(withScheduledLunch({ date: DAY, timeIn: '09:00', timeOut: '11:30', breaks: [] }, { mealBreakMinutes: 60 }, { mealBreakMinutes: 60 }).breaks.length, 0);
  assert.deepEqual(withScheduledLunch({ date: DAY, timeIn: '09:00', timeOut: '12:30', breaks: [] }, { mealBreakMinutes: 60 }, { mealBreakMinutes: 60 }).breaks, [{ start: `${DAY}T12:00`, end: `${DAY}T12:30` }], 'cut at the time out');
  assert.equal(withScheduledLunch({ date: DAY, timeIn: '09:00', timeOut: '18:00', breaks: [] }, { mealBreakMinutes: 60, flexible: true }, { mealBreakMinutes: 60 }).breaks.length, 0, 'flexible days (Saturday 4 hours) are not changed');
});

test('lunch is not taken out on a rest day, or when no meal break is set on the employee schedule', () => {
  const rec = { date: DAY, timeIn: '09:00', timeOut: '18:00', breaks: [] };
  assert.equal(withScheduledLunch(rec, { mealBreakMinutes: 60 }, { mealBreakMinutes: 60 }, true).breaks.length, 0, 'rest day');
  assert.equal(withScheduledLunch(rec, { mealBreakMinutes: 60 }, {}).breaks.length, 0, 'not set on the profile');
  assert.equal(withScheduledLunch(rec, { mealBreakMinutes: 0 }, { mealBreakMinutes: 0 }).breaks.length, 0, '12-hour drivers: no meal break');
});

test('records the system builds at exactly the regular hours (WFH present, open time in) keep their full hours', () => {
  const rec = { date: DAY, timeIn: '09:00', timeOut: '17:00', breaks: [], regularHoursOnly: true };
  assert.equal(withScheduledLunch(rec, { mealBreakMinutes: 60 }, { mealBreakMinutes: 60 }), rec);
});

test('9 AM - 5 PM after lunch = 7 hours worked, 1 hour undertime; an approved offset covers it', () => {
  const s = state('17:00'); s.attendance[0].timeIn = '09:00';
  assert.equal(undertimeOn(s).minutes, 60);
  const covered = state('17:00'); covered.attendance[0].timeIn = '09:00'; covered.attendance[0].offsetMinutes = 60;
  assert.equal(undertimeOn(covered), undefined, 'approved 60-minute offset');
  const part = state('17:00'); part.attendance[0].timeIn = '09:00'; part.attendance[0].offsetMinutes = 20;
  assert.equal(undertimeOn(part).minutes, 40, 'a 20-minute offset leaves 40');
});
