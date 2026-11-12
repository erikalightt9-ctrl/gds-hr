import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview } from '../src/service.mjs';
import { savePayrollInput } from '../src/payroll-inputs.mjs';
import { completeState } from './helpers.mjs';
import { fileOvertime, decideOvertime, overtimeQueue, myOvertime } from '../src/overtime.mjs';

const payroll = { username: 'pay1', role: 'payroll' }, cutoff = { start: '2026-09-01', end: '2026-09-15' };
function fixture(change = () => {}) { const store = new Store(':memory:'), s = completeState(); s.loans = []; change(s); store.write(s); return store; }
const run = store => preview(store, cutoff.start, cutoff.end, false, ['EMP-001']);
const ot = s => { s.attendance[0].timeOut = '19:00'; };

test('a manual override replaces a calculated amount and keeps the original', () => {
  const store = fixture();
  try {
    const before = run(store).rows[0];
    const base = { ...cutoff, mode: 'add', hours: {}, reason: 'Payroll correction (demo)' };
    assert.doesNotThrow(() => savePayrollInput(store, payroll, 'EMP-001', { ...base, overrides: [{ component: 'allowance', amount: 1500 }] }), 'no reason is needed');
    assert.throws(() => savePayrollInput(store, payroll, 'EMP-001', { ...base, overrides: [{ component: 'loans', amount: 0, reason: 'nope' }] }));
    savePayrollInput(store, payroll, 'EMP-001', { ...base, overrides: [{ component: 'allowance', amount: 1500, reason: 'Transport allowance (demo)' }, { component: 'tax', amount: 0, reason: 'Minimum wage earner (demo)' }] });
    const row = run(store).rows[0];
    assert.equal(row.earnings.allowance, 1500);
    assert.equal(row.gross, Math.round((before.gross + 1500) * 100) / 100);
    assert.equal(row.deductions.tax, 0);
    const o = row.overrides.find(x => x.component === 'allowance');
    assert.deepEqual([o.original, o.revised, o.by], [before.earnings.allowance, 1500, 'pay1']);
    const t = row.trace.find(x => x.sourceKind === 'payroll-overrides' && x.component === 'allowance');
    assert.match(t.formula, /Manual override by pay1/);
    assert.equal(run(store).rows[0].gross, row.gross, 'recalculating does not apply the override twice');
    savePayrollInput(store, payroll, 'EMP-001', { ...base, overrides: [{ component: 'basic', amount: before.earnings.basic - 1000, reason: 'Unrecorded absence (demo)' }] });
    assert.equal(run(store).rows[0].applicableBasic, Math.round((before.applicableBasic - 1000) * 100) / 100, '13th-month basic follows the override');
  } finally { store.close(); }
});

test('late clock-out is not overtime: only filed and approved hours are paid, up to the hours worked', () => {
  const store = fixture(s => { ot(s); delete s.rules[0].overtimeApproval; }), worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' }, hr = { username: 'hr1', role: 'hr' };
  const day = completeState().attendance[0].date;
  try {
    const unfiled = run(store);
    assert.equal(unfiled.rows[0].earnings.regularOT, 0, 'staying late without filing is not paid');
    assert.ok(!unfiled.blockers.some(b => /overtime/.test(b)), 'and does not block payroll');
    assert.match(unfiled.rows[0].trace.find(x => /without approved overtime filing/.test(x.formula)).formula, /3 h after the schedule/);
    const filing = fileOvertime(store, worker, { date: day, hours: 2, reason: 'Month-end closing (demo)' });
    assert.throws(() => fileOvertime(store, worker, { date: day, hours: 1, reason: 'Duplicate (demo)' }), /already filed/);
    const pending = run(store);
    assert.equal(pending.rows[0].earnings.regularOT, 0); assert.ok(pending.blockers.some(b => /pending approval/.test(b)));
    assert.throws(() => decideOvertime(store, worker, filing.id, { decision: 'approve' }), /permission/);
    assert.throws(() => decideOvertime(store, hr, filing.id, { decision: 'approve', hours: 5 }), /cannot exceed/);
    decideOvertime(store, hr, filing.id, { decision: 'approve', hours: 2 });
    const paid = run(store).rows[0], twoHours = paid.trace.filter(x => x.component === 'regularOT' && x.amount > 0);
    assert.equal(twoHours.reduce((s, x) => s + x.quantity, 0), 2, 'only the 2 approved hours are paid, not all 3 worked');
    assert.equal(overtimeQueue(store, hr)[0].worked, 3);
    decideOvertime(store, hr, filing.id, { decision: 'reject', remarks: 'Not authorized (demo)' });
    assert.equal(run(store).rows[0].earnings.regularOT, 0, 'rejected overtime is not paid');
    assert.equal(myOvertime(store, worker)[0].status, 'rejected');
  } finally { store.close(); }
});

