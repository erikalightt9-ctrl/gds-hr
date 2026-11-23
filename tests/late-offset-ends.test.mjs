import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, dates, isRest, LATE_OFFSET_ENDS } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';

// From Nov 23, 2026 (HR): a late of 15 minutes or more is deducted in full even with an approved offset.
function state() {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, dailyDivisor: 26 }];
  s.employees = [{ id: 'E1', name: 'Late, Test', department: 'Admin', monthlySalary: 26000, startDate: '2025-01-01', endDate: '', restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true }];
  s.employeeProfiles = [{ employeeId: 'E1', section: 'attendance', hoursPerDay: 8, mealBreakMinutes: 60 }];
  s.attendance = dates('2026-11-16', '2026-11-30').filter(d => !isRest(s.employees[0], d)).map(d => ({ id: d, employeeId: 'E1', date: d, status: 'present', scheduledIn: '09:00', timeIn: '09:00', timeOut: '18:00', endNextDay: false, breaks: [{ start: `${d}T12:00`, end: `${d}T13:00` }], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }));
  return s;
}
const lateOn = (s, date, timeIn, extra = {}) => { Object.assign(s.attendance.find(x => x.date === date), { timeIn, ...extra }); return s; };
const lateRow = (s, date) => calculatePayroll({ ...s, asOf: '2026-11-30' }, '2026-11-16', '2026-11-30').rows[0].late.find(l => l.date === date);

test('from Nov 23, 2026 an offset no longer cancels a late of 15 minutes or more; earlier dates keep it', () => {
  assert.equal(LATE_OFFSET_ENDS, '2026-11-23');
  assert.equal(lateRow(lateOn(state(), '2026-11-20', '09:30', { offsetMinutes: 30 }), '2026-11-20').deductibleMinutes, 0, 'Nov 20: offset still applies');
  assert.equal(lateRow(lateOn(state(), '2026-11-23', '09:30', { offsetMinutes: 30 }), '2026-11-23').deductibleMinutes, 30, 'Nov 23: deducted in full');
  assert.equal(lateRow(lateOn(state(), '2026-11-24', '09:10', { offsetMinutes: 10 }), '2026-11-24').deductibleMinutes, 0, 'under 15 min: grace, nothing lost');
});

test('approved exceptions and the cutoff waive-late switch still cancel it', () => {
  assert.equal(lateRow(lateOn(state(), '2026-11-24', '09:40', { offsetMinutes: 40, exception: true }), '2026-11-24').deductibleMinutes, 0);
  const s = lateOn(state(), '2026-11-24', '09:40', { offsetMinutes: 40 });
  s.payrollInputs = [{ employeeId: 'E1', start: '2026-11-16', end: '2026-11-30', mode: 'add', waiveLate: true, hours: {}, overrides: [] }];
  assert.equal(lateRow(s, '2026-11-24').deductibleMinutes, 0);
});
