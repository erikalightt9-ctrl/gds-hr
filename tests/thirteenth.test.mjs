import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll } from '../src/service.mjs';
import { savePriorEarnings, thirteenthLedger, computeFinalPay, finalPayOverview, thirteenthOverview } from '../src/thirteenth.mjs';
import { dates, isRest } from '../src/engine.mjs';
import { completeState, admin } from './helpers.mjs';

const payroll = { username: 'pay1', role: 'payroll' };
function fixture() { const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s); return store; }
const encode = (store, months, basic = 30000, extra = {}) => savePriorEarnings(store, payroll, { entries: months.map(m => ({ employeeId: 'EMP-001', month: `2026-${m}`, basic, ...extra })) });
const JAN_AUG = ['01', '02', '03', '04', '05', '06', '07', '08'];
function postSeptFirstHalf(store, pay13th = false) {
  const run = preview(store, '2026-09-01', '2026-09-15', pay13th, ['EMP-001']);
  return { run, posted: postPayroll(store, admin, { start: run.start, end: run.end, pay13th, fingerprint: run.fingerprint, employeeIds: ['EMP-001'] }) };
}

test('salary encoded for months before the system counts toward the 13th month, with posted payroll', () => {
  const store = fixture();
  try {
    encode(store, JAN_AUG, 30000, { thirteenthPaid: 0 });
    encode(store, ['03'], 30000, { thirteenthPaid: 5000, notes: 'Mid-year advance' });
    const before = thirteenthLedger(store, payroll, '2026')[0];
    assert.equal(before.priorBasic, 240000); assert.equal(before.accrued, 20000); assert.equal(before.paid, 5000); assert.equal(before.balance, 15000);
    assert.deepEqual(before.missingMonths, ['2026-09', '2026-10'].filter(m => m <= new Date().toISOString().slice(0, 7)));
    const { run } = postSeptFirstHalf(store, true), row = run.rows[0];
    assert.equal(row.annualBasic, Math.round((240000 + row.applicableBasic) * 100) / 100, 'payroll uses encoded months');
    assert.equal(row.thirteenthPaid, 5000);
    assert.equal(row.earnings.thirteenth, Math.round((row.annualBasic / 12 - 5000) * 100) / 100);
    assert.match(row.trace.find(t => t.component === 'thirteenth').formula, /encoded for 8 months/);
    const after = thirteenthLedger(store, payroll, '2026')[0];
    assert.equal(after.balance, 0, 'paid out in payroll');
    assert.ok(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='prior-earnings'").get().n >= 9, 'every encoded month is audited');
  } finally { store.close(); }
});

test('a month with posted payroll cannot be encoded and is never counted twice; blanks clear an entry', () => {
  const store = fixture();
  try {
    encode(store, ['09']);
    postSeptFirstHalf(store);
    const l = thirteenthLedger(store, payroll, '2026')[0];
    assert.equal(l.priorBasic, 0, 'September comes from posted payroll only');
    assert.throws(() => encode(store, ['09']), /posted payroll/);
    encode(store, ['01']); encode(store, ['01'], null);
    assert.equal(thirteenthLedger(store, payroll, '2026')[0].priorMonths.length, 0);
    assert.throws(() => savePriorEarnings(store, payroll, { entries: [{ employeeId: 'EMP-001', month: '2099-01', basic: 1 }] }), /future/);
    assert.throws(() => savePriorEarnings(store, payroll, { entries: [{ employeeId: 'NOPE', month: '2026-01', basic: 1 }] }), /Unknown employee/);
    assert.throws(() => savePriorEarnings(store, { username: 'x', role: 'hr_staff' }, { entries: [{ employeeId: 'EMP-001', month: '2026-01', basic: 1 }] }), /permission/);
    assert.throws(() => savePriorEarnings(store, payroll, { entries: [{ employeeId: 'EMP-001', month: '2026-13', basic: 1 }] }));
    assert.equal(thirteenthOverview(store, payroll, '2026').postedMonths['EMP-001'][0], '2026-09');
  } finally { store.close(); }
});

test('final pay: unpaid salary, pro-rated 13th month, leave conversion, separation pay, less loans', () => {
  const store = fixture();
  try {
    encode(store, JAN_AUG);
    postSeptFirstHalf(store);
    const s = store.read();
    s.loans = [{ id: 'l1', employeeId: 'EMP-001', type: 'Salary Loan', reference: 'SL-1', principal: 5000, balance: 4000, startDate: '2026-01-01', endDate: '2026-12-31', monthlyAmortization: 1000, perPayroll: 500, terms: 10, remainingTerms: 8, authorized: true, interestTotal: 0, interestBalance: 200, applicationId: '' }];
    store.write(s);
    const emp = s.employees[0], workdays = dates('2026-09-16', '2026-09-30').filter(d => !isRest(emp, d)).length;
    const r = computeFinalPay(store, payroll, { employeeId: 'EMP-001', separationDate: '2026-09-30', separationCause: 'redundancy', convertLeave: ['sil'] });
    const item = label => r.items.find(i => i.label.startsWith(label));
    assert.equal(item('Unpaid salary').amount, Math.round(workdays * r.dailyRate * 100) / 100);
    assert.match(item('Unpaid salary').basis, /paid through 2026-09-15/);
    const ledger = thirteenthLedger(store, payroll, '2026')[0];
    assert.equal(item('Pro-rated 13th month').amount, Math.round((ledger.totalBasic + item('Unpaid salary').amount) / 12 * 100) / 100);
    assert.equal(r.yearsOfService, 2, '1 year 8 months: a fraction of 6 months or more counts as a year');
    assert.equal(item('Separation pay').amount, 60000);
    assert.match(item('Unused').basis, /unused day/, 'SIL converted at the daily rate');
    assert.equal(item('Salary Loan').amount, 4200, 'principal + interest outstanding');
    assert.equal(r.net, Math.round((r.gross - r.deductions) * 100) / 100);
    assert.equal(r.releaseDue, '2026-10-30');
    const retrench = computeFinalPay(store, payroll, { employeeId: 'EMP-001', separationDate: '2026-09-30', separationCause: 'retrenchment', unpaidDays: 3, deductLoans: false });
    assert.equal(retrench.items.find(i => i.label === 'Separation pay').amount, 30000, 'half a month × 2 years, at least one month');
    assert.equal(retrench.items.find(i => i.label === 'Unpaid salary').amount, Math.round(3 * r.dailyRate * 100) / 100);
    assert.ok(!retrench.items.some(i => i.side === 'deductions'));
    assert.throws(() => computeFinalPay(store, { username: 'e', role: 'employee', employeeId: 'EMP-001' }, { employeeId: 'EMP-001', separationDate: '2026-09-30' }), /permission/);
    assert.throws(() => computeFinalPay(store, payroll, { employeeId: 'EMP-001', separationDate: '2024-01-01' }), /start date/);
    computeFinalPay(store, payroll, { employeeId: 'EMP-001', separationDate: '2026-09-30', save: true });
    assert.equal(finalPayOverview(store, payroll).records.length, 1);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='final-pay'").get().n, 1);
  } finally { store.close(); }
});
