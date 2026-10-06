import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';
import { payDateFor, payslipReleased } from '../src/paydays.mjs';
import { employeeDashboard, ownPayslip } from '../src/portal.mjs';

const worker = { id: 'w', username: 'employee1', role: 'employee', employeeId: 'EMP-001' };

test('salary days: 1st-15th is paid on the 22nd, 16th-end on the 8th of the next month', () => {
  assert.equal(payDateFor('2026-09-01', '2026-09-15'), '2026-09-22');
  assert.equal(payDateFor('2026-09-16', '2026-09-30'), '2026-10-08');
  assert.equal(payDateFor('2026-12-16', '2026-12-31'), '2027-01-08', 'year change');
  assert.equal(payslipReleased({ status: 'posted', start: '2026-09-16', end: '2026-09-30' }, '2026-10-07'), false);
  assert.equal(payslipReleased({ status: 'posted', start: '2026-09-16', end: '2026-09-30' }, '2026-10-08'), true);
  assert.equal(payslipReleased({ status: 'reversed', start: '2026-09-16', end: '2026-09-30' }, '2026-10-08'), false);
});

test('a finalized payslip shows in the employee account only from salary day, with a one-time notice', () => {
  const store = new Store(':memory:'), s = completeState();
  const row = { employeeId: 'EMP-001', employeeName: 'Sample Employee', net: 1000, gross: 1000, totalDeductions: 0, earnings: {}, deductions: {}, loanDeductions: [], trace: [] };
  s.runs = [{ id: 'run-paid', status: 'posted', start: '2026-09-01', end: '2026-09-15', rows: [row], totals: {} }, { id: 'run-future', status: 'posted', start: '2099-01-01', end: '2099-01-15', rows: [row], totals: {} }];
  store.write(s);
  try {
    const d = employeeDashboard(store, worker);
    assert.deepEqual(d.payslips.map(p => p.id), ['run-paid']);
    assert.deepEqual(d.upcomingPayslips.map(p => p.payDate), ['2099-01-22']);
    assert.throws(() => ownPayslip(store, worker, 'run-future'), /salary day, 2099-01-22/);
    const notices = () => store.db.prepare("SELECT COUNT(*) n FROM notifications WHERE employee_id='EMP-001' AND message LIKE '%is now available%'").get().n;
    assert.equal(notices(), 1); employeeDashboard(store, worker); assert.equal(notices(), 1, 'announced once');
  } finally { store.close(); }
});
