import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { calculatePayroll, dates, isRest } from '../src/engine.mjs';
import { saveProfile } from '../src/profiles.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';

const admin = { username: 'admin', role: 'admin' };
const DAILY = 755;
// 1–15 Sep 2026 with Sunday rest: 13 workdays (Sundays 6 and 13 excluded).
function dailyState(payroll = { basis: 'daily', dailyRate: DAILY }) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true }];
  s.employees = [{ id: 'D1', name: 'Daily, Worker', department: 'Admin', monthlySalary: 19692.92, startDate: '2025-01-01', endDate: '', restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [], active: true }];
  s.employeeProfiles = [{ employeeId: 'D1', section: 'payroll', ...payroll }];
  s.attendance = dates('2026-09-01', '2026-09-15').filter(d => !isRest(s.employees[0], d)).map(d => ({ id: d, employeeId: 'D1', date: d, status: 'present', scheduledIn: '09:00', timeIn: '09:00', timeOut: '17:00', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }));
  return s;
}

test('daily-paid basic is the daily rate times scheduled workdays, Sundays unpaid', () => {
  const row = calculatePayroll(dailyState(), '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.workingDays, 13);
  assert.equal(row.earnings.basic, 13 * DAILY);
  assert.equal(row.dailyRate, DAILY);
  assert.equal(row.hourlyRate, round2(DAILY / 8));
  assert.match(row.trace.find(t => t.component === 'basic').formula, /755 × 13 scheduled workdays/);
});

test('a daily-paid absence removes exactly one day of pay', () => {
  const s = dailyState();
  s.attendance[0] = { ...s.attendance[0], status: 'absent', timeIn: '', timeOut: '' };
  const row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.earnings.basic - row.deductions.absence, 12 * DAILY);
});

test('monthly-paid employees are unchanged and daily basis requires a daily rate', () => {
  const monthly = calculatePayroll(dailyState({ basis: 'monthly' }), '2026-09-01', '2026-09-15').rows[0];
  assert.equal(monthly.earnings.basic, round2(19692.92 * 0.5));
  const missing = calculatePayroll(dailyState({ basis: 'daily' }), '2026-09-01', '2026-09-15');
  assert.ok(missing.blockers.some(b => b.includes('daily rate')));
});

test('payroll profiles accept only monthly or daily pay basis', () => {
  const store = new Store(':memory:');
  try {
    const state = store.read();
    state.employees.push({ id: 'D1', name: 'Daily, Worker', draft: true, active: false, startDate: '', endDate: '', monthlySalary: null, department: '', restDays: [0], scheduleStart: '', leaveEligibility: [] });
    store.write(state);
    assert.equal(saveProfile(store, admin, 'D1', 'payroll', { basis: 'daily', dailyRate: DAILY }).basis, 'daily');
    assert.equal(saveProfile(store, admin, 'D1', 'payroll', {}).basis, '', 'blank means monthly');
    assert.throws(() => saveProfile(store, admin, 'D1', 'payroll', { basis: 'weekly' }));
  } finally { store.close(); }
});

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
