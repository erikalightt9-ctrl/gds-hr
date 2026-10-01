import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { calculatePayroll, scheduleOn } from '../src/engine.mjs';
import { saveProfile } from '../src/profiles.mjs';
import { todayAttendance } from '../src/portal.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';

function fixture() {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true }];
  s.employees = [{ id: 'EMP-001', name: 'Test Employee', department: 'Operations', monthlySalary: 30000, startDate: '2025-01-01', endDate: '', restDays: [0, 6], scheduleStart: '08:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
  return s;
}
const attend = (date, extra = {}) => ({ id: date, employeeId: 'EMP-001', date, status: 'present', scheduledIn: '08:00', timeIn: '08:00', timeOut: '16:00', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true, ...extra });
const admin = { username: 'admin', role: 'admin' };
const SATURDAY = '2026-09-05', MONDAY = '2026-09-07';
const weekday = { scheduleEnd: '18:00', hoursPerDay: 8, mealBreakMinutes: 60, arrangement: 'Office' };
const halfDaySaturday = { day: 6, scheduleStart: '09:00', scheduleEnd: '14:00', hoursPerDay: 5, mealBreakMinutes: 0, arrangement: 'Office' };

function sixDayState(profile) {
  const s = fixture();
  s.employees[0] = { ...s.employees[0], restDays: [0], scheduleStart: '09:00' };
  s.employeeProfiles = [{ employeeId: 'EMP-001', section: 'attendance', ...profile }];
  return s;
}

test('day overrides replace the base schedule only on their weekday', () => {
  const employee = { scheduleStart: '09:00' }, profile = { ...weekday, daySchedules: [halfDaySaturday] };
  assert.deepEqual(scheduleOn(employee, profile, MONDAY), { start: '09:00', end: '18:00', hoursPerDay: 8, mealBreakMinutes: 60, arrangement: 'Office' });
  assert.deepEqual(scheduleOn(employee, profile, SATURDAY), { start: '09:00', end: '14:00', hoursPerDay: 5, mealBreakMinutes: 0, arrangement: 'Office' });
  const wfh = scheduleOn(employee, { ...weekday, daySchedules: [{ day: 6, arrangement: 'WFH' }] }, SATURDAY);
  assert.deepEqual(wfh, { start: '09:00', end: '18:00', hoursPerDay: 8, mealBreakMinutes: 60, arrangement: 'WFH' }, 'blank override fields inherit the base schedule');
  assert.equal(scheduleOn(employee, {}, MONDAY, { normalHours: 7 }).hoursPerDay, 7, 'rules supply hours when no profile value exists');
});

test('a Saturday half-day override is not charged as undertime', () => {
  const halfDay = attend(SATURDAY, { scheduledIn: '09:00', timeIn: '09:00', timeOut: '14:00' });
  const withOverride = sixDayState({ ...weekday, daySchedules: [halfDaySaturday] });
  withOverride.attendance = [halfDay];
  assert.equal(calculatePayroll(withOverride, '2026-09-01', '2026-09-15').rows[0].deductions.undertime, 0);
  const withoutOverride = sixDayState(weekday);
  withoutOverride.attendance = [halfDay];
  assert.ok(calculatePayroll(withoutOverride, '2026-09-01', '2026-09-15').rows[0].deductions.undertime > 0, 'control: base 8-hour day flags undertime');
});

test('a 12-hour regular schedule earns overtime only after 12 paid hours', () => {
  const s = sixDayState({ scheduleEnd: '20:00', hoursPerDay: 12, mealBreakMinutes: 0, arrangement: 'Office' });
  s.employees[0].scheduleStart = '08:00';
  s.attendance = [attend(MONDAY, { timeIn: '08:00', timeOut: '20:00' })];
  const regular = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(regular.earnings.regularOT, 0);
  assert.equal(regular.deductions.undertime, 0);
  s.attendance = [attend(MONDAY, { timeIn: '08:00', timeOut: '21:00' })];
  assert.equal(calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0].earnings.regularOT, 213.07, '1 h × 170.4545 × 1.25');
});

test('attendance profiles validate day schedules and allow up to 16 regular hours', () => {
  const store = new Store(':memory:');
  try {
    const state = store.read();
    state.employees.push({ id: 'E1', name: 'Driver, Test', draft: true, active: false, startDate: '', endDate: '', monthlySalary: null, department: '', restDays: [0], scheduleStart: '08:00', leaveEligibility: [] });
    store.write(state);
    const saved = saveProfile(store, admin, 'E1', 'attendance', { hoursPerDay: 12, daySchedules: [halfDaySaturday] });
    assert.deepEqual(saved.daySchedules, [halfDaySaturday]);
    assert.deepEqual(saveProfile(store, admin, 'E1', 'attendance', { hoursPerDay: 8 }).daySchedules, [], 'defaults to no overrides');
    assert.throws(() => saveProfile(store, admin, 'E1', 'attendance', { hoursPerDay: 17 }));
    assert.throws(() => saveProfile(store, admin, 'E1', 'attendance', { daySchedules: [halfDaySaturday, { ...halfDaySaturday }] }), /Duplicate/);
    assert.throws(() => saveProfile(store, admin, 'E1', 'attendance', { daySchedules: [{ day: 7 }] }));
  } finally { store.close(); }
});

test('the employee portal shows the day-specific schedule and arrangement', () => {
  const store = new Store(':memory:');
  try {
    const state = store.read();
    state.employees.push({ id: 'E1', name: 'Staff, Test', draft: false, active: true, startDate: '2026-01-01', endDate: '', monthlySalary: 20000, department: 'Admin', restDays: [0], scheduleStart: '09:00', leaveEligibility: [], coveredOT: false, coveredNSD: false, coveredHoliday: false, covered13th: false });
    store.write(state);
    saveProfile(store, admin, 'E1', 'attendance', { ...weekday, daySchedules: [halfDaySaturday] });
    const employee = store.read().employees[0];
    const saturday = todayAttendance(store, employee, new Date(`${SATURDAY}T01:00:00Z`));
    assert.equal(saturday.scheduledOut, '14:00');
    assert.equal(saturday.arrangement, 'Office');
    saveProfile(store, admin, 'E1', 'attendance', { ...weekday, daySchedules: [{ day: 6, arrangement: 'WFH' }] });
    const wfh = todayAttendance(store, employee, new Date(`${SATURDAY}T01:00:00Z`));
    assert.equal(wfh.scheduledOut, '18:00');
    assert.equal(wfh.arrangement, 'WFH');
    assert.equal(todayAttendance(store, employee, new Date(`${MONDAY}T01:00:00Z`)).arrangement, 'Office');
  } finally { store.close(); }
});
