import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';
import { schemas } from '../src/schema.mjs';

const MONDAY = '2026-09-21', SATURDAY = '2026-09-19';
function state(attendanceProfile = {}) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true }];
  s.employees = [{ id: 'E1', name: 'Policy, Test', department: 'Admin', monthlySalary: 22000, startDate: '2025-01-01', endDate: '', restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
  s.employeeProfiles = [{ employeeId: 'E1', section: 'attendance', scheduleEnd: '18:00', hoursPerDay: 8, mealBreakMinutes: 60, ...attendanceProfile }];
  return s;
}
const day = (date, extra = {}) => ({ id: date, employeeId: 'E1', date, status: 'present', scheduledIn: '09:00', timeIn: '07:00', timeOut: '18:00', endNextDay: false, breaks: [{ start: `${date}T12:00`, end: `${date}T13:00` }], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true, ...extra });
const run = s => calculatePayroll(s, '2026-09-16', '2026-09-30').rows[0];

test('early arrival is paid by default but not when paid time starts at the schedule', () => {
  const actual = state(); actual.attendance = [day(MONDAY)];
  assert.ok(run(actual).earnings.regularOT > 0, 'control: 07:00 start counts two early hours as overtime');
  const fromSchedule = state({ paidFrom: 'schedule' }); fromSchedule.attendance = [day(MONDAY)];
  const row = run(fromSchedule);
  assert.equal(row.earnings.regularOT, 0, 'no overtime for leaving at the scheduled end');
  assert.equal(row.deductions.undertime, 0);
  fromSchedule.attendance = [day(MONDAY, { timeOut: '20:00' })];
  assert.equal(run(fromSchedule).earnings.regularOT, round(2 * 22000 / 22 / 8 * 1.25), 'overtime only after 6 PM');
});

test('a rest-day swap is paid like a normal day without an absence deduction', () => {
  const swap = state(); swap.attendance = [day(SATURDAY, { status: 'rest-day-swap', timeIn: '', timeOut: '', breaks: [], explanation: 'Worked Sunday Sept 20 instead' })];
  const absent = state(); absent.attendance = [day(SATURDAY, { status: 'absent', timeIn: '', timeOut: '', breaks: [] })];
  assert.equal(run(swap).deductions.absence, 0);
  assert.ok(run(absent).deductions.absence > 0, 'control: absence is deducted');
  assert.throws(() => schemas.attendance.parse(day(SATURDAY, { status: 'rest-day-swap', timeIn: '', timeOut: '', breaks: [], explanation: '' })), /swap/i, 'a swap must say which day was worked');
});

function round(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
