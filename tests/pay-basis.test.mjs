import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, dates, isRest } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';

// October 2026: 31 days; with Sunday as the only rest day there are 27 scheduled workdays (Mon-Sat).
const OCTOBER = dates('2026-10-01', '2026-10-31');
function state({ basis = 'monthly', dailyRate = null, saturdayHours = null } = {}) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, dailyDivisor: 26 }];
  s.employees = [{ id: 'E1', name: 'Basis, Test', department: 'Admin', monthlySalary: 26000, startDate: '2025-01-01', endDate: '', restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
  s.employeeProfiles = [
    { employeeId: 'E1', section: 'attendance', hoursPerDay: 8, mealBreakMinutes: 60, scheduleEnd: '18:00', daySchedules: saturdayHours ? [{ day: 6, scheduleStart: '', scheduleEnd: '', hoursPerDay: saturdayHours, mealBreakMinutes: 0, arrangement: 'Office', flexible: true }] : [] },
    ...(basis === 'daily' ? [{ employeeId: 'E1', section: 'payroll', basis: 'daily', dailyRate }] : []),
  ];
  // Present every scheduled workday: 09:00-18:00 with lunch on weekdays; 09:00-13:00 on 4-hour Saturdays.
  s.attendance = OCTOBER.filter(d => !isRest(s.employees[0], d)).map(d => {
    const saturday = new Date(`${d}T00:00:00Z`).getUTCDay() === 6 && saturdayHours;
    return { id: d, employeeId: 'E1', date: d, status: 'present', scheduledIn: '09:00', timeIn: '09:00', timeOut: saturday ? '13:00' : '18:00', endNextDay: false, breaks: saturday ? [] : [{ start: `${d}T12:00`, end: `${d}T13:00` }], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true };
  });
  return s;
}
const month = s => ['2026-10-01', '2026-10-16'].map(start => calculatePayroll(s, start, start === '2026-10-01' ? '2026-10-15' : '2026-10-31').rows[0]);

test('October 2026 has 27 scheduled workdays from the schedule and rest days', () => {
  const [a, b] = month(state());
  assert.equal(a.workingDays + b.workingDays, 27);
});

test('monthly-paid: a 27-workday month pays exactly the agreed monthly salary (fixed 26-day divisor)', () => {
  const [a, b] = month(state());
  assert.equal(a.dailyRate, 1000, '26,000 / 26');
  assert.equal(Math.round((a.earnings.basic + b.earnings.basic) * 100) / 100, 26000, 'not 27 x 1,000');
  assert.equal(a.payBasis, 'monthly');
});

test('daily-paid (Ma. Rita, Debralyn): 27 payable days are paid as 27 days, not capped at 26; 4-hour Saturdays are full days', () => {
  const [a, b] = month(state({ basis: 'daily', dailyRate: 755, saturdayHours: 4 }));
  assert.equal(a.payBasis, 'daily');
  assert.equal(Math.round((a.earnings.basic + b.earnings.basic) * 100) / 100, 27 * 755);
  assert.equal(a.creditedDays + b.creditedDays, 27, 'every day credited in full, Saturdays included');
  assert.equal((a.undertimeMinutes || 0) + (b.undertimeMinutes || 0), 0, 'the 4 required Saturday hours leave no undertime');
});

test('daily-paid: a day not attended is not paid', () => {
  const s = state({ basis: 'daily', dailyRate: 755, saturdayHours: 4 });
  s.attendance = s.attendance.filter(a => a.date !== '2026-10-20');
  const [a, b] = month(s);
  assert.equal(Math.round((a.earnings.basic + b.earnings.basic) * 100) / 100, 26 * 755);
});
