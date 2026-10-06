import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { addContributionEmployee } from '../src/contribution-encode.mjs';
import { monthlyContributions } from '../src/contribution-report.mjs';
import { calculatePayroll } from '../src/engine.mjs';

function fixture() { const store = new Store(':memory:'); store.write(completeState()); return store; }

test('a new person encoded for contributions appears in the report, not in payroll', () => {
  const store = fixture();
  try {
    const added = addContributionEmployee(store, admin, { lastName: 'cheng', firstName: 'demry', employeeNumber: 'CEO-1', monthlySalary: 22000, startMonth: '2026-09' });
    assert.equal(added.name, 'Cheng, Demry');
    const p = monthlyContributions(store, '2026-09').people.find(x => x.employeeId === 'CEO-1');
    assert.equal(p.sssBasis, 22000);
    assert.equal(p.deductions, Math.round((p.sssEE + p.phEE + p.piEE) * 100) / 100, 'shares from the tables');
    assert.ok(!calculatePayroll(store.read(), '2026-09-16', '2026-09-30').rows.some(r => r.employeeId === 'CEO-1'));
    assert.throws(() => addContributionEmployee(store, admin, { lastName: 'X', firstName: 'Y', employeeNumber: 'CEO-1', monthlySalary: 1000, startMonth: '2026-09' }), /already used/);
  } finally { store.close(); }
});

test('an employee paid through payroll cannot be moved to manual encoding; only HR and Admin may add', () => {
  const store = fixture();
  try {
    const id = store.read().employees[0].id;
    assert.throws(() => addContributionEmployee(store, admin, { employeeId: id, monthlySalary: 20000, startMonth: '2026-09' }), /already in payroll/);
    assert.throws(() => addContributionEmployee(store, { username: 'v', role: 'viewer' }, { lastName: 'A', firstName: 'B', monthlySalary: 1, startMonth: '2026-09' }), /permission/i);
  } finally { store.close(); }
});
