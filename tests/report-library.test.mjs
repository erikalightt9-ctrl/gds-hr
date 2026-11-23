import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { workbook } from '../src/export.mjs';
import { uploadReport, uploadVersion, updateReportInfo, listLibrary, downloadReport } from '../src/report-library.mjs';
import { buildReport, availableReports } from '../src/reports.mjs';
import { readSpreadsheet } from '../src/xlsx-read.mjs';

const hr = { username: 'hr1', role: 'hr' }, staff = { username: 'staff', role: 'hr_staff' }, payroll = { username: 'pay', role: 'payroll' }, viewer = { username: 'mgmt', role: 'viewer' };
function fixture() { const store = new Store(':memory:'); store.write(completeState()); return store; }
const xlsx = rows => workbook({ Sheet1: rows }).toString('base64');

test('report library: upload, versions, access levels, archive and download, all audited', () => {
  const store = fixture();
  try {
    assert.throws(() => uploadReport(store, staff, { title: 'Payroll accrual', category: 'Accounting', access: 'pay', fileName: 'accrual.xlsx', data: xlsx([['a']]) }), /access level that includes your own role/);
    assert.throws(() => uploadReport(store, payroll, { title: 'Broken', category: 'Accounting', access: 'pay', fileName: 'x.xlsx', data: Buffer.from('not a workbook').toString('base64') }), /Upload an Excel workbook|could not be read/);
    const f = uploadReport(store, payroll, { title: 'Payroll accrual', category: 'Accounting', access: 'pay', fileName: 'accrual.xlsx', data: xlsx([['Month', 'Amount'], ['Oct', 100]]) });
    assert.deepEqual(f.versions[0].sheets, [{ name: 'Sheet1', rows: 2, columns: 2 }]);
    assert.throws(() => uploadVersion(store, payroll, f.id, { fileName: 'accrual.xlsx', data: xlsx([['x']]), note: '' }), /what changed/);
    uploadVersion(store, payroll, f.id, { fileName: 'accrual-v2.csv', data: Buffer.from('Month,Amount\nOct,120\n').toString('base64'), note: 'October corrected' });
    assert.equal(listLibrary(store, staff).files.length, 0, 'HR staff cannot see pay files');
    assert.throws(() => downloadReport(store, staff, f.id), /not found/i);
    assert.equal(listLibrary(store, hr).files[0].versions.length, 2);
    assert.equal(downloadReport(store, hr, f.id).type, 'text/csv');
    assert.equal(readSpreadsheet('a.xlsx', downloadReport(store, hr, f.id, 1).body)[0].rows[1][1], 100, 'earlier version kept');
    updateReportInfo(store, hr, f.id, { title: 'Payroll accrual 2026', category: 'Accounting', access: 'pay', description: '', archived: true });
    assert.throws(() => uploadVersion(store, hr, f.id, { fileName: 'a.xlsx', data: xlsx([['x']]), note: 'again' }), /Restore/);
    assert.throws(() => listLibrary(store, { username: 'e', role: 'employee' }), /permission/);
    assert.deepEqual(store.audit().filter(a => a.kind === 'report-library').map(a => a.action).sort(), ['archive', 'download', 'download', 'upload', 'upload-version']);
  } finally { store.close(); }
});

test('Excel templates: role-limited, with filters, frozen headings, SUM totals and formula columns', () => {
  const store = fixture();
  try {
    const keys = availableReports(admin).filter(r => r.template).map(r => r.key);
    for (const k of ['payroll-cost', 'attendance-summary', 'headcount', 'bir-1601c', 'discipline-cases', 'discipline-records']) assert.ok(keys.includes(k), k);
    assert.ok(!availableReports(staff).some(r => r.key === 'payroll-cost'), 'pay template hidden from HR staff');
    assert.ok(!availableReports(viewer).some(r => r.key === 'payroll-cost'));
    const att = buildReport(store, admin, 'attendance-summary', 'xlsx', { month: '2026-09' }), sheet = att.body.toString('latin1');
    assert.match(sheet, /<autoFilter ref="A4:J\d+"\/>/); assert.match(sheet, /<pane ySplit="4"/); assert.match(sheet, /<f>SUM\(D5:D\d+\)<\/f>/); assert.match(sheet, /<f>IF\(E5=0,0,\(E5-G5\)\/E5\)<\/f>/);
    const head = buildReport(store, admin, 'headcount', 'xlsx');
    assert.deepEqual(readSpreadsheet('h.xlsx', head.body).map(s => s.name), ['Headcount by department', 'Summary']);
    assert.match(head.body.toString('latin1'), /COUNTIFS\(/);
    const leave = buildReport(store, admin, 'leave-balances', 'xlsx').body.toString('latin1');
    assert.match(leave, /<f>IF\(D5\+E5=0,0,ROUND\(F5\/\(D5\+E5\),4\)\)<\/f>/, 'utilization stays a live formula');
    const loans = buildReport(store, admin, 'loans', 'pdf');
    assert.equal(loans.body.subarray(0, 5).toString(), '%PDF-');
    assert.match(buildReport(store, admin, 'loans', 'xlsx').body.toString('latin1'), /<f>SUM\(F5:F\d+\)<\/f>/);
  } finally { store.close(); }
});
