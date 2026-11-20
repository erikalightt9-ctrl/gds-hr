import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { postPayroll, preview } from '../src/service.mjs';
import { payrollCutoffs, savePayrollDraft, setPayrollStage } from '../src/payroll-stages.mjs';
import { completeState, admin } from './helpers.mjs';

const payroll = { id: 'pay-1', username: 'pay1', role: 'payroll', displayName: 'Payroll Officer' };

test('a cutoff can be selected, and preview does not create or change a payroll run', () => {
  const store = new Store(':memory:');
  try {
    store.write(completeState());
    const november = payrollCutoffs(2026).find(c => c.id === '2026-11-1');
    assert.equal(november.label, '1–15 November 2026');
    assert.deepEqual([november.start, november.end], ['2026-11-01', '2026-11-15']);
    const first = preview(store, november.start, november.end);
    const runs = store.read().runs.length;
    const second = preview(store, november.start, november.end);
    assert.equal(store.read().runs.length, runs);
    assert.equal(second.totals.net, first.totals.net);
    assert.equal(first.rulesVersion.id, 'r1');
    assert.equal(first.rulesVersion.dailyDivisor, store.read().rules[0].dailyDivisor);
    assert.equal(first.rulesVersion.hourlyDivisor, store.read().rules[0].hourlyDivisor);
    assert.equal(first.rulesVersion.rates.ordinaryOT, store.read().rules[0].ordinaryOT);
    assert.equal(first.rulesVersion.rates.regular, store.read().rules[0].regular);
    const september = preview(store, '2026-09-01', '2026-09-15');
    const posted = postPayroll(store, admin, { start: september.start, end: september.end, pay13th: false, fingerprint: september.fingerprint });
    assert.equal(posted.rulesVersion.id, september.rulesVersion.id);
    assert.equal(posted.rulesVersion.dailyDivisor, september.rulesVersion.dailyDivisor);
    const gross = posted.totals.gross;
    preview(store, november.start, november.end);
    assert.equal(store.read().runs.find(r => r.id === posted.id).totals.gross, gross);
    assert.equal(store.read().runs.find(r => r.id === posted.id).status, 'posted');
  } finally { store.close(); }
});

test('Approved, Included and Paid are separate and audited, and a finalized run is not recalculated', () => {
  const store = new Store(':memory:');
  try {
    store.write(completeState());
    const seen = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
    const posted = postPayroll(store, admin, { start: seen.start, end: seen.end, pay13th: false, fingerprint: seen.fingerprint, employeeIds: ['EMP-001'] });
    const gross = posted.rows[0].gross;
    assert.throws(() => setPayrollStage(store, { username: 'GDS Capital Inc', role: 'admin' }, posted.id, 'approved'), /shared admin/);
    assert.throws(() => setPayrollStage(store, payroll, posted.id, 'included'), /Approve the payroll/);
    const approved = setPayrollStage(store, payroll, posted.id, 'approved');
    assert.ok(approved.stages.approved.at);
    assert.equal(approved.stages.approved.byName, 'Payroll Officer');
    assert.equal(approved.stages.included, undefined);
    assert.equal(approved.stages.paid, undefined);
    assert.equal(approved.rows[0].gross, gross);
    const included = setPayrollStage(store, payroll, posted.id, 'included');
    assert.ok(included.stages.included);
    assert.equal(included.stages.paid, undefined);
    assert.equal(included.status, 'posted');
    const paid = setPayrollStage(store, admin, posted.id, 'paid');
    assert.ok(paid.stages.paid.at);
    assert.equal(paid.rows[0].gross, gross);
    assert.equal(store.read().runs[0].rows[0].net, seen.rows[0].net);
    const actions = store.audit().filter(a => a.recordId === posted.id && ['approved', 'included', 'paid'].includes(a.action));
    assert.deepEqual(actions.map(a => a.action).sort(), ['approved', 'included', 'paid']);
    assert.equal(actions.find(a => a.action === 'approved').actorName, 'Payroll Officer');
    const draft = savePayrollDraft(store, payroll, { start: '2026-10-01', end: '2026-10-15', pay13th: false });
    assert.equal(draft.status, 'draft');
    assert.equal(store.read().runs.find(r => r.id === posted.id).status, 'posted');
    assert.equal(store.read().runs.filter(r => r.status === 'posted').length, 1);
  } finally { store.close(); }
});