test('an absence override flows into the posted 13th-month basic and final pay', async () => {
  const { postPayroll } = await import('../src/service.mjs');
  const { thirteenthLedger, computeFinalPay } = await import('../src/thirteenth.mjs');
  const { admin } = await import('./helpers.mjs');
  const store = fixture();
  try {
    const base = run(store).rows[0];
    savePayrollInput(store, payroll, 'EMP-001', { ...cutoff, mode: 'add', hours: {}, reason: 'Correction (demo)', overrides: [{ component: 'absence', amount: 2000, reason: 'Unrecorded absence (demo)' }] });
    const preview1 = run(store), row = preview1.rows[0];
    assert.equal(row.applicableBasic, Math.round((base.applicableBasic - 2000) * 100) / 100);
    postPayroll(store, admin, { ...cutoff, pay13th: false, fingerprint: preview1.fingerprint, employeeIds: ['EMP-001'] });
    assert.equal(thirteenthLedger(store, payroll, '2026')[0].postedBasic, row.applicableBasic);
    const fp = computeFinalPay(store, payroll, { employeeId: 'EMP-001', separationDate: cutoff.end, unpaidDays: 0 });
    assert.equal(fp.items.find(i => /13th/.test(i.label)).amount, Math.round(row.applicableBasic / 12 * 100) / 100);
  } finally { store.close(); }
});

test('overtime filed with start and end times computes the hours, including past midnight', async () => {
  const { hoursBetween } = await import('../src/overtime.mjs');
  assert.equal(hoursBetween('17:00', '19:30'), 2.5);
  assert.equal(hoursBetween('22:00', '01:00'), 3, 'ends the next day');
  const store = fixture(), worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
  try {
    const o = fileOvertime(store, worker, { date: '2026-09-02', startTime: '17:00', endTime: '19:15', reason: 'Report deadline (demo)' });
    assert.equal(o.hours, 2.25); assert.equal(o.startTime, '17:00');
    assert.throws(() => fileOvertime(store, worker, { date: '2026-09-03', startTime: '17:00', reason: 'Missing end (demo)' }), /both/);
    assert.throws(() => fileOvertime(store, worker, { date: '2026-09-04', startTime: '17:00', endTime: '17:05', reason: 'Too short (demo)' }), /15 minutes/);
  } finally { store.close(); }
});

test('night differential (10 PM - 6 AM) on approved overtime is computed and reaches payroll', async () => {
  const { nightHoursBetween } = await import('../src/overtime.mjs');
  assert.equal(nightHoursBetween('20:00', '23:30'), 1.5);
  assert.equal(nightHoursBetween('22:00', '07:00'), 8, 'only 10 PM to 6 AM counts');
  assert.equal(nightHoursBetween('17:00', '21:00'), 0);
  const store = fixture(s => { s.attendance[0].timeOut = '23:00'; delete s.rules[0].overtimeApproval; }), day = completeState().attendance[0].date;
  const worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' }, hr = { username: 'hr1', role: 'hr' };
  try {
    const filing = fileOvertime(store, worker, { date: day, startTime: '16:00', endTime: '23:00', reason: 'Month-end closing (demo)' });
    assert.equal(filing.hours, 7); assert.equal(filing.nightHours, 1);
    assert.equal(run(store).rows[0].earnings.nsd, 0, 'nothing before approval');
    decideOvertime(store, hr, filing.id, { decision: 'approve' });
    const row = run(store).rows[0], r = completeState().rules[0];
    assert.equal(row.earnings.nsd, Math.round(1 * row.hourlyRate * r.ordinaryOT * r.nsd * 100) / 100, '1 night hour × hourly × OT rate × 10%');
    const queued = overtimeQueue(store, hr)[0];
    assert.equal(queued.approvedNightHours, 1); assert.equal(queued.nightPay, row.earnings.nsd, 'the estimate HR sees matches payroll');
    assert.equal(myOvertime(store, worker)[0].approvedNightHours, 1);
  } finally { store.close(); }
});

test('employee contribution shares can be overridden for one cutoff without changing the contribution basis', () => {
  const store = fixture();
  try {
    savePayrollInput(store, payroll, 'EMP-001', { ...cutoff, mode: 'add', hours: {}, reason: 'Contribution correction (demo)', overrides: [{ component: 'SSS', amount: 550, reason: 'SSS per R-5 (demo)' }] });
    const row = run(store).rows[0];
    assert.equal(row.deductions.SSS, 550);
    assert.equal(row.overrides.find(o => o.component === 'SSS').revised, 550);
    assert.equal(row.totalDeductions, Math.round(Object.values(row.deductions).reduce((s, n) => s + n, 0) * 100) / 100);
  } finally { store.close(); }
});

