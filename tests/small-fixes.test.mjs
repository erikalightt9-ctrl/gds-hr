import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';
import { profileSchemas } from '../src/profiles.mjs';

// Nov 2-14 2026 (Mon-Sat, Sunday rest); 9-6 weekdays, Saturday flexible 4 hours.
function state({ basis = 'daily', priceHours, rules = {}, record = {} } = {}) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, dailyDivisor: 26, overtimeApproval: 'separate', ...rules }];
  s.employees = [{ id: 'E1', name: 'Fix, Test', department: 'Admin', monthlySalary: 26000, startDate: '2025-01-01', endDate: '', restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
  s.employeeProfiles = [
    ...(basis === 'daily' ? [{ employeeId: 'E1', section: 'payroll', basis: 'daily', dailyRate: 755 }] : []),
    { employeeId: 'E1', section: 'attendance', scheduleEnd: '18:00', hoursPerDay: 8, mealBreakMinutes: 60, paidFrom: 'schedule', daySchedules: [{ day: 6, scheduleStart: '', scheduleEnd: '', hoursPerDay: 4, mealBreakMinutes: 0, arrangement: 'Office', flexible: true, ...(priceHours ? { priceHours } : {}) }] },
  ];
  s.attendance = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'].map(d => ({ id: d, employeeId: 'E1', date: d, status: 'present', scheduledIn: '09:00', timeIn: '09:00', timeOut: new Date(`${d}T00:00:00Z`).getUTCDay() === 6 ? '13:00' : '18:00', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }));
  Object.assign(s.attendance.find(a => a.date === (record.date || '2026-11-14')), record);
  return s;
}
const run = s => calculatePayroll(s, '2026-11-01', '2026-11-15').rows[0];

test('a weekday can price missing time with its own hours (Saturday 4-hour day: 1 hour = 1/4 day)', () => {
  const short = { timeOut: '12:00' };   // Saturday 9-12: 3 of 4 hours
  assert.equal(run(state({ record: short })).undertime[0].amount, 94.38, 'default: daily rate ÷ 8');
  assert.equal(run(state({ record: short, priceHours: 4 })).undertime[0].amount, 188.75, 'set: daily rate ÷ 4');
  assert.equal(profileSchemas.attendance.parse({ daySchedules: [{ day: 6, priceHours: 4 }] }).daySchedules[0].priceHours, 4);
  assert.equal('priceHours' in profileSchemas.attendance.parse({ daySchedules: [{ day: 6 }] }).daySchedules[0], false, 'blank stays blank');
});

test('minutes an offset covers are never also paid as overtime', () => {
  // 30 min late, stays 30 min after 6 PM, offset 30 approved AND an overtime filing for 6:00-6:30 PM.
  const s = state({ record: { date: '2026-11-10', timeIn: '09:30', timeOut: '18:30', offsetMinutes: 30 } });
  s.overtimeRequests = [{ id: 'ot1', employeeId: 'E1', date: '2026-11-10', startTime: '18:00', endTime: '18:30', hours: 0.5, approvedHours: 0.5, status: 'approved' }];
  const row = run(s);
  assert.equal(row.earnings.regularOT, 0, 'the 30 minutes after 6 PM make up the late time');
  assert.equal(row.late.find(l => l.date === '2026-11-10').deductibleMinutes, 0, 'late fully offset');
});

test('rounding of days credited is a rules setting: 2 decimals (default) or exact', () => {
  const late = { date: '2026-11-10', timeIn: '09:30' };   // 30 min late = 0.0625 day
  const days = run(state({ basis: 'monthly', record: late }));
  assert.deepEqual([days.creditedDays, days.earnings.basic], [12.94, 12940], '12.9375 → 12.94 × 1,000');
  const exact = run(state({ basis: 'monthly', record: late, rules: { creditRounding: 'exact' } }));
  assert.deepEqual([exact.creditedDays, exact.earnings.basic], [12.9375, 12937.5], 'exact: 13,000 − 62.50');
});
