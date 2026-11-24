import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { saveRecord } from '../src/service.mjs';
import { saveProfile } from '../src/profiles.mjs';
import { completeState, admin } from './helpers.mjs';
import { requestSalaryChange, decideSalaryChange, salaryHistory, applyDueSalaryChanges } from '../src/salary-changes.mjs';

const payroll = { username: 'pay1', role: 'payroll' }, hr = { username: 'hr1', role: 'hr' };
function fixture() { const store = new Store(':memory:'), s = completeState(); s.loans = []; s.employees.push({ ...s.employees[0], id: 'EMP-002', name: 'Second, Employee' }); store.write(s); return store; }

test('salary: no direct edits; a change needs a reason, an effective date and a second approver, and is kept in the history', () => {
  const store = fixture();
  try {
    const e = store.read().employees[0];
    assert.throws(() => saveRecord(store, admin, 'employees', { ...e, monthlySalary: 40000 }), /Request salary change/);
    assert.throws(() => requestSalaryChange(store, hr, { employeeId: e.id, monthlySalary: 40000, effectiveDate: '2026-12-01', reason: 'short' }), /reason/);
    const c = requestSalaryChange(store, hr, { employeeId: e.id, monthlySalary: 40000, effectiveDate: '2026-01-01', reason: 'Regularization after probation' });
    assert.throws(() => requestSalaryChange(store, hr, { employeeId: e.id, monthlySalary: 41000, effectiveDate: '2026-01-01', reason: 'Another change meanwhile' }), /already waiting/);
    assert.throws(() => decideSalaryChange(store, hr, c.id, { decision: 'approve' }), /second person/, 'the requester cannot approve (a Company Admin may approve requests of others, Nov 24, 2026)');
    const applied = decideSalaryChange(store, payroll, c.id, { decision: 'approve' });
    assert.equal(applied.status, 'applied', 'effective date reached: applied at once');
    assert.equal(store.read().employees[0].monthlySalary, 40000);
    const later = requestSalaryChange(store, payroll, { employeeId: e.id, monthlySalary: 45000, effectiveDate: '2099-01-01', reason: 'Promotion to team lead' });
    assert.throws(() => decideSalaryChange(store, payroll, later.id, { decision: 'approve' }), /second person/);
    assert.equal(decideSalaryChange(store, admin, later.id, { decision: 'approve' }).status, 'approved');
    assert.equal(applyDueSalaryChanges(store, new Date('2026-11-20T00:00:00Z')), 0, 'not before its effective date');
    assert.equal(store.read().employees[0].monthlySalary, 40000);
    assert.equal(applyDueSalaryChanges(store, new Date('2099-01-01T02:00:00Z')), 1);
    assert.equal(store.read().employees[0].monthlySalary, 45000);
    assert.deepEqual(salaryHistory(store, admin, e.id).map(x => x.status), ['applied', 'applied']);
    saveProfile(store, admin, 'EMP-002', 'payroll', { basis: 'daily', dailyRate: 800 });
  } finally { store.close(); }
});
