import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, dates, isRest } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';

// Monthly 26,000 at divisor 26 -> daily 1,000. 8-hour day with lunch; schedule 09:00. Sept 16-30, Sunday rest: 13 workdays.
function state({ hoursPerDay = 8, basis = 'monthly' } = {}) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, dailyDivisor: 26 }];
  s.employees = [{ id: 'E1', name: 'Late, Test', department: 'Admin', monthlySalary: 26000, startDate: '2025-01-01', endDate: '', restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
  s.employeeProfiles = [{ employeeId: 'E1', section: 'attendance', hoursPerDay, mealBreakMinutes: hoursPerDay === 8 ? 60 : 0 }, ...(basis === 'daily' ? [{ employeeId: 'E1', section: 'payroll', basis: 'daily', dailyRate: 1000 }] : [])];
  const end = hoursPerDay === 8 ? '18:00' : '21:00';
  s.attendance = dates('2026-09-16', '2026-09-30').filter(d => !isRest(s.employees[0], d)).map(d => ({ id: d, employeeId: 'E1', date: d, status: 'present', scheduledIn: '09:00', timeIn: '09:00', timeOut: end, endNextDay: false, breaks: hoursPerDay === 8 ? [{ start: `${d}T12:00`, end: `${d}T13:00` }] : [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }));
  return s;
}
const lateOn = (s, date, timeIn, extra = {}) => { const a = s.attendance.find(x => x.date === date); Object.assign(a, { timeIn, ...extra }); return s; };
const run = s => calculatePayroll(s, '2026-09-16', '2026-09-30').rows[0];

test('unoffset late time reduces credited days in proportion to the time lost', () => {
  const row = run(lateOn(state(), '2026-09-21', '09:30'));    // 30 of 480 minutes = 0.0625 day
  assert.equal(row.daysPresent, 13);
  assert.equal(row.creditedDays, 12.94, '12.9375 shown with 2 decimals (Nov 2026 rule)');
  assert.equal(row.earnings.basic, 12940, '12.94 days × 1,000');
  assert.equal(row.deductions.late, undefined);
  assert.equal(row.undertimeAmount, 0, 'late minutes are not counted again as undertime');
  assert.match(row.trace.find(t => t.component === 'basic' && t.amount < 0).formula, /Late 30 min ÷/);
});

test('an approved offset does not reduce a late at or above the grace period; an exception still does', () => {
  const none = run(lateOn(state(), '2026-09-21', '09:30'));
  const full = run(lateOn(state(), '2026-09-21', '09:30', { offsetMinutes: 30, explanation: 'Approved offset' }));
  assert.equal(full.earnings.basic, none.earnings.basic, '30 min late + 30 min offset still loses the 30');
  assert.equal(full.late.find(l => l.lateMinutes).deductibleMinutes, 30);
  assert.match(full.trace.find(t => t.component === 'basic' && t.amount < 0).formula, /approved offset 30 min does not reduce it/);
  const partly = run(lateOn(state(), '2026-09-21', '09:30', { offsetMinutes: 20, explanation: 'Approved offset' }));
  assert.equal(partly.earnings.basic, none.earnings.basic);
  assert.equal(partly.creditedDays, none.creditedDays);
  assert.equal(run(lateOn(state(), '2026-09-21', '09:30', { exception: true, explanation: 'Authorized' })).earnings.basic, 13000, 'approved exception');
});

test('daily-paid pay follows credited days; a 12-hour day loses less per minute', () => {
  const daily = run(lateOn(state({ basis: 'daily' }), '2026-09-21', '10:00'));          // 60 of 480 = 0.125 day
  assert.equal(daily.earnings.basic, 13 * 1000 - 125);
  assert.equal(daily.creditedDays, 12.875);
  const long = run(lateOn(state({ hoursPerDay: 12 }), '2026-09-21', '10:00'));           // 60 of 720 min
  assert.equal(long.creditedDays, round2(13 - 60 / 720), 'monthly-paid days shown with 2 decimals');
});

test('lateness is counted once: tax basis and 13th-month basic use the reduced pay without a second deduction', () => {
  const on = run(lateOn(state(), '2026-09-21', '09:30')), off = run(state());
  assert.equal(round2(off.gross - on.gross), 60, '0.0625 day → 0.06 day (2 decimals) × 1,000');
  assert.equal(round2(off.applicableBasic - on.applicableBasic), 60);
  assert.equal(round2(off.net - on.net), 60, 'no tax brackets configured, so net falls by exactly the late reduction');
});

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

test('undertime lowers credited time and basic pay like lateness, never as a separate deduction; each minute once', () => {
  // 30 min late (09:30) and leaving 30 min early (17:30) on one day: 60 of 480 minutes lost = 0.125 day.
  const row = run(lateOn(state(), '2026-09-21', '09:30', { timeOut: '17:30' }));
  assert.equal(row.deductions.undertime, 0, 'no undertime deduction line');
  assert.equal(row.deductions.late, undefined, 'no late deduction line');
  assert.equal(row.undertimeMinutes, 30); assert.equal(row.undertimeAmount, 62.5, 'kept for verification');
  assert.equal(row.creditedDays, 12.88, '13 - 60/480 = 12.875 → 12.88 (2 decimals)');
  assert.equal(row.earnings.basic, 12880, 'basic lowered once for the late half hour and once for the early half hour: 12.88 days × 1,000'); assert.equal(row.creditedHours, 103, '13 days x 8 h less 1 h');
  assert.equal(row.totalDeductions, Math.round(Object.values(row.deductions).reduce((s, n) => s + n, 0) * 100) / 100);
  assert.ok(row.trace.some(t => t.component === 'basic' && /Undertime 30 min not covered.*credited time reduced/.test(t.formula)), 'detail kept in the computation');
  assert.deepEqual(row.undertime, [{ date: '2026-09-21', minutes: 30, amount: 62.5 }]);
});

test('the example: 8 required hours, 30 min late without offset = 7.5 hours = 0.9375 day credited', () => {
  const row = run(lateOn(state(), '2026-09-21', '09:30'));
  assert.equal(row.creditedHours, 13 * 8 - 0.5);
  assert.equal(Math.round((row.creditedDays - 12) * 100) / 100, 0.94, 'the late day counts 0.9375, credited as 0.94 (2 decimals)');
});

test('an undertime override (e.g. waived to 0) keeps credited time in step with pay', () => {
  const s = lateOn(state(), '2026-09-21', '09:00', { timeOut: '17:00' });   // 60 min undertime
  s.payrollInputs = [{ employeeId: 'E1', start: '2026-09-16', end: '2026-09-30', mode: 'add', hours: {}, reason: 'Waived', updatedBy: 'hr1', overrides: [{ component: 'undertime', amount: 0, reason: 'Approved' }] }];
  const row = run(s);
  assert.equal(row.undertimeMinutes, 60, 'the minutes stay on record');
  assert.equal(row.earnings.basic, 13000, 'nothing charged');
  assert.equal(row.creditedHours, 104); assert.equal(row.creditedDays, 13);
});

test('the example: 30 minutes late = 7.5 credited hours (0.9375 day); a 30-minute approved offset does not restore them', () => {
  const none = run(lateOn(state(), '2026-09-21', '09:30', { timeOut: '18:00' }));
  assert.equal(none.creditedHours, 13 * 8 - 0.5); assert.equal(none.earnings.basic, 12940, '12.94 days × 1,000');
  const offset = run(lateOn(state(), '2026-09-21', '09:30', { timeOut: '18:00', offsetMinutes: 30, explanation: 'Approved offset' }));
  assert.equal(offset.creditedHours, none.creditedHours); assert.equal(offset.creditedDays, none.creditedDays); assert.equal(offset.earnings.basic, none.earnings.basic);
  const late = offset.late.find(l => l.lateMinutes);
  assert.deepEqual([late.lateMinutes, late.approvedOffset, late.deductibleMinutes], [30, 30, 30], 'late, offset and deductible minutes visible to HR');
});

test('a deductible late does not use up the offset, so the offset still covers undertime; a late under 15 still uses it first', () => {
  // 09:20 is 20 min late; 17:00 is 60 min early on a 09:00-18:00 day. A 60-minute offset covers the early leave.
  const charged = run(lateOn(state(), '2026-09-21', '09:20', { timeOut: '17:00', offsetMinutes: 60, explanation: 'Approved offset' }));
  assert.equal(charged.late.find(l => l.date === '2026-09-21').deductibleMinutes, 20);
  assert.equal(charged.undertimeMinutes, 0, 'the offset was not spent on the late, so it covers the 60 min early');
  // 09:10 is under the grace period. The 10-minute offset is still applied to that late before undertime.
  const grace = run(lateOn(state(), '2026-09-21', '09:10', { timeOut: '17:00', offsetMinutes: 10, explanation: 'Approved offset' }));
  assert.equal(grace.late.find(l => l.date === '2026-09-21').deductibleMinutes, 0);
  assert.equal(grace.undertimeMinutes, 60, 'under 15 minutes the offset is still used on the late first');
});

test('a basic-pay override moves the credited days with it (e.g. days present typed from the HR attendance sheet)', () => {
  const s = lateOn(state(), '2026-09-21', '09:00');
  s.payrollInputs = [{ employeeId: 'E1', start: '2026-09-16', end: '2026-09-30', mode: 'add', hours: {}, reason: 'HR sheet', updatedBy: 'hr1', overrides: [{ component: 'basic', amount: 11440, reason: 'Per HR attendance sheet: 11.44 days' }] }];
  const row = run(s);
  assert.equal(row.earnings.basic, 11440);
  assert.equal(row.creditedDays, 11.44, '13 days credited less 1.56 days removed by the override');
  assert.equal(row.creditedHours, 91.52);
});

test('a basic-pay override is final: absences, lateness and undertime are not taken off it again', () => {
  const s = lateOn(state(), '2026-09-21', '09:40', { timeOut: '17:00' });   // late and undertime on one day
  s.attendance = s.attendance.filter(a => a.date !== '2026-09-22');           // and one absent day
  s.payrollInputs = [{ employeeId: 'E1', start: '2026-09-16', end: '2026-09-30', mode: 'add', hours: {}, reason: 'HR sheet', updatedBy: 'hr1', overrides: [{ component: 'basic', amount: 11440, reason: 'Per HR attendance sheet: 11.44 days' }] }];
  const row = run(s);
  assert.equal(row.earnings.basic, 11440, 'exactly the typed basic pay');
  assert.equal(row.applicableBasic, 11440, '13th month basic follows it too');
  assert.equal(row.creditedDays, 11.44);
});
