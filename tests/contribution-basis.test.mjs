import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll } from '../src/service.mjs';
import { contributionReview, submitContributionChange, reviewContributionChange } from '../src/contribution-basis.mjs';
import { payslipFromRow, payslipPdf } from '../src/portal.mjs';
import { REPORTS } from '../src/reports.mjs';
import { completeState, admin } from './helpers.mjs';
import { dates, isRest } from '../src/engine.mjs';

const hr = { username: 'hr1', role: 'hr' }, viewer = { username: 'v', role: 'viewer' };
// Fictional proportional brackets so a basis change is visible: employee 5%, employer 10%, EC 10.
const bracket = [{ from: 0, to: null, fixed: 0, rate: 0.05, excessOver: 0, employerFixed: 0, employerRate: 0.1, ec: 10 }];
function fixture() {
  const store = new Store(':memory:'), state = completeState();
  state.rules = state.rules.map(r => ({ ...r, contributionTiming: 'second', contributions: { SSS: bracket, PhilHealth: bracket, 'Pag-IBIG': bracket } }));
  state.employees = state.employees.map(e => ({ ...e, monthlySalary: 35000 }));
  const template = state.attendance[0];
  state.attendance = [...state.attendance, ...dates('2026-09-16', '2026-09-30').filter(d => !isRest(state.employees[0], d)).map(d => ({ ...template, id: `b-${d}`, date: d }))];
  store.write(state); return store;
}
const change = agencies => ({ effectiveDate: '2026-09-01', reason: 'September DTR: 6 unpaid absence days, compensation actually paid 20,000.', agencies });

test('a lower basis needs a permitted ground; declaring a lower salary is refused, and the salary record never changes', () => {
  const store = fixture();
  try {
    assert.throws(() => submitContributionChange(store, hr, 'EMP-001', change({ SSS: { basis: 20000 } })), /permitted ground/);
    assert.throws(() => submitContributionChange(store, hr, 'EMP-001', change({ PhilHealth: { basis: 40000, ground: 'basic-salary' } })), /not permitted/);
    assert.throws(() => submitContributionChange(store, hr, 'EMP-001', { ...change({}), reason: 'lower' }), /at least 10/);
    assert.throws(() => submitContributionChange(store, hr, 'EMP-001', { ...change({}), effectiveDate: '2026-09-05' }), /cutoff start/);
    assert.throws(() => submitContributionChange(store, viewer, 'EMP-001', change({})), /permission/i);
    const pending = submitContributionChange(store, hr, 'EMP-001', change({ SSS: { basis: 20000, ground: 'actual-compensation' } }));
    assert.equal(pending.status, 'pending');
    assert.equal(pending.before.SSS.employee, 1750); assert.equal(pending.after.SSS.employee, 1000);
    assert.equal(pending.requestedBy, 'hr1');
    assert.equal(store.read().employees[0].monthlySalary, 35000, 'actual salary unchanged');
    // Pending changes do not reach payroll.
    assert.equal(preview(store, '2026-09-16', '2026-09-30', false, ['EMP-001']).rows[0]?.deductions.SSS ?? 1750, 1750);
    assert.throws(() => reviewContributionChange(store, hr, pending.id, { decision: 'approve' }), /permission/i);
    assert.throws(() => reviewContributionChange(store, admin, pending.id, { decision: 'reject' }), /reason/);
    reviewContributionChange(store, admin, pending.id, { decision: 'approve', note: 'Checked against DTR.' });
    const review = contributionReview(store, hr, 'EMP-001');
    assert.equal(review.changes[0].reviewedBy, 'admin');
    assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE action='approve-contribution-change'").get());
  } finally { store.close(); }
});

test('an approved basis flows into payroll, the payslip and the remittance report', () => {
  const store = fixture();
  try {
    submitContributionChange(store, admin, 'EMP-001', change({ SSS: { basis: 20000, ground: 'actual-compensation' }, 'Pag-IBIG': { employee: 200, employer: 200 } }));
    const run = preview(store, '2026-09-16', '2026-09-30', false, ['EMP-001']), row = run.rows[0];
    assert.equal(row.monthlySalary, 35000);
    assert.equal(row.contributionBasis.SSS, 20000);
    assert.equal(row.deductions.SSS, 1000, 'SSS on the 20,000 basis, full month on the 2nd cutoff');
    assert.equal(row.employer.SSS, 2000);
    assert.equal(row.deductions.PhilHealth, 1750, 'PhilHealth still on the actual salary');
    assert.equal(row.deductions['Pag-IBIG'], 200);
    assert.ok(row.trace.some(t => t.component === 'SSS' && /contribution basis 20000/.test(t.formula)));
    const slip = payslipFromRow({ ...run, id: 'preview' }, row);
    assert.match(payslipPdf(slip, { draft: true }).toString('latin1'), /Contribution basis: SSS PHP 20,000.00/);
    const posted = postPayroll(store, admin, { start: run.start, end: run.end, pay13th: false, fingerprint: run.fingerprint, employeeIds: ['EMP-001'] });
    const line = REPORTS.contributions.rows(store.read()).find(r => r[1] === 'EMP-001' && r[0].startsWith(posted.start));
    assert.deepEqual(line.slice(3, 7).map(v => String(v).replace(/[^\d.]/g, '')), ['35000', '20000', '35000', '35000']);
  } finally { store.close(); }
});
