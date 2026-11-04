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
  assert.equal(row.creditedDays, 12.9375);
  assert.equal(row.earnings.basic, 13000 - 62.5);
  assert.equal(row.deductions.late, undefined);
  assert.equal(row.undertimeAmount, 0, 'late minutes are not counted again as undertime');
  assert.match(row.trace.find(t => t.component === 'basic' && t.amount < 0).formula, /30 min not offset/);
});

test('an approved offset covers late time fully or partly', () => {
  assert.equal(run(lateOn(state(), '2026-09-21', '09:30', { offsetMinutes: 30 })).earnings.basic, 13000);
  const partly = run(lateOn(state(), '2026-09-21', '09:30', { offsetMinutes: 20 }));     // 10 min left
  assert.equal(partly.creditedDays, round4(13 - 10 / 480));
  assert.equal(partly.earnings.basic, 13000 - 20.83);
  assert.equal(run(lateOn(state(), '2026-09-21', '09:30', { exception: true })).earnings.basic, 13000, 'approved exception');
});

test('daily-paid pay follows credited days; a 12-hour day loses less per minute', () => {
  const daily = run(lateOn(state({ basis: 'daily' }), '2026-09-21', '10:00'));          // 60 of 480 = 0.125 day
  assert.equal(daily.earnings.basic, 13 * 1000 - 125);
  assert.equal(daily.creditedDays, 12.875);
  const long = run(lateOn(state({ hoursPerDay: 12 }), '2026-09-21', '10:00'));           // 60 of 720 min
  assert.equal(long.creditedDays, round4(13 - 60 / 720));
});

test('lateness is counted once: tax basis and 13th-month basic use the reduced pay without a second deduction', () => {
  const on = run(lateOn(state(), '2026-09-21', '09:30')), off = run(state());
  assert.equal(round2(off.gross - on.gross), 62.5);
  assert.equal(round2(off.applicableBasic - on.applicableBasic), 62.5);
  assert.equal(round2(off.net - on.net), 62.5, 'no tax brackets configured, so net falls by exactly the late reduction');
});

function round4(v) { return Math.round(v * 10000) / 10000; }
function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

test('undertime lowers credited time and basic pay like lateness, never as a separate deduction; each minute once', () => {
  // 30 min late (09:30) and leaving 30 min early (17:30) on one day: 60 of 480 minutes lost = 0.125 day.
  const row = run(lateOn(state(), '2026-09-21', '09:30', { timeOut: '17:30' }));
  assert.equal(row.deductions.undertime, 0, 'no undertime deduction line');
  assert.equal(row.deductions.late, undefined, 'no late deduction line');
  assert.equal(row.undertimeMinutes, 30); assert.equal(row.undertimeAmount, 62.5, 'kept for verification');
  assert.equal(row.earnings.basic, 13000 - 62.5 - 62.5, 'basic lowered once for the late half hour and once for the early half hour');
  assert.equal(row.creditedDays, 12.875); assert.equal(row.creditedHours, 103, '13 days x 8 h less 1 h');
  assert.equal(row.totalDeductions, Math.round(Object.values(row.deductions).reduce((s, n) => s + n, 0) * 100) / 100);
  assert.ok(row.trace.some(t => t.component === 'basic' && /Undertime 30 min not covered.*credited time reduced/.test(t.formula)), 'detail kept in the computation');
  assert.deepEqual(row.undertime, [{ date: '2026-09-21', minutes: 30, amount: 62.5 }]);
});

test('the example: 8 required hours, 30 min late without offset = 7.5 hours = 0.9375 day credited', () => {
  const row = run(lateOn(state(), '2026-09-21', '09:30'));
  assert.equal(row.creditedHours, 13 * 8 - 0.5);
  assert.equal(Math.round((row.creditedDays - 12) * 10000) / 10000, 0.9375, 'the late day counts 0.9375 (shown as 0.94)');
});

test('an undertime override (e.g. waived to 0) keeps credited time in step with pay', () => {
  const s = lateOn(state(), '2026-09-21', '09:00', { timeOut: '17:00' });   // 60 min undertime
  s.payrollInputs = [{ employeeId: 'E1', start: '2026-09-16', end: '2026-09-30', mode: 'add', hours: {}, reason: 'Waived', updatedBy: 'hr1', overrides: [{ component: 'undertime', amount: 0, reason: 'Approved' }] }];
  const row = run(s);
  assert.equal(row.undertimeMinutes, 60, 'the minutes stay on record');
  assert.equal(row.earnings.basic, 13000, 'nothing charged');
  assert.equal(row.creditedHours, 104); assert.equal(row.creditedDays, 13);
});

test('the example: 30 minutes late = 7.5 credited hours (0.9375 day); a full approved 30-minute offset restores 8 hours', () => {
  const none = run(lateOn(state(), '2026-09-21', '09:30', { timeOut: '18:00' }));
  assert.equal(none.creditedHours, 13 * 8 - 0.5); assert.equal(none.earnings.basic, 13000 - 62.5);
  const offset = run(lateOn(state(), '2026-09-21', '09:30', { timeOut: '18:00', offsetMinutes: 30, explanation: 'Approved offset' }));
  assert.equal(offset.creditedHours, 13 * 8); assert.equal(offset.creditedDays, 13); assert.equal(offset.earnings.basic, 13000);
  const late = offset.late.find(l => l.lateMinutes);
  assert.deepEqual([late.lateMinutes, late.approvedOffset, late.deductibleMinutes], [30, 30, 0], 'late, offset and remaining minutes visible to HR');
});
