import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll } from '../src/service.mjs';
import { savePayrollInput, deletePayrollInput } from '../src/payroll-inputs.mjs';
import { completeState, admin } from './helpers.mjs';

const hr = { username: 'hr1', role: 'hr' }, viewer = { username: 'v', role: 'viewer' };
const H = extra => ({ regularOT: 0, restDay: 0, restOT: 0, specialHoliday: 0, specialOT: 0, regularHoliday: 0, regularHolidayOT: 0, nightDiff: 0, ...extra });
function fixture({ attendance = true } = {}) { const store = new Store(':memory:'), s = completeState(); if (!attendance) s.attendance = []; store.write(s); return store; }
// Rates on the row are rounded for display, so allow a few centavos.
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.06, `${label}: ${a} vs ${b}`);
const run = store => preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);

test('manual hours are added on top of attendance and priced with the approved multipliers', () => {
  const store = fixture();
  try {
    const before = run(store).rows[0], hourly = before.hourlyRate;
    savePayrollInput(store, hr, 'EMP-001', { start: '2026-09-01', end: '2026-09-15', mode: 'add', hours: H({ regularOT: 4, nightDiff: 2, regularHoliday: 8 }), reason: 'Manual DTR for field work' });
    const row = run(store).rows[0];
    near(row.earnings.regularOT, 4 * hourly * 1.25, 'row.earnings.regularOT');
    near(row.earnings.nsd, 2 * hourly * 0.1, 'row.earnings.nsd');
    near(row.earnings.regularHoliday, 8 * hourly * 1, 'row.earnings.regularHoliday');
    assert.equal(row.earnings.basic, before.earnings.basic, 'attendance-based basic unchanged in add mode');
    assert.ok(row.trace.some(t => /Manual entry by hr1/.test(t.formula)));
    assert.equal(row.manualEntry.mode, 'add');
  } finally { store.close(); }
});

test('replace mode pays from typed figures without attendance and clears missing-attendance blockers', () => {
  const store = fixture({ attendance: false });
  try {
    assert.ok(run(store).blockers.some(b => /Missing attendance/.test(b)));
    savePayrollInput(store, hr, 'EMP-001', { start: '2026-09-01', end: '2026-09-15', mode: 'replace', absenceDays: 1, lateMinutes: 30, undertimeMinutes: 60, hours: H({ regularOT: 2 }), reason: 'Biometric offline; manual timesheet' });
    const result = run(store), row = result.rows[0], daily = row.dailyRate, hourly = row.hourlyRate;
    assert.ok(!result.blockers.some(b => /EMP-001.*Missing attendance/.test(b)));
    near(row.deductions.absence, daily, 'row.deductions.absence');
    near(row.deductions.undertime, hourly, 'row.deductions.undertime');
    near(row.lateReduction, 0.5 * hourly, 'row.lateReduction');
    assert.equal(row.daysPresent, row.workingDays - 1);
    near(row.earnings.regularOT, 2 * hourly * 1.25, 'row.earnings.regularOT');
    assert.throws(() => savePayrollInput(store, viewer, 'EMP-001', { start: '2026-09-01', end: '2026-09-15', mode: 'add', hours: H(), reason: 'x x x' }), /permission/i);
    assert.throws(() => savePayrollInput(store, hr, 'EMP-001', { start: '2026-09-01', end: '2026-09-15', mode: 'add', hours: H(), reason: '' }), /reason/);
    deletePayrollInput(store, hr, 'EMP-001', '2026-09-01', '2026-09-15');
    assert.ok(run(store).blockers.some(b => /Missing attendance/.test(b)));
  } finally { store.close(); }
});

test('posted cutoffs lock manual entries', () => {
  const store = fixture();
  try {
    savePayrollInput(store, hr, 'EMP-001', { start: '2026-09-01', end: '2026-09-15', mode: 'add', hours: H({ regularOT: 1 }), reason: 'Approved OT form' });
    const r = run(store);
    postPayroll(store, admin, { start: r.start, end: r.end, pay13th: false, fingerprint: r.fingerprint, employeeIds: ['EMP-001'] });
    assert.throws(() => savePayrollInput(store, hr, 'EMP-001', { start: '2026-09-01', end: '2026-09-15', mode: 'add', hours: H({ regularOT: 9 }), reason: 'Change after posting' }), /posted/);
  } finally { store.close(); }
});
