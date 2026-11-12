import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, dates, isRest } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';

// October 2026: 31 days; with Sunday as the only rest day there are 27 scheduled workdays (Mon-Sat).
const OCTOBER = dates('2026-10-01', '2026-10-31');
function state({ basis = 'monthly', dailyRate = null, saturdayHours = null, monthly = 26000 } = {}) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, dailyDivisor: 26 }];
  s.employees = [{ id: 'E1', name: 'Basis, Test', department: 'Admin', monthlySalary: monthly, startDate: '2025-01-01', endDate: '', restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
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

test('monthly-paid (Nov 2026 rule): basic = monthly ÷ 26 × days credited; a 31-day month also uses ÷ 26 (₱27,000: one absence takes off ₱1,038.46)', () => {
  const full = month(state({ monthly: 27000 }));
  assert.deepEqual(full.map(r => r.workingDays), [13, 14], 'Oct 1-15 has 13 workdays, Oct 16-31 has 14');
  assert.deepEqual(full.map(r => r.earnings.basic), [13500, 13500], 'complete attendance: the full half-month in each cutoff');
  assert.deepEqual(full.map(r => r.adjustmentDivisor), [26, 26], 'October has 31 days but still uses 26');
  const s = state({ monthly: 27000 }); s.attendance = s.attendance.filter(a => a.date !== '2026-10-20');   // one unpaid absence in the 14-day cutoff
  const [a, b] = month(s);
  assert.equal(a.earnings.basic, 13500);
  assert.equal(b.creditedDays, 12, '13 days less the absent day');
  assert.equal(b.earnings.basic, 12461.54, '27,000 ÷ 26 × 12');
  assert.equal(b.deductions.absence, 0, 'the absence lowers basic pay; it is not also a deduction line');
  assert.ok(b.trace.some(t => t.component === 'basic' && /Absence \(days credited reduced\)/.test(t.formula)), 'shown in the basic-pay computation');
});

test('monthly-paid: late time over the threshold lowers basic at monthly ÷ 26, also in a 31-day month', () => {
  const s = state({ monthly: 27000 }); Object.assign(s.attendance.find(a => a.date === '2026-10-20'), { timeIn: '09:30' });   // 30 min late, no offset
  const [, b] = month(s);
  assert.equal(b.creditedDays, 12.94, '13 − 30/480 = 12.9375 → 12.94 (2 decimals)');
  assert.equal(b.earnings.basic, 13437.69, '27,000 ÷ 26 × 12.94');
});

test('monthly-paid: basic always equals the shown days credited (2 decimals) × monthly ÷ 26', () => {
  const s = state({ monthly: 21190 });   // 815.00 a day, as on the November 2026 payroll
  for (const [d, t] of [['2026-10-19', '09:17'], ['2026-10-21', '09:23'], ['2026-10-27', '09:40']]) Object.assign(s.attendance.find(a => a.date === d), { timeIn: t });
  s.attendance = s.attendance.filter(a => a.date !== '2026-10-30');
  const [, b] = month(s);
  assert.equal(Math.round(b.creditedDays * 100) / 100, b.creditedDays, 'days credited have at most 2 decimals');
  assert.equal(b.earnings.basic, Math.round(b.creditedDays * 815 * 100) / 100, 'basic = days credited × 815 exactly');
  assert.equal(b.applicableBasic, b.earnings.basic, 'the 13th-month basic follows the same figure');
});

test('monthly-paid: months that are not 31 days long use 26 for attendance adjustments', () => {
  const s = state({ monthly: 26000 }), sept = dates('2026-09-01', '2026-09-30').filter(d => !isRest(s.employees[0], d));
  s.attendance = sept.filter(d => d !== '2026-09-21').map(d => ({ id: d, employeeId: 'E1', date: d, status: 'present', scheduledIn: '09:00', timeIn: '09:00', timeOut: '18:00', endNextDay: false, breaks: [{ start: `${d}T12:00`, end: `${d}T13:00` }], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }));
  const row = calculatePayroll(s, '2026-09-16', '2026-09-30').rows[0];
  assert.equal(row.adjustmentDivisor, 26);
  assert.equal(row.earnings.basic, 12000, '13,000 - 26,000 / 26');
});

test('daily-paid: the 27 / 26 divisor does not apply', () => {
  const s = state({ basis: 'daily', dailyRate: 755 }); s.attendance = s.attendance.filter(a => a.date !== '2026-10-20');
  const [, b] = month(s);
  assert.equal(b.adjustmentDivisor, null);
  assert.equal(b.earnings.basic, 13 * 755);
});

test('guide example: two approved paid-leave days are worth monthly / 26 each and stay inside the ₱13,000 half-month (31-day month)', () => {
  const s = state(); s.employees[0].leaveEligibility = ['sil'];
  s.leaves = ['2026-10-20', '2026-10-21'].map(d => ({ id: `lv-${d}`, employeeId: 'E1', typeId: 'sil', startDate: d, endDate: d, days: 1, startTime: '', endTime: '', reason: 'Rest', status: 'approved', eligibilityVerified: true }));
  s.attendance = s.attendance.filter(a => !['2026-10-20', '2026-10-21'].includes(a.date));
  const [, b] = month(s);
  assert.equal(b.earnings.leavePay, 2000, '2 days × 26,000 / 26');
  assert.equal(b.earnings.basic + b.earnings.leavePay, 13000, 'not counted twice: the half-month stays 13,000');
  assert.equal(b.paidLeaveDays, 2);
  assert.equal(b.creditedDays + b.paidLeaveDays, 13, 'days present: 11 worked + 2 paid leave');
});

test('monthly-paid hired mid-cutoff: days credited follow the share of the half-month worked (8 of 14 workdays)', () => {
  const s = state(); s.employees[0].startDate = '2026-10-23';   // Oct 23-24 and 26-31: 8 of the cutoff's 14 workdays
  const [, b] = month(s);
  assert.equal(b.creditedDays, 7.43, '13 days × 8 / 14 = 7.4286 → 7.43 (2 decimals)');
  assert.equal(b.earnings.basic, 7430, '7.43 days × 26,000 / 26');
});
