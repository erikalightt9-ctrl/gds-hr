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

test('monthly-paid: the daily rate is the salary ÷ the month’s scheduled working days; a full month pays exactly the salary', () => {
  const [a, b] = month(state());
  assert.equal(a.dailyRate, 962.96, '26,000 / 27 working days in October');
  assert.deepEqual([a.earnings.basic, b.earnings.basic], [12518.52, 13481.48], '13 and 14 working days, not a fixed 13 each');
  assert.equal(Math.round((a.earnings.basic + b.earnings.basic) * 100) / 100, 26000, 'the monthly salary stays fixed');
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

test('monthly-paid (Nov 20, 2026 rule): basic = monthly ÷ the month’s working days × days credited (₱27,000 ÷ 27: one absence takes off ₱1,000)', () => {
  const full = month(state({ monthly: 27000 }));
  assert.deepEqual(full.map(r => r.workingDays), [13, 14], 'Oct 1-15 has 13 workdays, Oct 16-31 has 14');
  assert.deepEqual(full.map(r => r.earnings.basic), [13000, 14000], 'complete attendance: each cutoff pays its own working days');
  assert.deepEqual(full.map(r => r.adjustmentDivisor), [27, 27], 'October: 27 working days with Sunday rest');
  const s = state({ monthly: 27000 }); s.attendance = s.attendance.filter(a => a.date !== '2026-10-20');   // one unpaid absence in the 14-day cutoff
  const [a, b] = month(s);
  assert.equal(a.earnings.basic, 13000);
  assert.equal(b.creditedDays, 13, '14 days less the absent day');
  assert.equal(b.earnings.basic, 13000, '27,000 ÷ 27 × 13');
  assert.equal(b.deductions.absence, 0, 'the absence lowers basic pay; it is not also a deduction line');
  assert.ok(b.trace.some(t => t.component === 'basic' && /Absence \(days credited reduced\)/.test(t.formula)), 'shown in the basic-pay computation');
});

test('monthly-paid: late time over the threshold lowers basic at the month’s daily rate', () => {
  const s = state({ monthly: 27000 }); Object.assign(s.attendance.find(a => a.date === '2026-10-20'), { timeIn: '09:30' });   // 30 min late, no offset
  const [, b] = month(s);
  assert.equal(b.creditedDays, 13.94, '14 − 30/480 = 13.9375 → 13.94 (2 decimals)');
  assert.equal(b.earnings.basic, 13940, '27,000 ÷ 27 × 13.94');
});

test('monthly-paid: basic always equals the shown days credited (2 decimals) × the daily rate', () => {
  const s = state({ monthly: 21600 });   // 800.00 a day in a 27-workday October
  for (const [d, t] of [['2026-10-19', '09:17'], ['2026-10-21', '09:23'], ['2026-10-27', '09:40']]) Object.assign(s.attendance.find(a => a.date === d), { timeIn: t });
  s.attendance = s.attendance.filter(a => a.date !== '2026-10-30');
  const [, b] = month(s);
  assert.equal(Math.round(b.creditedDays * 100) / 100, b.creditedDays, 'days credited have at most 2 decimals');
  assert.equal(b.earnings.basic, Math.round(b.creditedDays * 800 * 100) / 100, 'basic = days credited × 800 exactly');
  assert.equal(b.applicableBasic, b.earnings.basic, 'the 13th-month basic follows the same figure');
});

test('monthly-paid: September 2026 (26 working days with Sunday rest) prices attendance adjustments at ÷ 26', () => {
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

test('two approved paid-leave days are worth one daily rate each and stay inside the cutoff’s basic (not counted twice)', () => {
  const s = state(); s.employees[0].leaveEligibility = ['sil'];
  s.leaves = ['2026-10-20', '2026-10-21'].map(d => ({ id: `lv-${d}`, employeeId: 'E1', typeId: 'sil', startDate: d, endDate: d, days: 1, startTime: '', endTime: '', reason: 'Rest', status: 'approved', eligibilityVerified: true }));
  s.attendance = s.attendance.filter(a => !['2026-10-20', '2026-10-21'].includes(a.date));
  const [, b] = month(s);
  assert.equal(b.earnings.leavePay, 1925.92, '2 days × 26,000 / 27 (962.96)');
  assert.equal(Math.round((b.earnings.basic + b.earnings.leavePay) * 100) / 100, 13481.48, 'not counted twice: the cutoff stays 14 days × 962.96');
  assert.equal(b.paidLeaveDays, 2);
  assert.equal(b.creditedDays + b.paidLeaveDays, 14, 'days present: 12 worked + 2 paid leave');
});

test('monthly-paid hired mid-cutoff: only the working days employed are credited (8 of the cutoff’s 14)', () => {
  const s = state(); s.employees[0].startDate = '2026-10-23';   // Oct 23-24 and 26-31: 8 of the cutoff's 14 workdays
  const [, b] = month(s);
  assert.equal(b.creditedDays, 8, '8 working days employed');
  assert.equal(b.earnings.basic, 7703.7, '8 days × 26,000 / 27');
});

test('days present leave out rest-day work (paid in its own column): salary ÷ working days × days present = basic pay', () => {
  const s = state({ monthly: 27000 });
  s.attendance.push({ id: 'sun', employeeId: 'E1', date: '2026-10-25', status: 'present', scheduledIn: '09:00', timeIn: '09:00', timeOut: '18:00', endNextDay: false, breaks: [{ start: '2026-10-25T12:00', end: '2026-10-25T13:00' }], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true });
  const [, b] = month(s);
  assert.equal(b.regularDays, 14, 'the 14 scheduled workdays, not the Sunday worked');
  assert.ok(b.earnings.restDay > 0, 'the Sunday is paid as rest-day pay');
  assert.equal(b.earnings.basic, Math.round(27000 / 27 * b.regularDays * 100) / 100);
});
