import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll } from '../src/service.mjs';
import { birReturn, birYear, saveBirReturn, refreshFromPayroll, fileBirReturn, reopenBirReturn, birMonthWorkbook, birYearWorkbook, dueDate, computeItems } from '../src/bir1601c.mjs';
import { readSpreadsheet } from '../src/xlsx-read.mjs';
import { completeState, admin } from './helpers.mjs';

const payroll = { username: 'pay1', role: 'payroll' }, viewer = { username: 'mgmt', role: 'viewer' }, staff = { username: 'staff', role: 'hr_staff' };
function fixture() {
  const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s);
  const run = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
  postPayroll(store, admin, { start: run.start, end: run.end, pay13th: false, fingerprint: run.fingerprint, employeeIds: ['EMP-001'] });
  return { store, row: run.rows[0] };
}
const asInput = r => ({ header: { ...r.header, tin: '123-456-789-000', rdoCode: '050' }, lines: r.lines, amounts: r.amounts || {}, filing: r.filing || {} });

test('due dates: the 10th of the following month, December on January 15', () => {
  assert.equal(dueDate('2026-09'), '2026-10-10');
  assert.equal(dueDate('2026-12'), '2027-01-15');
});

test('a month starts as a preview built from posted payroll, with items 14-36', () => {
  const { store, row } = fixture();
  try {
    const r = birReturn(store, viewer, '2026-09');
    assert.equal(r.saved, false); assert.equal(r.status, 'not started'); assert.equal(r.canEdit, false, 'Management reads only');
    assert.equal(r.lines.length, 1);
    const l = r.lines[0];
    assert.equal(l.gross, row.gross); assert.equal(l.taxWithheld, row.deductions.tax);
    assert.equal(l.contributions, Math.round((row.deductions.SSS + row.deductions.PhilHealth + row.deductions['Pag-IBIG']) * 100) / 100);
    assert.equal(r.items[14], row.gross);
    assert.equal(r.items[21], l.contributions + l.thirteenth);
    assert.equal(r.items[22], Math.max(0, Math.round((row.gross - r.items[21]) * 100) / 100));
    assert.equal(r.items[36], r.items[25], 'no adjustments or penalties');
    assert.equal(birReturn(store, admin, '2026-10').lines.length, 0, 'no payroll in October');
    assert.throws(() => birReturn(store, staff, '2026-09'), /permission/);
    assert.throws(() => birReturn(store, admin, '2026-13'), /taxable month/);
  } finally { store.close(); }
});

test('encode, edit, file (locked), reopen as amended; every step audited', () => {
  const { store } = fixture();
  try {
    const preview1 = birReturn(store, payroll, '2026-09'), input = asInput(preview1);
    input.lines[0].deMinimis = 500;
    input.lines.push({ employeeId: 'EMP-X', name: 'Encoded Person', tin: '', gross: 10000, mweBasic: 0, mweOther: 0, thirteenth: 0, deMinimis: 0, contributions: 0, otherNonTaxable: 0, notSubject: 0, taxWithheld: 250 });
    input.amounts.surcharge = 100;
    const saved = saveBirReturn(store, payroll, '2026-09', input);
    assert.equal(saved.status, 'draft'); assert.equal(saved.lines.find(l => l.employeeId === 'EMP-001').edited, true);
    assert.equal(saved.lines.find(l => l.employeeId === 'EMP-X').source, 'manual');
    assert.equal(saved.items[18], 500); assert.equal(saved.items[35], 100); assert.equal(saved.items[36], saved.items[25] + 100);
    assert.equal(saved.reconciliation.differenceTax, 250, 'encoded tax differs from payroll');
    assert.throws(() => saveBirReturn(store, payroll, '2026-09', { ...input, lines: [...input.lines, input.lines[0]] }), /only once/);
    assert.throws(() => saveBirReturn(store, viewer, '2026-09', input), /permission/);
    assert.throws(() => fileBirReturn(store, payroll, '2026-09', { dateFiled: '2026-10-09', referenceNo: '' }), /reference/);
    const filed = fileBirReturn(store, payroll, '2026-09', { dateFiled: '2026-10-09', referenceNo: 'EFPS-0001', amountPaid: saved.items[36] });
    assert.equal(filed.status, 'filed'); assert.equal(filed.canEdit, false); assert.equal(filed.overdue, false);
    assert.throws(() => saveBirReturn(store, payroll, '2026-09', input), /locked/);
    assert.throws(() => refreshFromPayroll(store, payroll, '2026-09'), /locked/);
    assert.throws(() => reopenBirReturn(store, payroll, '2026-09', { reason: 'Amended return' }), /permission/);
    const reopened = reopenBirReturn(store, admin, '2026-09', { reason: 'Amended return for de minimis' });
    assert.equal(reopened.status, 'draft'); assert.equal(reopened.header.amended, true);
    assert.equal(reopened.items[28], filed.items[27], 'tax remitted on the original return carries to item 28');
    assert.equal(reopened.items[31], 0, 'nothing more due unless the amendment changes the tax');
    const refreshed = refreshFromPayroll(store, payroll, '2026-09');
    assert.equal(refreshed.lines.length, 1); assert.equal(refreshed.lines[0].edited, false);
    const audit = store.db.prepare("SELECT action FROM audit WHERE kind='bir-1601c'").all().map(r => r.action);
    for (const a of ['create', 'file', 'reopen', 'update']) assert.ok(audit.includes(a), a);
  } finally { store.close(); }
});

test('year monitoring and Excel exports with formulas', () => {
  const { store } = fixture();
  try {
    const y = birYear(store, viewer, '2026');
    assert.equal(y.months.length, 12);
    const sep = y.months[8];
    assert.equal(sep.month, '2026-09'); assert.ok(sep.employees === 1 && sep.taxWithheld >= 0);
    assert.equal(y.months[0].employees, 0); assert.equal(y.months[0].overdue, false, 'an empty month is not overdue');
    const month = birMonthWorkbook(store, admin, '2026-09'), sheets = readSpreadsheet(month.filename, month.body);
    assert.deepEqual(sheets.map(s => s.name), ['Employees', 'Return items']);
    assert.equal(sheets[0].rows[3][2], 'Employee name'); assert.equal(sheets[0].rows[4][1], 'EMP-001');
    assert.match(month.body.toString('latin1'), /SUM\(F5:K5\)/);
    assert.equal(sheets[1].rows[3][0], 14);
    const year = birYearWorkbook(store, admin, '2026'), ys = readSpreadsheet(year.filename, year.body);
    assert.deepEqual(ys.map(s => s.name), ['Summary 2026', 'September']);
    assert.equal(ys[0].rows.length, 16);
    assert.ok(computeItems({ lines: [], amounts: {} })[36] === 0);
  } finally { store.close(); }
});
