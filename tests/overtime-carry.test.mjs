import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll, reversePayroll } from '../src/service.mjs';
import { completeState, admin } from './helpers.mjs';
import { dates, isRest } from '../src/engine.mjs';
import { fileOvertime, decideOvertime } from '../src/overtime.mjs';

// EMP-001: Mon-Fri 08:00-16:00 (8 h, no meal break). Cutoffs Sep 1-15 (A), Sep 16-30 (B), Oct 1-15 (C).
const A = ['2026-09-01', '2026-09-15'], B = ['2026-09-16', '2026-09-30'], C = ['2026-10-01', '2026-10-15'];
const worker = { username: 'emp', role: 'employee', employeeId: 'EMP-001' };
function fixture(change = () => {}) {
  const store = new Store(':memory:'), s = completeState(); s.loans = []; s.rules = s.rules.map(r => ({ ...r, overtimeApproval: 'separate' }));   // the live rule: only approved overtime is paid
  const e = s.employees[0];
  s.attendance = dates('2026-09-01', '2026-10-15').filter(d => !isRest(e, d)).map(d => ({ id: `a-${d}`, employeeId: e.id, date: d, status: 'present', scheduledIn: '08:00', timeIn: '08:00', timeOut: '16:00', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }));
  change(s); store.write(s);
  store.db.prepare('INSERT INTO employee_profiles(employee_id,section,data) VALUES(?,?,?)').run(e.id, 'attendance', JSON.stringify({ scheduleEnd: '16:00', hoursPerDay: 8, mealBreakMinutes: 0 }));
  return store;
}
const run = (store, [s, e]) => preview(store, s, e, false, ['EMP-001']);
const post = (store, cut) => { const p = run(store, cut); assert.deepEqual(p.blockers, [], `no blockers for ${cut[0]}`); return postPayroll(store, admin, { start: cut[0], end: cut[1], pay13th: false, fingerprint: p.fingerprint, employeeIds: ['EMP-001'] }); };
const filingOf = (store, date) => store.db.prepare('SELECT data FROM overtime_requests WHERE date=?').all(date).map(r => JSON.parse(r.data))[0];
const late = (s, date, out) => { s.attendance.find(a => a.date === date).timeOut = out; };

test('pending overtime does not hold the payroll; approved later, the next payroll pays it once, at its original rates', () => {
  const store = fixture(s => late(s, '2026-09-08', '18:00'));
  try {
    const filing = fileOvertime(store, worker, { date: '2026-09-08', startTime: '16:00', endTime: '18:00', reason: 'Month-end closing (test)' });
    const a = post(store, A);
    assert.equal(a.rows[0].earnings.regularOT, 0, 'pending: not paid in its own cutoff');
    assert.equal(filingOf(store, '2026-09-08').status, 'pending');
    assert.equal(filingOf(store, '2026-09-08').paidRunId, undefined);
    // HR decides after Sep 1-15 is posted: allowed (the decision is no longer locked by the posted payroll).
    decideOvertime(store, admin, filing.id, { decision: 'approve' });
    const b = run(store, B).rows[0];
    const expected = Math.round(2 * (30000 / 22 / 8) * 1.25 * 100) / 100;
    assert.equal(b.carriedOvertime.length, 1);
    assert.equal(b.carriedOvertime[0].date, '2026-09-08', 'the original work date is kept');
    assert.ok(Math.abs(b.earnings.regularOT - b.carriedOvertime[0].amount) < 0.01 && b.carriedOvertime[0].amount > 0);
    assert.ok(b.trace.some(t => /Carried-over overtime 2026-09-08 16:00-18:00 \(2 h approved/.test(t.formula) && /Month-end closing/.test(t.formula)), 'reason and hours shown');
    void expected;
    const posted = post(store, B);
    const paid = filingOf(store, '2026-09-08');
    assert.equal(paid.paidRunId, posted.id, 'marked Paid by the payroll that paid it');
    assert.match(paid.paidCutoff, /2026-09-16 to 2026-09-30/);
    assert.ok(paid.history.some(h => h.action === 'paid'));
    assert.equal(run(store, C).rows[0].carriedOvertime.length, 0, 'never paid again');
    assert.throws(() => decideOvertime(store, admin, filing.id, { decision: 'reject', remarks: 'too late' }), /already paid/);
  } finally { store.close(); }
});

test('overtime approved before its cutoff is posted is paid there, marked Paid, and never carried', () => {
  const store = fixture(s => late(s, '2026-09-08', '18:00'));
  try {
    const filing = fileOvertime(store, worker, { date: '2026-09-08', startTime: '16:00', endTime: '18:00', reason: 'Inventory (test)' });
    decideOvertime(store, admin, filing.id, { decision: 'approve' });
    const a = post(store, A);
    assert.ok(a.rows[0].earnings.regularOT > 0);
    assert.equal(filingOf(store, '2026-09-08').paidRunId, a.id);
    assert.equal(run(store, B).rows[0].carriedOvertime.length, 0);
  } finally { store.close(); }
});

test('overtime nobody filed is not recorded at posting and is not paid (no filing, no overtime)', () => {
  const store = fixture(s => late(s, '2026-09-09', '17:40'));
  try {
    const a = post(store, A);
    assert.equal(a.rows[0].earnings.regularOT, 0, 'unfiled: not paid');
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM overtime_requests").get().n, 0, 'no Pending Overtime created');
    assert.equal(run(store, B).rows[0].carriedOvertime.length, 0);
  } finally { store.close(); }
});

test('reversing the payroll that paid carried overtime unmarks it, so the corrected payroll pays it again once', () => {
  const store = fixture(s => late(s, '2026-09-08', '18:00'));
  try {
    const filing = fileOvertime(store, worker, { date: '2026-09-08', startTime: '16:00', endTime: '18:00', reason: 'Audit (test)' });
    post(store, A);
    decideOvertime(store, admin, filing.id, { decision: 'approve' });
    const b = post(store, B);
    reversePayroll(store, admin, b.id, { reason: 'Correction (test)' });
    assert.equal(filingOf(store, '2026-09-08').paidRunId, undefined, 'unpaid again');
    assert.equal(run(store, B).rows[0].carriedOvertime.length, 1, 'the replacement payroll pays it');
  } finally { store.close(); }
});
