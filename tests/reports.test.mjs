import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { REPORTS, availableReports, buildReport, payrollRunPdf } from '../src/reports.mjs';
import { tablePdf } from '../src/export.mjs';
import { saveProfile } from '../src/profiles.mjs';
import { preview } from '../src/service.mjs';

const viewer = { username: 'viewer', role: 'viewer' }, payroll = { username: 'pay', role: 'payroll' };
const worker = { id: 'w', username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
function fixture() {
  const store = new Store(':memory:');
  const state = completeState();
  state.employees.push({ ...state.employees[0], id: 'EMP-002', name: 'Pequeña, Niña' });
  store.write(state);
  saveProfile(store, admin, 'EMP-001', 'government', { sss: '34-0000000-1', tin: '123-456-789-000' });
  return store;
}

test('every report downloads as a real Excel workbook and PDF', () => {
  const store = fixture();
  try {
    for (const key of Object.keys(REPORTS).filter(k => !k.startsWith('my-'))) {
      const xlsx = buildReport(store, admin, key, 'xlsx'), pdf = buildReport(store, admin, key, 'pdf');
      assert.equal(xlsx.body.subarray(0, 2).toString(), 'PK', `${key} xlsx is a zip`);
      assert.match(xlsx.filename, new RegExp(`^gds-hr-${key}-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`));
      assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-', `${key} pdf header`);
      assert.match(pdf.body.toString('latin1'), /%%EOF$/);
    }
    assert.ok(buildReport(store, admin, 'attendance', 'xlsx').body.length > 500);
  } finally { store.close(); }
});

test('PDF text keeps Filipino letters, escapes PDF syntax and paginates long tables', () => {
  const rows = Array.from({ length: 120 }, (_, i) => [`EMP-${i}`, i === 0 ? 'Pequeña (Niña) \\ test' : 'Name', '₱1,000']);
  const pdf = tablePdf({ title: 'Test report', headers: ['ID', 'Name', 'Amount'], rows }).toString('latin1');
  assert.match(pdf, /Peque\\361a \\\(Ni\\361a\\\) \\\\ test/);
  assert.match(pdf, /PHP 1,000/);
  assert.ok((pdf.match(/\/Type \/Page /g) || []).length >= 3, 'multiple pages');
  assert.match(pdf, /Page 1 of \d/);
});

test('reports follow role permissions', () => {
  const store = fixture();
  try {
    const viewerKeys = availableReports(viewer).map(r => r.key);
    assert.ok(viewerKeys.includes('employees') && !viewerKeys.includes('government-ids') && !viewerKeys.includes('employee-details'));
    assert.throws(() => buildReport(store, viewer, 'government-ids', 'xlsx'), /cannot download/);
    assert.ok(availableReports(payroll).some(r => r.key === 'government-ids'));
    assert.ok(!availableReports(payroll).some(r => r.key === 'employee-details'));
    assert.throws(() => buildReport(store, admin, 'nope', 'pdf'), /not found/);
    assert.throws(() => buildReport(store, admin, 'employees', 'csv'), /not found/);
  } finally { store.close(); }
});

test('employees can only download their own records', () => {
  const store = fixture();
  try {
    assert.deepEqual(availableReports(worker).map(r => r.key), ['my-attendance', 'my-leaves']);
    assert.throws(() => buildReport(store, worker, 'employees', 'xlsx'), /cannot download/);
    const state = store.read();
    const rows = REPORTS['my-attendance'].rows(state, store, worker);
    assert.equal(rows.length, state.attendance.filter(a => a.employeeId === 'EMP-001').length);
    state.attendance.push({ ...state.attendance[0], id: 'other', employeeId: 'EMP-002' }); store.write(state);
    assert.equal(REPORTS['my-attendance'].rows(store.read(), store, worker).length, rows.length, 'other employees excluded');
  } finally { store.close(); }
});

test('payroll register PDF includes totals', () => {
  const store = fixture();
  try {
    const run = preview(store, '2026-09-01', '2026-09-15');
    const pdf = payrollRunPdf(run).toString('latin1');
    assert.match(pdf, /^%PDF-/);
    assert.match(pdf, /TOTAL/);
  } finally { store.close(); }
});
