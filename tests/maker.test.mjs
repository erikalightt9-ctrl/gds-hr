import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { saveRecord } from '../src/service.mjs';
import { visibleAudit, auditChanges, canReadSection, canWriteSection } from '../src/profiles.mjs';
import { profileExtras, employeeForm } from '../src/hr201.mjs';
import { employeeChecklist } from '../src/documents201.mjs';
import { availableReports, buildReport } from '../src/reports.mjs';
import { userSchema } from '../src/schema.mjs';
import { completeState, admin } from './helpers.mjs';
import { requestSalaryChange, approveSalaryChange } from '../src/salary-changes.mjs';

const maker = { username: 'maker1', role: 'maker' }, staff = { username: 'staff1', role: 'hr_staff' };
function fixture() { const store = new Store(':memory:'); store.write(completeState()); return store; }

test('a Maker manages non-salary records but never sees pay', () => {
  const store = fixture();
  try {
    assert.ok(userSchema.safeParse({ username: 'maker1', password: 'long-enough-password', role: 'maker' }).success);
    for (const s of ['personal', 'employment', 'emergency', 'family', 'education', 'history', 'government']) assert.ok(canReadSection(maker, s), s);
    for (const s of ['payroll', 'bank', 'contributions']) { assert.ok(!canReadSection(maker, s), s); assert.ok(!canWriteSection(maker, s), s); }
    const extras = profileExtras(store, maker, 'EMP-001');
    assert.equal(extras.compensation, null, 'no compensation tab'); assert.equal(extras.canEdit, true); assert.equal(extras.canEditPay, false);
    const form = employeeForm(store, maker, 'EMP-001');
    assert.equal(form.canEdit, true); assert.equal(form.sensitiveIds, true, 'government IDs are not salary');
    assert.ok(!JSON.stringify(form).includes('30000'), 'the 201 form carries no salary');
  } finally { store.close(); }
});

test('salary-bearing documents are hidden from a Maker; other restricted documents are not', () => {
  const store = fixture();
  try {
    const items = employeeChecklist(store, maker, 'EMP-001').items, by = id => items.find(i => i.requirement.id === id);
    assert.equal(by('contract').hidden, true, 'employment contract states pay');
    assert.equal(by('medical').hidden, false, 'restricted but not salary');
    assert.equal(employeeChecklist(store, staff, 'EMP-001').items.find(i => i.requirement.id === 'medical').hidden, true, 'HR Staff still cannot see restricted files');
  } finally { store.close(); }
});

test('reports and exports exclude pay for a Maker', () => {
  const store = fixture();
  try {
    const keys = availableReports(maker).map(r => r.key);
    assert.ok(keys.includes('audit'));
    for (const k of ['payroll', 'thirteenth', 'loans', 'deductions']) { assert.ok(!keys.includes(k), k); assert.throws(() => buildReport(store, maker, k, 'xlsx'), /cannot download|not found/i, k); }
  } finally { store.close(); }
});

test('every change is audited with previous and updated values; salary is stripped for a Maker; the trail cannot be edited or deleted', () => {
  const store = fixture();
  try {
    const e = store.read().employees[0];
    store.db.prepare('INSERT INTO users(id, username, password_hash, role, display_name) VALUES(?,?,?,?,?)').run('pay-1', 'pay1', 'x:00', 'payroll', 'Payroll Officer');
    saveRecord(store, admin, 'employees', { ...e, department: 'Finance' });
    const pending = requestSalaryChange(store, admin, { employeeId: e.id, effectiveDate: '2026-09-01', reason: 'Annual adjustment (demo)', approverUserId: 'pay-1', monthlySalary: 35000 });
    assert.equal(store.read().employees.find(x => x.id === e.id).monthlySalary, 30000, 'the current salary waits for the second approver');
    approveSalaryChange(store, { id: 'pay-1', username: 'pay1', role: 'payroll', displayName: 'Payroll Officer' }, pending.id);
    store.log(admin, 'post', 'runs', 'run-1', null, { net: 12345 });
    const full = visibleAudit(store, admin).filter(a => a.kind === 'employees');
    assert.ok(full.some(a => auditChanges(a).some(c => c.field === 'department')));
    assert.ok(full.some(a => auditChanges(a).some(c => c.field === 'monthlySalary' && c.after === '35000')));
    const seen = visibleAudit(store, maker);
    assert.ok(!seen.some(a => a.kind === 'runs'), 'payroll events are not shown');
    const mine = seen.find(a => a.kind === 'employees' && auditChanges(a).some(c => c.field === 'department'));
    assert.equal(mine.actor, 'admin'); assert.equal(mine.recordId, 'EMP-001'); assert.ok(mine.at);
    assert.deepEqual(auditChanges(mine).find(x => x.field === 'department'), { field: 'department', before: 'Operations', after: 'Finance' });
    assert.ok(!auditChanges(mine).some(x => x.field === 'monthlySalary'));
    assert.ok(!JSON.stringify(seen).includes('35000') && !JSON.stringify(seen).includes('monthlySalary'));
    const report = buildReport(store, maker, 'audit', 'xlsx');
    assert.ok(report.body.length > 0);
    assert.throws(() => store.db.prepare('DELETE FROM audit').run(), /cannot be deleted/);
    assert.throws(() => store.db.prepare("UPDATE audit SET actor='someone'").run(), /cannot be edited/);
  } finally { store.close(); }
});
