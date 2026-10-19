import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, initialState } from '../src/defaults.mjs';
import { calculatePayroll, dayRate, nightMinutes, leaveBalance, workMinutes } from '../src/engine.mjs';
import { completeState } from './helpers.mjs';

export function fixture() {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, overtimeApproval: 'attendance' }];
  s.employees = [{ id: 'EMP-001', name: 'Test Employee', department: 'Operations', monthlySalary: 30000, startDate: '2025-01-01', endDate: '', restDays: [0, 6], scheduleStart: '08:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: ['vacation', 'sil'], active: true }];
  return s;
}
// Present on every other scheduled weekday of the cutoff (days without attendance are not credited).
function withOtherDays(s, start = '2026-09-01', end = '2026-09-15') {
  const taken = new Set(s.attendance.map(a => a.date));
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (!taken.has(iso) && !s.employees[0].restDays.includes(d.getUTCDay())) s.attendance.push(attend(iso));
  }
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
test('ordinary OT and lateness are independently traced; late time made up after the shift is offset', () => {
  const s = fixture(); s.rules[0].graceMinutes = 0; s.attendance = [attend('2026-09-01', { timeIn: '08:15', timeOut: '18:15' })]; withOtherDays(s);
  const p = calculatePayroll(s, '2026-09-01', '2026-09-15');
  const row = p.rows[0];
  assert.equal(row.earnings.regularOT, 426.14);
  assert.equal(row.deductions.late, undefined, 'no separate late deduction');
  assert.equal(row.earnings.basic, 15000, 'the 15 late minutes are offset by staying after the scheduled end');
  assert.equal(row.creditedDays, 11);
  assert.equal(row.late[0].lateMinutes, 15); assert.equal(row.late[0].workedOffset, 15); assert.equal(row.late[0].deductibleMinutes, 0);
  assert.equal(row.late[0].sourceId, '2026-09-01');
});
test('approved exception and offset protect covered late time', () => {
  for (const extra of [{ exception: true }, { offsetMinutes: 15 }]) {
    const s = fixture(); s.attendance = [attend('2026-09-01', { timeIn: '08:15', timeOut: '16:15', ...extra })]; withOtherDays(s);
    const row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
    assert.equal(row.earnings.basic, 15000, 'covered late time does not reduce pay');
    assert.equal(row.creditedDays, 11, 'all 11 days fully credited');
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
  s.attendance = [attend('2026-09-01', { status: 'off', timeIn: '', timeOut: '' })]; withOtherDays(s);
  assert.equal(calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0].absenceAmount, 1363.64);
  s.rules[0].specialUnworked = 1;
  assert.equal(calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0].absenceAmount, 0);
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
  assert.equal(row.leaveDays, 1); assert.equal(row.absenceAmount, 0);
  s.leaveTypes.find(t => t.id === 'vacation').includedIn13th = false;
  row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.applicableBasic, 13636.36);
  s.leaves[0].typeId = 'unpaid';
  row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.absenceAmount, 1363.64); assert.equal(row.deductions.absence, 0, "absences reduce basic pay, not deductions");
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

test('scheduled workdays with no attendance are not credited: 0 days worked means 0 basic pay, and the payroll stays flagged', () => {
  const s = fixture(); s.attendance = [];
  const p = calculatePayroll(s, '2026-09-01', '2026-09-15'), row = p.rows[0];
  assert.equal(row.earnings.basic, 0, 'no days worked, no basic pay');
  assert.ok(p.blockers.some(b => /Missing attendance/.test(b)), 'still flagged for review before finalizing');
});

test('payroll is real time: unapproved attendance and a time-in without time out are counted, and stay flagged', () => {
  const s = fixture(); s.attendance = [attend('2026-09-02', { approved: false })]; withOtherDays(s);
  s.attendance = s.attendance.filter(a => a.date !== '2026-09-01');
  s.openClockIns = [{ id: 'ci-1', employeeId: 'EMP-001', workDate: '2026-09-01', time: '08:30' }];
  const p = calculatePayroll(s, '2026-09-01', '2026-09-15'), row = p.rows[0];
  assert.equal(row.daysPresent, 11, 'the open time-in day and the unapproved day both count');
  assert.equal(row.creditedDays, 10.9375, '30 minutes late on the open day: 1 - 30/480');
  assert.ok(p.blockers.some(b => /no time out yet/.test(b)) && p.blockers.some(b => /not approved/.test(b)), 'flagged until complete');
});

