import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, monthWorkdays } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';

// November 2026: 30 days, 5 Sundays (1, 8, 15, 22, 29) and 4 Saturdays (7, 14, 21, 28). Holidays on Nov 1 and 2.
function state(restDays) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, dailyDivisor: 26 }];
  s.employees = [{ id: 'E1', name: 'Days, Test', department: 'Admin', monthlySalary: 26000, startDate: '2025-01-01', endDate: '', restDays, scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
  s.holidays = [{ date: '2026-11-01', kind: 'special', name: "All Saints' Day" }, { date: '2026-11-02', kind: 'special', name: "All Souls' Day" }];
  return s;
}
const row = (s, a, b) => calculatePayroll(s, a, b).rows[0];

test('scheduled working days per month come from the calendar and the rest day (holidays included)', () => {
  assert.equal(monthWorkdays({ restDays: [0] }, '2026-11'), 25, 'Mon-Sat, Sunday rest');
  assert.equal(monthWorkdays({ restDays: [6] }, '2026-11'), 26, 'Saturday rest');
  assert.equal(monthWorkdays({ restDays: [0] }, '2026-10'), 27, 'October 2026: 4 Sundays');
});

test('the month is split between the two cutoffs and shown beside each cutoff count; the divisor stays separate', () => {
  for (const [rest, first, second, month] of [[[0], 12, 13, 25], [[6], 13, 13, 26]]) {
    const s = state(rest), a = row(s, '2026-11-01', '2026-11-15'), b = row(s, '2026-11-16', '2026-11-30');
    assert.deepEqual([a.workingDays, b.workingDays, a.monthWorkingDays, b.monthWorkingDays], [first, second, month, month], `rest ${rest}`);
    assert.equal(a.workingDays + b.workingDays, month);
    assert.equal(a.adjustmentDivisor, 26, 'attendance adjustments still use the rules divisor');
  }
});

test('Nov 2 (a holiday on a workday) is a scheduled working day and a credited Holiday Day', () => {
  const r = row(state([0]), '2026-11-01', '2026-11-15');
  assert.equal(r.workingDays, 12); assert.equal(r.holidayDays, 1);
});
