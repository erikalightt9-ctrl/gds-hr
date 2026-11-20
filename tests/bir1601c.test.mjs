import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { month1601c, year1601c, saveRow, saveReturn, fileReturn, reopenReturn, items, dueDate } from '../src/bir1601c.mjs';
import { export1601c } from '../src/bir1601c-export.mjs';
import { readSpreadsheet } from '../src/xlsx-read.mjs';
import { buildReport } from '../src/reports.mjs';

const payroll = { username: 'pay', role: 'payroll' }, viewer = { username: 'mgmt', role: 'viewer' }, staff = { username: 'staff', role: 'hr_staff' };
function fixture() { const store = new Store(':memory:'); store.write(completeState()); return store; }
// Unzipped XML of one part of a workbook written by export.mjs (stored, not compressed).
const part = (buffer, name) => { const i = buffer.indexOf(Buffer.from(`${name}<?xml`)); return i < 0 ? '' : buffer.subarray(i + name.length, buffer.indexOf(Buffer.from('PK'), i + name.length)).toString(); };

test('1601-C: monthly rows from payroll, items 14-36, typed figures with a reason, roles', () => {
  const store = fixture();
  try {
    const sept = month1601c(store, payroll, '2026-09');
    const row = sept.rows.find(r => r.employeeId === 'EMP-001');
    assert.ok(row.compensation > 0, 'compensation from the September cutoffs');
    assert.equal(row.nonTaxable, Math.round((row.mweBasic + row.mwePremiums + row.thirteenth + row.deMinimis + row.contributions + row.otherNonTaxable) * 100) / 100);
    assert.equal(sept.items[22], Math.round((sept.items[14] - sept.items[21]) * 100) / 100);
    assert.equal(sept.dueDate, '2026-10-10'); assert.equal(dueDate('2026-12'), '2027-01-15'); assert.equal(dueDate('2026-09', 'A'), '2026-10-15');
    assert.throws(() => saveRow(store, payroll, { employeeId: 'EMP-001', month: '2026-09', values: { deMinimis: 1500 } }), /reason/);
    saveRow(store, payroll, { employeeId: 'EMP-001', month: '2026-09', values: { deMinimis: 1500, taxWithheld: 250 }, reason: 'Rice subsidy paid outside payroll' });
    const edited = month1601c(store, payroll, '2026-09').rows.find(r => r.employeeId === 'EMP-001');
    assert.equal(edited.deMinimis, 1500); assert.equal(edited.taxWithheld, 250); assert.equal(edited.computed.deMinimis, 0); assert.equal(edited.edited.reason, 'Rice subsidy paid outside payroll');
    assert.equal(month1601c(store, payroll, '2026-08').rows.find(r => r.employeeId === 'EMP-001')?.deMinimis ?? 0, 0, 'other months unchanged');
    assert.throws(() => saveRow(store, viewer, { employeeId: 'EMP-001', month: '2026-09', values: {} }), /permission/);
    assert.throws(() => month1601c(store, staff, '2026-09'), /permission/);
    const i = items([{ compensation: 1000, mweBasic: 0, mwePremiums: 0, thirteenth: 100, deMinimis: 0, contributions: 50, otherNonTaxable: 0, notSubject: 200, taxWithheld: 30 }], { adjustment: 5, adjustmentSign: 'less', surcharge: 10, amended: true, previouslyRemitted: 20 });
    assert.deepEqual([i[21], i[22], i[24], i[26], i[27], i[30], i[31], i[35], i[36]], [150, 850, 650, -5, 25, 20, 5, 10, 15]);
  } finally { store.close(); }
});

test('1601-C: filing freezes the figures, reopening is admin only with a reason, monitoring by year, audited', () => {
  const store = fixture();
  try {
    assert.throws(() => saveReturn(store, payroll, { month: '2026-09', previouslyRemitted: 100 }), /amended/);
    saveReturn(store, payroll, { month: '2026-09', surcharge: 25, agent: { tin: '123-456-789-000', rdo: '050', name: 'GDS CAPITAL INC.', address: 'Makati City', zip: '1223', contact: '0273680000', email: '', category: 'Private', efpsGroup: '' } });
    assert.throws(() => fileReturn(store, payroll, { month: '2026-09', filedOn: '2026-10-09', confirmationNo: '' }), /filing reference/);
    const filed = fileReturn(store, payroll, { month: '2026-09', filedOn: '2026-10-09', confirmationNo: 'EBF-0001' });
    assert.equal(filed.snapshot.items[32], 25);
    assert.throws(() => saveRow(store, payroll, { employeeId: 'EMP-001', month: '2026-09', values: { deMinimis: 1 }, reason: 'late change' }), /already filed/);
    const s = store.read(); s.employees[0] = { ...s.employees[0], monthlySalary: 90000 }; store.write(s);
    assert.equal(month1601c(store, payroll, '2026-09').items[14], filed.snapshot.items[14], 'filed figures do not move when payroll changes');
    const sept = year1601c(store, viewer, '2026').months[8];
    assert.equal(sept.status, 'filed'); assert.equal(sept.confirmationNo, 'EBF-0001');
    assert.throws(() => reopenReturn(store, payroll, { month: '2026-09', reason: 'Amended return' }), /permission/);
    assert.throws(() => reopenReturn(store, admin, { month: '2026-09', reason: '' }), /reason/);
    const reopened = reopenReturn(store, admin, { month: '2026-09', reason: 'Amended return for a missed employee' });
    assert.equal(reopened.status, 'draft'); assert.equal(reopened.previousFilings[0].confirmationNo, 'EBF-0001');
    const logged = store.audit().filter(a => a.kind === 'bir1601c').map(a => a.action);
    for (const a of ['reopen-1601c', 'file-1601c', 'update-1601c-return', 'update-1601c-agent']) assert.ok(logged.includes(a), a);
  } finally { store.close(); }
});

test('1601-C Excel: return sheet with live formulas over the employee sheet, filters and totals; readable workbook', () => {
  const store = fixture();
  try {
    const file = export1601c(store, payroll, '2026-09');
    assert.match(file.filename, /bir-1601c-2026-09\.xlsx$/);
    const sheets = readSpreadsheet(file.filename, file.body);
    assert.deepEqual(sheets.map(s => s.name), ['1601-C 2026-09', 'Employee details', 'Year 2026']);
    const xml1 = part(file.body, 'xl/worksheets/sheet1.xml'), xml2 = part(file.body, 'xl/worksheets/sheet2.xml');
    assert.match(xml1, /<f>&apos;Employee details&apos;!D\d+<\/f>|<f>'Employee details'!D\d+<\/f>/, 'item 14 refers to the employee total');
    assert.match(xml1, /<f>SUM\(C\d+:C\d+\)<\/f>/, 'item 21 sums items 15-20');
    assert.match(xml2, /<autoFilter ref="A4:P\d+"\/>/); assert.match(xml2, /<f>SUM\(E5:J5\)<\/f>/); assert.match(xml2, /<f>SUM\(D5:D\d+\)<\/f>/);
    assert.ok(part(file.body, 'xl/styles.xml').includes('numFmtId="4"'));
    assert.equal(buildReport(store, payroll, 'bir-1601c', 'pdf', { month: '2026-09' }).body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(store.audit().some(a => a.action === 'export' && a.recordId === 'bir-1601c'));
  } finally { store.close(); }
});