test('half-day leave: the leave half is paid (or deducted when unpaid); the worked half has no undertime', () => {
  const run = typeId => {
    const s = fixture(); s.attendance = [attend('2026-09-01', { timeIn: '08:00', timeOut: '12:00' })]; withOtherDays(s);
    s.leaves = [{ id: 'h1', employeeId: 'EMP-001', typeId, startDate: '2026-09-01', endDate: '2026-09-01', startTime: '12:00', endTime: '16:00', days: 0.5, countedDates: ['2026-09-01'], partialDates: ['2026-09-01'], reason: 'Half day', documentReference: 'x', status: 'approved', eligibilityVerified: true }];
    return calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  };
  const paid = run('sil');
  assert.equal(paid.deductions.undertime, 0, 'the leave half is not undertime');
  assert.equal(paid.absenceAmount, 0, 'paid half day: nothing deducted');
  const unpaid = run('unpaid');
  assert.equal(Math.round((unpaid.absenceAmount - paid.absenceAmount) * 100) / 100, 681.82, 'unpaid half day reduces basic by half a day (1,363.64 / 2)');
  assert.equal(unpaid.deductions.undertime, 0);
});

test('late time not made up reduces credited days, not a deduction line', () => {
  const s = fixture(); s.attendance = [attend('2026-09-01', { timeIn: '08:15', timeOut: '16:00' })]; withOtherDays(s);
  const row = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(row.deductions.late, undefined, 'no separate late deduction');
  assert.equal(row.earnings.basic, 15000 - 42.61, '15 min of a 480-min day = 0.03125 day x 1,363.64 daily');
  assert.equal(row.creditedDays, 10.9688, 'credited days are kept to 4 decimals (11 days present, 0.03125 day lost)');
  assert.equal(row.late[0].deductibleMinutes, 15);
});

test('a cutoff waiver removes late and undertime deductions; the minutes stay on record', () => {
  const s = fixture(); s.attendance = [attend('2026-09-01', { timeIn: '08:30', timeOut: '15:00' })]; withOtherDays(s);
  const before = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.ok(before.late[0].deductibleMinutes > 0 && before.deductions.undertime > 0);
  s.payrollInputs = [{ employeeId: 'EMP-001', start: '2026-09-01', end: '2026-09-15', mode: 'add', hours: {}, overrides: [], waiveLate: true, waiveUndertime: true, reason: 'Waived', updatedBy: 'admin' }];
  const after = calculatePayroll(s, '2026-09-01', '2026-09-15').rows[0];
  assert.equal(after.late[0].lateMinutes, 30); assert.equal(after.late[0].deductibleMinutes, 0);
  assert.equal(after.deductions.undertime, 0); assert.equal(after.earnings.basic, 15000);
});

test('a loan set to the 1st-15th cutoff is deducted only there; every-cutoff loans each cutoff', () => {
  const loan = (deductOn) => ({ id: `L-${deductOn}`, employeeId: 'EMP-001', type: 'Salary Loan', reference: deductOn, original: 5000, balance: 3000, monthlyAmortization: 0, perPayroll: 1000, loanDate: '', skipCutoffs: [], deductOn, startDate: '2026-09-01', endDate: '2027-01-15', terms: 5, remainingTerms: 3, authorized: true, interestTotal: 0, interestBalance: 0, applicationId: '' });
  const run = (start, end, l) => { const s = fixture(); withOtherDays(s, start, end); s.loans = [l]; return calculatePayroll(s, start, end).rows[0].deductions.loans; };
  assert.equal(run('2026-09-01', '2026-09-15', loan('first')), 1000);
  assert.equal(run('2026-09-16', '2026-09-30', loan('first')), 0, 'not in the 16th-end cutoff');
  assert.equal(run('2026-09-16', '2026-09-30', loan('second')), 1000);
  assert.equal(run('2026-09-16', '2026-09-30', loan('every')), 1000);
});
