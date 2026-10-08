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
      assert.match(xlsx.filename, key === 'gov-contributions' ? /^gds-hr-government-contributions-\d{4}-\d{2}\.xlsx$/ : new RegExp(`^gds-hr-${key}-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`));
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

test('monthly government contributions report sums both cutoffs; the summary adds the eGov fee', async () => {
  const { monthlyContributions, contributionRows } = await import('../src/contribution-report.mjs');
  const store = fixture();
  try {
    const report = monthlyContributions(store, '2026-09');
    assert.ok(report.people.length >= 1);
    const p = report.people[0];
    assert.equal(p.deductions, Math.round((p.sssEE + p.phEE + p.piEE + p.sssLoan + p.piLoan) * 100) / 100);
    const all = contributionRows(report, 15), last = all.find(r => r[1] === 'TOTAL REMITTANCE');
    assert.equal(all.at(-1)[1], 'TOTAL EMPLOYER SHARE');
    assert.equal(all.at(-1).at(-1), report.employer.total, 'employer share section');
    assert.equal(last[1], 'TOTAL REMITTANCE');
    assert.ok(!JSON.stringify(all).includes('34-0000000-1'), 'employee government numbers are not in the report');
    assert.equal(last.at(-1), Math.round((report.totals.sss + report.totals.ph + report.totals.pi + report.totals.sssLoan + report.totals.piLoan + 15) * 100) / 100);
  } finally { store.close(); }
});

test("'Remittance only' employees (e.g. the CEO) are left out of payroll but their full monthly contributions are in the report", async () => {
  const { monthlyContributions } = await import('../src/contribution-report.mjs');
  const { calculatePayroll } = await import('../src/engine.mjs');
  const store = fixture();
  try {
    const normal = monthlyContributions(store, '2026-09').people.find(x => x.employeeId === 'EMP-002');
    saveProfile(store, admin, 'EMP-002', 'payroll', { status: 'Remittance only' });
    const state = store.read();
    assert.ok(!calculatePayroll(state, '2026-09-01', '2026-09-15').rows.some(r => r.employeeId === 'EMP-002'), 'not in payroll');
    const p = monthlyContributions(store, '2026-09').people.find(x => x.employeeId === 'EMP-002');
    assert.ok(p, 'still in the remittance report');
    assert.equal(p.sssBasis, state.employees.find(e => e.id === 'EMP-002').monthlySalary);
    assert.equal(p.sssEE + p.phEE + p.piEE, normal.sssEE + normal.phEE + normal.piEE, 'same monthly shares as when paid through payroll');
  } finally { store.close(); }
});

test('a recorded remittance month is shown exactly as the sheet (former employees, cash loans; remittance = contributions + eGov fee)', async () => {
  const { saveRecordedMonth } = await import('../src/contribution-history.mjs');
  const { monthlyContributions, remittanceSummary } = await import('../src/contribution-report.mjs');
  const store = fixture();
  try {
    saveRecordedMonth(store, admin, { month: '2026-01', fee: 15, rows: [
      { name: 'Former, Person', compensation: 9082, sssER: 910, sssEE: 450, phBasis: 22000, phER: 550, phEE: 550, piER: 200, piEE: 200, deductions: 1200 },
      { name: 'Alejo, Debralyn', employeeId: 'EMP-001', compensation: 18070, sssER: 1830, sssEE: 900, phBasis: 18070, phER: 451.75, phEE: 451.75, piER: 200, piEE: 200, piLoan: 239, cashLoan: 1000, deductions: 2790.75 },
    ] });
    const r = monthlyContributions(store, '2026-01');
    assert.equal(r.recorded, true); assert.equal(r.people.length, 2);
    assert.equal(r.totals.sss, 4090); assert.equal(r.totals.cashLoan, 1000);
    assert.equal(remittanceSummary(r, 99).total, Math.round((4090 + 2003.5 + 800 + 15) * 100) / 100, 'loans not added; the recorded fee is used');
  } finally { store.close(); }
});
