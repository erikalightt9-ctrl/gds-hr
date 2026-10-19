import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { saveRecord, deleteRecord, preview, postPayroll } from '../src/service.mjs';
import { payrollWorkbook } from '../src/export.mjs';
import { completeState, admin } from './helpers.mjs';

test('payroll posting persists atomic loan payment, snapshot and idempotent retry', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pdmn-hr-test-')), file = path.join(dir, 'test.sqlite');
  let db = new Store(file);
  try {
    db.write(completeState());
    const p = preview(db, '2026-09-01', '2026-09-15'); assert.deepEqual(p.blockers, []);
    assert.equal(p.rows[0].net, 13800);
    const request = { start: p.start, end: p.end, pay13th: false, fingerprint: p.fingerprint };
    const run = postPayroll(db, admin, request);
    assert.equal(db.read().loans[0].balance, 0);
    assert.equal(db.read().loans[0].remainingTerms, 0);
    assert.equal(run.sources.loans[0].balance, 1200);
    assert.equal(postPayroll(db, admin, request).id, run.id);
    assert.equal(db.read().runs.length, 1);
    const original = db.read().attendance[0];
    assert.throws(() => saveRecord(db, admin, 'attendance', { ...original, timeIn: '08:30' }), /locked/);
    assert.throws(() => deleteRecord(db, admin, 'attendance', original.id), /locked/);
    assert.throws(() => saveRecord(db, admin, 'loans', db.read().loans[0]), /immutable/);
    assert.ok(preview(db, p.start, p.end).blockers.some(b => b.includes('overlaps')));
    const fileData = payrollWorkbook(run);
    assert.equal(fileData.readUInt32LE(0), 0x04034b50);
    assert.ok(fileData.includes(Buffer.from('Employee ID')));
    assert.ok(fileData.includes(Buffer.from('EMP-001')));
    assert.ok(fileData.includes(Buffer.from('Calculation audit')));
    const snapshot = JSON.stringify(db.read().runs[0]);
    db.close(); db = new Store(file);
    assert.equal(JSON.stringify(db.read().runs[0]), snapshot);
    assert.equal(db.read().loans[0].balance, 0);
  } finally {
    db.close();
    // eslint-disable-next-line no-unsafe-finally -- refuse to delete anything outside the temp test folder
    if (path.dirname(path.resolve(dir)) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('pdmn-hr-test-')) throw new Error('Unsafe test cleanup path');
    rmSync(dir, { recursive: true });
  }
});
test('stale preview cannot overwrite changed inputs', () => {
  const db = new Store(':memory:'); db.write(completeState());
  const p = preview(db, '2026-09-01', '2026-09-15');
  saveRecord(db, admin, 'adjustments', { id: 'bonus', employeeId: 'EMP-001', date: '2026-09-01', kind: 'additional', amount: 500, reason: 'Approved bonus', approved: true, includedIn13th: false });
  assert.throws(() => postPayroll(db, admin, p), /changed/);
  assert.equal(db.read().loans[0].balance, 1200); db.close();
});
test('leave approval requires eligibility, documents, balance, non-overlap and no recorded work', () => {
  const db = new Store(':memory:'); db.write(completeState());
  const l = { id: 'leave1', employeeId: 'EMP-001', typeId: 'sil', startDate: '2026-09-16', endDate: '2026-09-16', days: 1, reason: 'Rest', documentReference: '', status: 'approved', eligibilityVerified: false };
  assert.throws(() => saveRecord(db, admin, 'leaves', l), /eligibility/);
  l.eligibilityVerified = true;
  assert.throws(() => saveRecord(db, admin, 'leaves', l), /document/);
  l.documentReference = 'HR-DOC-123'; saveRecord(db, admin, 'leaves', l);
  assert.throws(() => saveRecord(db, admin, 'leaves', { ...l, id: 'leave2' }), /overlap/);
  assert.throws(() => saveRecord(db, admin, 'leaves', { ...l, id: 'leave3', startDate: '2026-09-17', endDate: '2026-09-25', days: 7 }), /Insufficient/);
  assert.throws(() => saveRecord(db, admin, 'leaves', { ...l, id: 'leave4', startDate: '2026-09-01', endDate: '2026-09-01' }), /conflicts/);
  assert.equal(saveRecord(db, admin, 'leaves', { ...l, days: 2 }).days, 1, 'days are derived from the dates, not typed');
  deleteRecord(db, admin, 'leaves', l.id);
  assert.equal(db.read().leaves.length, 0); db.close();
});
test('leave with times: a half day counts 0.5, may sit beside the worked half; a whole day may not', () => {
  const db = new Store(':memory:'); db.write(completeState());
  const base = { employeeId: 'EMP-001', typeId: 'sil', days: 1, reason: 'Half day', documentReference: 'HR-DOC-1', status: 'approved', eligibilityVerified: true };
  const day = db.read().attendance[0].date;
  const half = saveRecord(db, admin, 'leaves', { ...base, id: 'half1', startDate: day, endDate: day, startTime: '14:00', endTime: '18:00' });
  assert.equal(half.days, 0.5); assert.deepEqual(half.partialDates, [day]);
  deleteRecord(db, admin, 'leaves', 'half1');
  assert.throws(() => saveRecord(db, admin, 'leaves', { ...base, id: 'whole2', startDate: day, endDate: day }), /conflicts with recorded work/);
  const two = saveRecord(db, admin, 'leaves', { ...base, id: 'two', startDate: '2026-09-16', endDate: '2026-09-17', startTime: '14:00', endTime: '18:00' });
  assert.equal(two.days, 1.5, 'afternoon of the first day + whole second day');
  const att = { ...db.read().attendance[0], id: 'am-half', date: '2026-09-16', timeIn: '08:00', timeOut: '12:00' };
  assert.equal(saveRecord(db, admin, 'attendance', att).date, '2026-09-16', 'the worked half can be recorded on a half-day leave date');
  assert.throws(() => saveRecord(db, admin, 'attendance', { ...att, id: 'full-leave-day', date: '2026-09-17' }), /conflicts with approved leave/);
  assert.throws(() => saveRecord(db, admin, 'leaves', { ...base, id: 'bad', startDate: '2026-09-18', endDate: '2026-09-18', startTime: '19:00', endTime: '20:00' }), /outside the work schedule/);
  db.close();
});
test('validation protects employee references, unique dates, breaks and immutable rules', () => {
  const db = new Store(':memory:'); db.write(completeState());
  const s = db.read(), a = s.attendance[0];
  assert.throws(() => saveRecord(db, admin, 'attendance', { ...a, id: 'duplicate' }), /already exists/);
  assert.throws(() => saveRecord(db, admin, 'attendance', { ...a, employeeId: 'missing' }), /does not exist/);
  assert.throws(() => saveRecord(db, admin, 'attendance', { ...a, breaks: [{ start: `${a.date}T07:00`, end: `${a.date}T08:00` }] }), /Breaks/);
  // Approved rules stay correctable until posted payroll uses them (locking is covered in employer-contributions.test.mjs).
  assert.doesNotThrow(() => saveRecord(db, admin, 'rules', s.rules[0]));
  assert.throws(() => saveRecord(db, admin, 'rules', { ...s.rules[0], id: 'duplicate' }), /effective date/);
  assert.throws(() => saveRecord(db, admin, 'loans', { ...s.loans[0], id: 'duplicate' }), /Duplicate/);
  assert.throws(() => deleteRecord(db, admin, 'employees', s.employees[0].id), /cannot be deleted/);
  assert.throws(() => deleteRecord(db, admin, 'holidays', 'missing'), /not found/);
  saveRecord(db, admin, 'holidays', { id: 'h1', date: '2026-09-17', name: 'Test', kind: 'regular', basis: 'test' });
  assert.throws(() => saveRecord(db, admin, 'holidays', { id: 'h2', date: '2026-09-17', name: 'Test', kind: 'regular', basis: 'test' }), /already exists/);
  saveRecord(db, admin, 'employees', { ...s.employees[0], name: 'Updated' });
  assert.equal(db.read().employees[0].name, 'Updated');
  const newRules = { ...s.rules[0], id: 'newrules', effectiveDate: '2026-10-01' };
  saveRecord(db, admin, 'rules', newRules);
  assert.equal(db.read().rules.at(-1).approvedBy, 'admin');
  const overlap = { ...s.rules[0], id: 'bad', effectiveDate: '2026-11-01', taxBrackets: [{ from: 0, to: null, fixed: 0, rate: 0, excessOver: 0 }, { from: 2, to: 10, fixed: 0, rate: 0, excessOver: 0 }] };
  assert.throws(() => saveRecord(db, admin, 'rules', overlap), /overlap/); db.close();
});
test('calendar-day leave crosses years and consumes annual balances by actual date', () => {
  const db = new Store(':memory:'); const s = completeState();
  const t = s.leaveTypes.find(t => t.id === 'vacation'); t.dayBasis = 'calendar'; t.entitledDays = 10;
  db.write(s);
  const leave = { id: 'cross-year', employeeId: 'EMP-001', typeId: 'vacation', startDate: '2026-12-30', endDate: '2027-01-03', days: 5, reason: 'Calendar test', documentReference: '', status: 'approved', eligibilityVerified: true };
  saveRecord(db, admin, 'leaves', leave);
  assert.equal(db.read().leaves[0].days, 5); db.close();
});
