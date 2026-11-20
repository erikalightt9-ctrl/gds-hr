import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { postPayroll, preview, saveRecord } from '../src/service.mjs';
import { approveSalaryChange, requestSalaryChange } from '../src/salary-changes.mjs';
import { completeState, admin } from './helpers.mjs';
import { profileExtras } from '../src/hr201.mjs';

const approver = { id: 'pay-1', username: 'pay1', role: 'payroll', displayName: 'Payroll Officer' };
function ready() {
  const store = new Store(':memory:');
  store.write(completeState());
  store.db.prepare('INSERT INTO users(id, username, password_hash, role, display_name) VALUES(?,?,?,?,?)').run(admin.id, admin.username, 'x:00', admin.role, 'Erika Hernando');
  store.db.prepare('INSERT INTO users(id, username, password_hash, role, display_name) VALUES(?,?,?,?,?)').run(approver.id, approver.username, 'x:00', approver.role, approver.displayName);
  return store;
}
const ask = (store, extra = {}) => requestSalaryChange(store, admin, { employeeId: 'EMP-001', effectiveDate: '2026-10-01', reason: 'Promotion increment (demo)', approverUserId: approver.id, monthlySalary: 40000, ...extra });

test('a salary edit waits for a different approver and keeps the previous amount', () => {
  const store = ready();
  try {
    const employee = store.read().employees[0];
    assert.throws(() => ask(store, { reason: '' }), /reason/);
    assert.throws(() => ask(store, { effectiveDate: '' }), /effective|date/i);
    assert.throws(() => ask(store, { approverUserId: '' }), /approver|expected string/i);
    assert.throws(() => requestSalaryChange(store, admin, { employeeId: 'EMP-001', effectiveDate: '2026-10-01', reason: 'Self approval (demo)', approverUserId: admin.id, monthlySalary: 40000 }), /different person/);
    assert.throws(() => saveRecord(store, admin, 'employees', { ...employee, monthlySalary: 40000 }), /second approver/);
    const pending = ask(store);
    assert.equal(store.read().employees[0].monthlySalary, 30000);
    assert.throws(() => approveSalaryChange(store, admin, pending.id), /second approver|cannot approve/);
    const approved = approveSalaryChange(store, approver, pending.id);
    assert.equal(approved.changes.monthlySalary.previous, 30000);
    assert.equal(approved.changes.monthlySalary.next, 40000);
    assert.equal(approved.approvedBy, 'Payroll Officer');
    assert.ok(approved.approvedAt);
    const history = profileExtras(store, admin, 'EMP-001').compensation.salaryHistory;
    assert.equal(history[0].changes.monthlySalary.previous, 30000);
    assert.equal(history[0].status, 'approved');
    const audit = store.audit().find(a => a.kind === 'salary-changes' && a.action === 'approve');
    assert.equal(audit.actorName, 'Payroll Officer');
    assert.equal(audit.after.changes.monthlySalary.previous, 30000);
  } finally { store.close(); }
});

test('payroll uses the salary in effect on the cutoff and does not rewrite a finalized run', () => {
  const store = ready();
  try {
    const before = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
    postPayroll(store, admin, { start: before.start, end: before.end, pay13th: false, fingerprint: before.fingerprint, employeeIds: ['EMP-001'] });
    const postedSalary = store.read().runs[0].rows[0].monthlySalary;
    const pending = ask(store, { effectiveDate: '2026-10-01', monthlySalary: 40000 });
    approveSalaryChange(store, approver, pending.id);
    assert.equal(store.read().runs[0].rows[0].monthlySalary, postedSalary, 'the finalized run is not recalculated');
    assert.equal(store.read().runs[0].rows[0].gross, before.rows[0].gross);
    assert.equal(preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).rows[0].monthlySalary, 30000, 'September ends before the effective date');
    const october = preview(store, '2026-10-01', '2026-10-15', false, ['EMP-001']).rows[0];
    assert.equal(october.monthlySalary, 40000);
    assert.match(october.trace.find(t => t.component === 'basic').formula, /40000/);
    const mid = ask(store, { effectiveDate: '2026-10-08', monthlySalary: 50000 });
    approveSalaryChange(store, approver, mid.id);
    const mixed = preview(store, '2026-10-01', '2026-10-15', false, ['EMP-001']).rows[0];
    assert.notEqual(mixed.earnings.basic, october.earnings.basic);
    const scaled = Math.round(october.earnings.basic * 50000 / 40000 * 100) / 100;
    assert.notEqual(mixed.earnings.basic, scaled, 'a mid-cutoff change is not a single rate for every day');
  } finally { store.close(); }
});
