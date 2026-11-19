import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll } from '../src/service.mjs';
import { TEMPLATES, templateList, buildTemplate, uploadReportFile, reportFiles, reportFileContent, removeReportFile } from '../src/excel-templates.mjs';
import { readSpreadsheet } from '../src/xlsx-read.mjs';
import { createCase } from '../src/discipline.mjs';
import { completeState, admin } from './helpers.mjs';

const hr = { username: 'hr1', role: 'hr' }, viewer = { username: 'mgmt', role: 'viewer' }, maker = { username: 'mk', role: 'maker' }, payroll = { username: 'pay', role: 'payroll' }, worker = { username: 'e', role: 'employee', employeeId: 'EMP-001' };
function fixture() {
  const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s);
  const run = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
  postPayroll(store, admin, { start: run.start, end: run.end, pay13th: false, fingerprint: run.fingerprint, employeeIds: ['EMP-001'] });
  createCase(store, hr, { employeeId: 'EMP-001', incidentDate: '2026-09-02', offense: 'Misconduct', description: 'A documented incident used for the register test.', reportedBy: 'Supervisor' });
  return store;
}

test('templates are listed by role; sensitive ones are hidden from roles that may not see pay or cases', () => {
  const store = fixture();
  try {
    const keys = actor => templateList(store, actor).map(t => t.key);
    assert.deepEqual(keys(admin).sort(), Object.keys(TEMPLATES).sort());
    assert.ok(!keys(maker).includes('payroll-journal') && !keys(maker).includes('disciplinary-register') && keys(maker).includes('employee-masterlist'), 'Maker: no pay, no cases');
    assert.ok(!keys(payroll).includes('disciplinary-register') && keys(payroll).includes('payroll-journal'));
    assert.ok(keys(viewer).includes('disciplinary-register') && !keys(viewer).includes('overtime-summary'));
    assert.equal(templateList(store, viewer).find(t => t.key === 'headcount-movement').canUpload, false, 'Management downloads only');
    assert.throws(() => buildTemplate(store, maker, 'payroll-journal'), /cannot open/);
    assert.throws(() => buildTemplate(store, worker, 'employee-masterlist'), /cannot open/);
    assert.throws(() => buildTemplate(store, admin, 'nope'), /not found/);
  } finally { store.close(); }
});

test('every template builds a workbook with a heading row, data and formulas', () => {
  const store = fixture();
  try {
    for (const key of Object.keys(TEMPLATES)) {
      const { filename, body } = buildTemplate(store, admin, key, { month: '2026-09', year: '2026' });
      assert.match(filename, /\.xlsx$/, key);
      const sheets = readSpreadsheet(filename, body);
      assert.ok(sheets.length >= 1 && sheets[0].rows.length >= 4, key);
    }
    const journal = buildTemplate(store, admin, 'payroll-journal', { month: '2026-09' }), xml = journal.body.toString('latin1');
    assert.match(xml, /SUMIF\(\$B\$5:\$B\$13,&quot;Debit&quot;/); assert.match(xml, /<autoFilter /);
    const rows = readSpreadsheet(journal.filename, journal.body)[0].rows;
    assert.equal(rows[3][2], '2026-09-01 to 2026-09-15'); assert.equal(rows[4][0], 'Salaries and wages expense');
    const register = readSpreadsheet('r.xlsx', buildTemplate(store, viewer, 'disciplinary-register', { year: '2026' }).body);
    assert.equal(register[0].rows[4][6], 'Misconduct'); assert.equal(register[1].name, 'By status');
    assert.ok(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='report-template'").get().n >= 5, 'downloads are audited');
  } finally { store.close(); }
});

test('maintained files: upload edited workbooks as versions, download, remove with a reason (kept on record)', () => {
  const store = fixture();
  try {
    const file = buildTemplate(store, hr, 'attendance-summary', { month: '2026-09' }).body.toString('base64');
    const v1 = uploadReportFile(store, hr, 'attendance-summary', { name: 'Attendance Sept 2026.xlsx', period: '2026-09', notes: 'Reviewed by HR', data: file });
    const v2 = uploadReportFile(store, hr, 'attendance-summary', { name: 'Attendance Sept 2026 v2.xlsx', period: '2026-09', data: file });
    assert.equal(v1.version, 1); assert.equal(v2.version, 2); assert.equal(v1.sheets[0].name, 'Attendance 2026-09');
    assert.throws(() => uploadReportFile(store, hr, 'attendance-summary', { name: 'notes.txt', period: '', data: file }), /\.xlsx/);
    assert.throws(() => uploadReportFile(store, hr, 'attendance-summary', { name: 'bad.xlsx', period: '', data: Buffer.from('not a workbook').toString('base64') }), /Excel|could not be read/);
    assert.throws(() => uploadReportFile(store, viewer, 'attendance-summary', { name: 'x.xlsx', data: file }), /permission/);
    assert.throws(() => uploadReportFile(store, maker, 'payroll-journal', { name: 'x.xlsx', data: file }), /cannot open/);
    assert.equal(reportFiles(store, viewer, 'attendance-summary').length, 2);
    assert.equal(reportFileContent(store, viewer, v1.id).meta.name, 'Attendance Sept 2026.xlsx');
    assert.throws(() => removeReportFile(store, hr, v1.id, { reason: '' }), /reason/);
    removeReportFile(store, hr, v1.id, { reason: 'Superseded by v2' });
    assert.throws(() => reportFileContent(store, hr, v1.id), /not found/);
    const list = reportFiles(store, hr, 'attendance-summary');
    assert.equal(list.find(f => f.id === v1.id).removed, true, 'removed files stay on record');
    assert.equal(templateList(store, hr).find(t => t.key === 'attendance-summary').files, 1);
  } finally { store.close(); }
});