test('lateness under 15 minutes is not deducted; from 15 minutes the whole late time counts less the approved offset', () => {
  const pad = n => String(n).padStart(2, '0');
  const late = (minutes, offset = 0, stay = 0) => fixture(s => { s.rules[0].graceMinutes = 15; const out = s.attendance[0].timeOut.split(':').map(Number), end = out[0] * 60 + out[1] + stay; s.attendance[0].timeIn = `${pad(8 + Math.floor(minutes / 60))}:${pad(minutes % 60)}`; s.attendance[0].timeOut = `${pad(Math.floor(end / 60))}:${pad(end % 60)}`; s.attendance[0].offsetMinutes = offset; if (offset) s.attendance[0].explanation = 'Approved offset (demo)'; });
  const lost = store => { try { return run(store).rows[0].late.find(l => l.lateMinutes > 0)?.deductibleMinutes ?? 0; } finally { store.close(); } };
  assert.equal(lost(late(4)), 0, '4 minutes late: under 15, nothing lost');
  assert.equal(lost(late(14)), 0, '14 minutes late: under 15, nothing lost');
  assert.equal(lost(late(15)), 15, '15 minutes late: the whole 15 counts');
  assert.equal(lost(late(30)), 30, '30 minutes late, no offset: 30 minutes lost');
  assert.equal(lost(late(30, 20)), 10, '30 minutes late with a 20-minute approved offset: 10 minutes lost');
  assert.equal(lost(late(30, 30)), 0, 'a full approved offset restores the time');
  assert.equal(lost(late(20, 0, 20)), 20, 'staying after the end is not an offset unless approved');
});

test('SSS loan, Pag-IBIG loan and salary deduction typed for a cutoff reduce net pay and reach the contributions report', async () => {
  const { monthlyContributions } = await import('../src/contribution-report.mjs');
  const store = fixture();
  try {
    const before = run(store).rows[0];
    savePayrollInput(store, payroll, 'EMP-001', { ...cutoff, mode: 'add', hours: {}, overrides: [{ component: 'sssLoan', amount: 1010 }, { component: 'pagibigLoan', amount: 500 }, { component: 'salaryDeduction', amount: 300 }] });
    const row = run(store).rows[0];
    assert.deepEqual([row.deductions.sssLoan, row.deductions.pagibigLoan, row.deductions.salaryDeduction], [1010, 500, 300]);
    assert.equal(row.net, Math.round((before.net - 1810) * 100) / 100);
    assert.equal(row.deductions.tax, before.deductions.tax, 'loans do not change the tax computation');
    const p = monthlyContributions(store, '2026-09').people.find(x => x.employeeId === 'EMP-001');
    assert.equal(p.sssLoan, 1010); assert.equal(p.piLoan, 500);
  } finally { store.close(); }
});

test('a finalized payroll is locked: no manual entries, overrides or adjustments for that cutoff; who and when are kept', async () => {
  const { postPayroll, saveRecord } = await import('../src/service.mjs');
  const { admin } = await import('./helpers.mjs');
  const store = fixture();
  try {
    const draft = run(store);
    const final = postPayroll(store, admin, { ...cutoff, pay13th: false, fingerprint: draft.fingerprint, employeeIds: ['EMP-001'] });
    assert.equal(final.status, 'posted'); assert.equal(final.postedBy, admin.username); assert.ok(final.postedAt);
    assert.throws(() => savePayrollInput(store, payroll, 'EMP-001', { ...cutoff, mode: 'add', hours: {}, overrides: [{ component: 'allowance', amount: 1 }] }), /locked|posted/i);
    assert.throws(() => saveRecord(store, admin, 'adjustments', { id: 'adj-locked', employeeId: 'EMP-001', date: cutoff.end, kind: 'additional', amount: 100, reason: 'late change', approved: true, includedIn13th: false }), /posted|locked/i);
    assert.equal(store.read().runs.filter(r => r.status === 'posted').length, 1);
  } finally { store.close(); }
});

test('payslip names a typed "Other deductions" amount by its reason, or "Other deductions", not the audit note', async () => {
  const { payslipFromRow } = await import('../src/portal.mjs');
  const row = { employeeId: 'E1', employeeName: 'A', deductions: { SSS: 0, other: 1510 }, trace: [
    { component: 'other', side: 'deductions', amount: 1010, formula: 'Manual override by gds.erika: 0 calculated → 1010' },
    { component: 'other', side: 'deductions', amount: 500, formula: 'Manual override by gds.erika: 0 calculated → 500 (Uniform)' }] };
  const labels = payslipFromRow({ id: 'r', status: 'posted', start: '2026-09-16', end: '2026-09-30' }, row).deductionItems.map(i => i.label);
  assert.ok(labels.includes('Other deductions') && labels.includes('Uniform'));
  assert.ok(!labels.some(l => /Manual override/.test(l)));
});
