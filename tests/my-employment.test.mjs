import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { saveProfile } from '../src/profiles.mjs';
import { requestMovement, decideMovement } from '../src/movements.mjs';
import { requestSalaryChange, decideSalaryChange } from '../src/salary-changes.mjs';
import { saveAllowance } from '../src/benefits.mjs';
import { myEmployment } from '../src/my-employment.mjs';

const employee = { id: 'u-emp', username: 'emp', role: 'employee', employeeId: 'EMP-001' };
const hr = { id: 'u-hr', username: 'hr.one', role: 'hr' };
function fixture() { const store = new Store(':memory:'); store.write(completeState()); return store; }

test('employment view: status, compensation, work and records come straight from the HR records and follow every HR change', () => {
  const store = fixture();
  try {
    saveProfile(store, hr, 'EMP-001', 'employment', { position: 'Analyst', employmentStatus: 'Probationary', employmentType: 'Full-Time', employeeStatus: 'Active', supervisor: 'Ana Head', workLocation: 'Makati HQ', contractStart: '2026-01-01', contractEnd: '2026-06-30' });
    saveAllowance(store, hr, { employeeId: 'EMP-001', type: 'Rice allowance', amount: 1500, frequency: 'Monthly', effectiveDate: '2026-01-01', status: 'Active' });
    let v = myEmployment(store, employee);
    assert.equal(v.status.classification, 'Probationary'); assert.equal(v.status.status, 'Active');
    assert.equal(v.work.position, 'Analyst'); assert.equal(v.work.supervisor, 'Ana Head'); assert.equal(v.work.workLocation, 'Makati HQ');
    assert.ok(Array.isArray(v.work.workingDays) && Array.isArray(v.work.restDays));
    assert.equal(v.compensation.allowances[0].type, 'Rice allowance');
    assert.equal(v.records.contract.end, '2026-06-30');
    assert.ok(v.lastUpdated, 'shows when it was last updated'); assert.equal(v.lastUpdatedBy, 'hr.one');
    assert.ok(v.changes.some(c => c.changes.some(x => x.field === 'Position' && x.to === 'Analyst')));

    // A regularization approved by a second HR manager shows at once, with its history.
    const m = requestMovement(store, hr, { employeeId: 'EMP-001', type: 'regularization', effectiveDate: '2026-07-01', reason: 'Passed the probation review', classification: 'Regular' });
    assert.equal(myEmployment(store, employee).status.classification, 'Probationary', 'pending changes do not show');
    decideMovement(store, admin, m.id, { decision: 'approve' });
    v = myEmployment(store, employee);
    assert.equal(v.status.classification, 'Regular'); assert.equal(v.status.regularizationDate, '2026-07-01');
    assert.equal(v.records.movements[0].type, 'Regularization');

    // An approved salary change: new basic salary, its effective date and the salary history.
    const before = v.compensation.basicSalary;
    const c = requestSalaryChange(store, hr, { employeeId: 'EMP-001', monthlySalary: (before || 20000) + 2000, effectiveDate: '2026-08-01', reason: 'Annual increase after review' });
    decideSalaryChange(store, admin, c.id, { decision: 'approve' });
    v = myEmployment(store, employee);
    assert.equal(v.compensation.basicSalary, (before || 20000) + 2000); assert.equal(v.compensation.effectiveDate, '2026-08-01');
    assert.equal(v.records.salaryHistory.length, 1);
    assert.ok(v.changes.some(x => x.changes.some(y => y.field === 'Basic salary')), 'the change log records the salary change');
  } finally { store.close(); }
});

test('employment view: employees only, their own record, nothing to edit', () => {
  const store = fixture();
  try {
    assert.throws(() => myEmployment(store, hr), /Only employees/);
    assert.throws(() => myEmployment(store, admin), /Only employees/);
    assert.equal(myEmployment(store, employee).employeeId, 'EMP-001');
    assert.throws(() => myEmployment(store, { ...employee, employeeId: 'EMP-404' }), /not found/i);
    assert.throws(() => saveProfile(store, employee, 'EMP-001', 'employment', { position: 'CEO' }), /cannot edit/);
  } finally { store.close(); }
});
