import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, dates, isRest } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';
import { holidaySplit } from '../src/holiday-pay.mjs';

// Nov 1-15 2026, Sunday rest: Nov 1 (Sunday, All Saints' Day) is a rest day; Nov 2 (Monday, All Souls' Day) a workday.
// 12 scheduled workdays: Nov 2-7 and 9-14.
function state({ basis = 'daily', worked = [] } = {}) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, dailyDivisor: 26 }];
  s.employees = [{ id: 'E1', name: 'Holiday, Test', department: 'Admin', monthlySalary: 19630, startDate: '2025-01-01', endDate: '', restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
  s.employeeProfiles = basis === 'daily' ? [{ employeeId: 'E1', section: 'payroll', basis: 'daily', dailyRate: 755 }] : [];
  s.holidays = [{ date: '2026-11-01', kind: 'special', name: "All Saints' Day" }, { date: '2026-11-02', kind: 'special', name: "All Souls' Day" }];
  const holidays = new Set(s.holidays.map(h => h.date));
  s.attendance = dates('2026-11-01', '2026-11-15').filter(d => !isRest(s.employees[0], d) && (!holidays.has(d) || worked.includes(d))).map(d => ({ id: d, employeeId: 'E1', date: d, status: 'present', scheduledIn: '09:00', timeIn: '09:00', timeOut: '18:00', endNextDay: false, breaks: [{ start: `${d}T12:00`, end: `${d}T13:00` }], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }));
  return s;
}
const run = s => calculatePayroll(s, '2026-11-01', '2026-11-15').rows[0];
const round2 = v => Math.round(v * 100) / 100;

test('Nov 1-15, Sunday rest: Nov 1 (Sunday) counts 0, Nov 2 counts 1 holiday day; days present = regular workdays attended', () => {
  for (const basis of ['daily', 'monthly']) {
    const row = run(state({ basis }));
    assert.equal(row.holidayDays, 1, basis);
    assert.equal(row.regularDays, 11, `${basis}: 11 regular workdays attended`);
    assert.deepEqual(row.holidays.map(h => [h.date, h.worked]), [['2026-11-02', false]], 'Nov 1 is a Sunday rest day');
  }
});

test('holiday pay is one day, paid once: regular basic + holiday pay = the cutoff basic', () => {
  const daily = holidaySplit(run(state()));
  assert.deepEqual([daily.holidayPay, daily.regularBasic], [755, 11 * 755], 'daily-paid: 11 days worked + Nov 2');
  const row = run(state({ basis: 'monthly' })), monthly = holidaySplit(row);
  assert.equal(monthly.holidayPay, 755, 'monthly-paid: 19,630 ÷ 26');
  assert.equal(round2(monthly.regularBasic + monthly.holidayPay), row.earnings.basic, 'reconciled with the fixed half-month');
  assert.equal(row.earnings.basic, 9815, 'the half-month itself is unchanged');
});

test('a holiday falling on Sunday moves only when a substitute date is configured', () => {
  const s = state(); s.holidays.push({ date: '2026-11-03', kind: 'special', name: "All Saints' Day (substitute)" });
  s.attendance = s.attendance.filter(a => a.date !== '2026-11-03');
  const row = run(s);
  assert.equal(row.holidayDays, 2, 'Nov 2 + the configured substitute Nov 3'); assert.equal(row.regularDays, 10);
});

test('a worked holiday keeps its attendance and gets the holiday-work rate, shown under holiday pay', () => {
  const row = run(state({ worked: ['2026-11-02'] })), split = holidaySplit(row);
  assert.equal(row.holidayDays, 1); assert.equal(row.regularDays, 11, 'the holiday worked is not a regular day');
  assert.ok(row.earnings.specialHoliday > 0, 'special-holiday work premium applied');
  assert.equal(split.holidayPay, round2(755 + row.earnings.specialHoliday), 'one day + the premium');
  assert.equal(round2(split.regularBasic + split.holidayPay + split.overtime), row.gross, 'nothing counted twice');
});

test('holidays before the start date are not listed; a holiday recorded absent at 0% earns no holiday pay', () => {
  const late = state(); late.employees[0].startDate = '2026-11-05';
  assert.deepEqual(run(late).holidays, []);
  const absent = state(); absent.attendance.push({ id: 'h', employeeId: 'E1', date: '2026-11-02', status: 'absent', scheduledIn: '09:00', timeIn: '', timeOut: '', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true });
  const row = run(absent);
  assert.equal(row.holidayPay, 0); assert.equal(row.holidayDays, 0);
});

test('a manual "replace" entry has no separate holiday pay (HR typed the days)', () => {
  const s = state(); s.payrollInputs = [{ employeeId: 'E1', start: '2026-11-01', end: '2026-11-15', mode: 'replace', daysWorked: 10, absenceDays: 0, lateMinutes: 0, undertimeMinutes: 0, hours: {}, reason: 'Sheet', updatedBy: 'hr1', overrides: [] }];
  const row = run(s);
  assert.equal(row.holidayPay, 0); assert.equal(row.holidayDays, 0);
});

test('older posted rows without the new fields still split safely', () => {
  const split = holidaySplit({ earnings: { basic: 10000, regularOT: 100, specialHoliday: 50 }, creditedDays: 10 });
  assert.deepEqual([split.holidayPay, split.holidayDays, split.regularBasic, split.regularDays, split.overtime], [50, 0, 10000, 10, 100]);
});

// Live payroll: nothing is assumed for days that have not arrived yet (state.asOf = today, Manila).
test('a work-from-home "present without time in" day is credited only once the date has arrived', () => {
  const s = state(); s.attendance = s.attendance.filter(a => !['2026-11-07', '2026-11-14'].includes(a.date));
  s.employeeProfiles.push({ employeeId: 'E1', section: 'attendance', daySchedules: [{ day: 6, scheduleStart: '', scheduleEnd: '', hoursPerDay: null, mealBreakMinutes: null, arrangement: 'WFH', flexible: false, autoPresent: true }] });
  const atEnd = run({ ...s, asOf: '2026-11-15' }), midway = run({ ...s, asOf: '2026-11-12' });
  assert.equal(atEnd.daysPresent - midway.daysPresent, 1, 'Saturday Nov 14 is not counted on Nov 12');
  assert.ok(midway.trace.some(t => t.date === '2026-11-14' && /not yet reached/.test(t.formula)), 'shown as not yet reached');
  assert.ok(!midway.trace.some(t => t.date === '2026-11-07' && /Absence/.test(t.formula)), 'the past Saturday Nov 7 is still present');
});

test('a holiday that has not arrived yet is not paid in advance', () => {
  const s = state(); s.holidays.push({ date: '2026-11-13', kind: 'special', name: 'Future holiday' });
  s.attendance = s.attendance.filter(a => a.date !== '2026-11-13');
  const before = run({ ...s, asOf: '2026-11-12' }), after = run({ ...s, asOf: '2026-11-13' });
  assert.equal(before.holidayDays, 1, 'only Nov 2'); assert.equal(after.holidayDays, 2, 'Nov 13 once it arrives');
  assert.equal(round2(after.earnings.basic - before.earnings.basic), 755);
});
