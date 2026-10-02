import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, initialState } from '../src/defaults.mjs';
import { calculatePayroll, dayRate, nightMinutes, leaveBalance, workMinutes } from '../src/engine.mjs';
import { completeState } from './helpers.mjs';

export function fixture() {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true }];
  s.employees = [{ id: 'EMP-001', name: 'Test Employee', department: 'Operations', monthlySalary: 30000, startDate: '2025-01-01', endDate: '', restDays: [0, 6], scheduleStart: '08:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: ['vacation', 'sil'], active: true }];
  return s;
}
export function attend(date, extra = {}) {
  return { id: date, employeeId: 'EMP-001', date, status: 'present', scheduledIn: '08:00', timeIn: '08:00', timeOut: '16:00', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true, ...extra };
}
test('compound premiums derive from underlying rates', () => {
  assert.ok(Math.abs(dayRate('rest', defaultRules) * defaultRules.premiumOT - 1.69) < 1e-9);
  assert.equal(dayRate('regular-rest', defaultRules) * defaultRules.premiumOT, 3.3800000000000003);
  assert.ok(Math.abs(dayRate('rest', defaultRules) * (1 + defaultRules.nsd) - 1.43) < 1e-9);
});
test('NSD crosses midnight and excludes timed breaks', () => {
  assert.equal(nightMinutes('2026-09-01T22:00', '2026-09-02T02:00', []), 240);
  assert.equal(nightMinutes('2026-09-01T21:00', '2026-09-02T07:00', [{ start: '2026-09-02T01:00', end: '2026-09-02T02:00' }]), 420);
});
test('ordinary OT and lateness are independently traced; late time reduces credited days, not a deduction line', () => {
  const s = fixture(); s.attendance = [attend('2026-09-01', { timeIn: '08:15', timeOut: '18:15' })];
  const p = calculatePayroll(s, '2026-09-01', '2026-09-15');
  const row = p.rows[0];
  assert.equal(row.earnings.regularOT, 426.14);
  assert.equal(row.deductions.late, undefined, 'no separate late deduction');
  assert.equal(row.earnings.basic, 15000 - 42.61, '15 min of a 480-min day = 0.03125 day x 1,363.64 daily');
  assert.equal(row.creditedDays, 0.9688, 'credited days are kept to 4 decimals');
  assert.ok(p.blockers.some(x => x.includes('Missing attendance')));
  assert.equal(row.late[0].deductibleMinutes, 15);
  assert.equal(row.late[0].sourceId, '2026-09-01');
});
test('approved exception and offset protect covered late time', () => {
  for (const extra of [{ exception: true }, { offsetMinutes: 15 }]) {
    const s = fixture(); s.attendance = [attend('2026-09-01', { timeIn: '08:15', timeOut: '16:15', ...extra })];
    const row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
    assert.equal(row.earnings.basic, 15000, 'covered late time does not reduce pay');
    assert.equal(row.creditedDays, 1);
  }
});
test('rest-day night work adds only differential, with no double-counting', () => {
  const s = fixture(); s.attendance = [attend('2026-09-05', { timeIn: '22:00', timeOut: '02:00', endNextDay: true })];
  const row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.earnings.restDay, 886.36);
  assert.equal(row.earnings.nsd, 88.64);
});
test('unworked special holiday defaults unpaid; policy can pay it', () => {
  const s = fixture(); s.holidays = [{ id: 'h1', date: '2026-09-01', name: 'Test holiday', kind: 'special', basis: 'Test proclamation' }];
  s.attendance = [attend('2026-09-01', { status: 'off', timeIn: '', timeOut: '' })];
  assert.equal(calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0].deductions.absence, 1363.64);
  s.rules[0].specialUnworked = 1;
  assert.equal(calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0].deductions.absence, 0);
});
test('loan deduction is capped to balance and respects its schedule', () => {
  const s = fixture(); s.loans = [{ id: 'l1', employeeId: 'EMP-001', type: 'Salary Loan', reference: 'L1', original: 50000, balance: 1200, monthlyAmortization: 5000, perPayroll: 2500, startDate: '2026-01-01', endDate: '2026-12-31', terms: 20, remainingTerms: 1, authorized: true }];
  assert.equal(calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0].loanDeductions[0].amount, 1200);
  assert.equal(s.loans[0].balance, 1200);
});
test('13th-month ledger uses posted basic earnings, excluding premiums', () => {
  const s = fixture(); s.runs = [{ status: 'posted', start: '2026-08-01', end: '2026-08-15', rows: [{ employeeId: 'EMP-001', applicableBasic: 15000, earnings: { regularOT: 5000, thirteenth: 0 } }] }];
  const row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.annualBasic, 15000 + row.applicableBasic);
  assert.equal(row.thirteenthAccrued, Math.round(row.annualBasic / 12 * 100) / 100);
});
test('leave accrual enforces eligibility and service period', () => {
  const s = fixture(); const e = s.employees[0]; const type = s.leaveTypes.find(x => x.id === 'sil');
  assert.equal(leaveBalance(s, e, type, '2025-06-01').entitled, 0);
  assert.equal(leaveBalance(s, e, type, '2026-09-01').entitled, 5);
  e.leaveEligibility = [];
  assert.equal(leaveBalance(s, e, type, '2026-09-01').entitled, 0);
});
test('rejects invalid and overlapping cutoffs and unapproved rules', () => {
  const s = fixture();
  assert.throws(() => calculatePayroll(s, '2026-09-10', '2026-09-01'));
  s.rules[0].approvedBy = '';
  assert.ok(calculatePayroll(s, '2026-09-01', '2026-09-15').blockers.some(x => x.includes('approved')));
});
test('holiday overtime uses the holiday multiplier, and night work adds differential only', () => {
  const s = completeState();
  s.holidays = [{ id: 'holiday', date: '2026-09-01', name: 'Test regular holiday', kind: 'regular', basis: 'Test' }];
  s.attendance[0] = attend('2026-09-01', { timeIn: '14:00', timeOut: '00:00', endNextDay: true, scheduledIn: '14:00' });
  const row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.earnings.regularHoliday, 1363.64);
  assert.equal(row.earnings.regularHolidayOT, 886.36);
  assert.equal(row.earnings.nsd, 88.64);
  assert.equal(row.applicableBasic, 13636.36);
});
test('cross-midnight holiday classification follows the actual date', () => {
  const s = completeState(); s.holidays = [{ id: 'h', date: '2026-09-02', kind: 'regular' }];
  s.attendance[0] = attend('2026-09-01', { timeIn: '22:00', timeOut: '06:00', endNextDay: true, scheduledIn: '22:00' });
  const row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.earnings.regularHoliday, 2386.37); // Each auditable source line rounds to cents: 1022.73 + 1363.64.
  assert.equal(row.earnings.nsd, 238.64);
});
test('paid and unpaid leave affect payroll and annual basic independently', () => {
  const s = completeState(); s.attendance = s.attendance.filter(a => a.date !== '2026-09-01');
  s.leaves = [{ id: 'leave', employeeId: 'EMP-001', typeId: 'vacation', startDate: '2026-09-01', endDate: '2026-09-01', days: 1, status: 'approved' }];
  let row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.leaveDays, 1); assert.equal(row.deductions.absence, 0);
  s.leaveTypes.find(t => t.id === 'vacation').includedIn13th = false;
  row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.applicableBasic, 13636.36);
  s.leaves[0].typeId = 'unpaid';
  row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.deductions.absence, 1363.64);
});
test('contribution and withholding brackets are evaluated transparently', () => {
  const s = completeState(); const r = s.rules[0];
  r.contributions.SSS = [{ from: 0, to: null, fixed: 0, rate: 0.05, excessOver: 0 }];
  r.taxBrackets = [{ from: 0, to: 10000, fixed: 0, rate: 0, excessOver: 0 }, { from: 10000, to: null, fixed: 0, rate: 0.1, excessOver: 10000 }];
  const row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.deductions.SSS, 750);
  assert.equal(row.deductions.tax, 425);
});
test('monthly cap stops loan deduction even if per-payroll amount is higher', () => {
  const s = completeState(); s.loans[0].balance = 15000; s.loans[0].monthlyAmortization = 1000;
  s.runs = [{ status: 'posted', start: '2026-09-16', end: '2026-09-30', rows: [{ employeeId: 'EMP-001', applicableBasic: 0, earnings: { thirteenth: 0 }, loanDeductions: [{ loanId: 'loan1', amount: 900 }] }] }];
  assert.equal(calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0].loanDeductions[0].amount, 100);
  s.runs[0].rows[0].loanDeductions[0].amount = 1000;
  assert.equal(calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0].loanDeductions.length, 0);
});
test('13th-month payout deducts prior payouts and includes taxable excess', () => {
  const s = completeState(); s.rules[0].thirteenthTaxExemption = 1000;
  s.rules[0].taxBrackets = [{ from: 0, to: null, fixed: 0, rate: 0.1, excessOver: 0 }];
  const row = calculatePayroll(s, '2026-09-01', '2026-09-15', true).rows[0];
  assert.equal(row.earnings.thirteenth, 1250);
  assert.equal(row.deductions.tax, 1525);
});
test('carry-over already used does not reduce new entitlement after expiration', () => {
  const s = completeState(), e = s.employees[0], type = s.leaveTypes.find(t => t.id === 'vacation');
  type.entitledDays = 10; type.carryOverDays = 5; type.expirationMonths = 3;
  s.leaves = [{ employeeId: e.id, typeId: type.id, status: 'approved', startDate: '2026-01-05', endDate: '2026-01-06', days: 2 }];
  const b = leaveBalance(s, e, type, '2026-09-01');
  assert.equal(b.available, 10); assert.equal(b.expired, 3);
});
test('invalid shift duration, overlapping breaks and invalid dates are rejected', () => {
  assert.throws(() => workMinutes('2026-09-01T08:00', '2026-09-01T08:00', []));
  assert.throws(() => workMinutes('2026-09-01T08:00', '2026-09-03T08:00', []));
  assert.throws(() => workMinutes('2026-09-01T08:00', '2026-09-01T17:00', [{ start: '2026-09-01T12:00', end: '2026-09-01T13:00' }, { start: '2026-09-01T12:30', end: '2026-09-01T14:00' }]));
  assert.throws(() => calculatePayroll(completeState(), '2026-02-30', '2026-03-15'));
});
test('unworked holiday on a rest day needs an eligibility record before posting', () => {
  const s = completeState(); s.holidays = [{ id: 'h', date: '2026-09-06', kind: 'regular' }];
  assert.ok(calculatePayroll(s, '2026-09-01', '2026-09-15').blockers.some(b => b.includes('2026-09-06')));
  s.attendance.push(attend('2026-09-06', { status: 'off', timeIn: '', timeOut: '' }));
  assert.equal(calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0].earnings.regularHoliday, 1363.64);
});
