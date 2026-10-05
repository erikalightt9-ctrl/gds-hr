import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview } from '../src/service.mjs';
import { savePayrollInput } from '../src/payroll-inputs.mjs';
import { completeState } from './helpers.mjs';

const payroll = { username: 'pay1', role: 'payroll' }, cutoff = { start: '2026-09-01', end: '2026-09-15' };
function fixture(change = () => {}) { const store = new Store(':memory:'), s = completeState(); s.loans = []; change(s); store.write(s); return store; }
const run = store => preview(store, cutoff.start, cutoff.end, false, ['EMP-001']);
const ot = s => { s.attendance[0].timeOut = '19:00'; };

test('a manual override replaces a calculated amount, keeps the original, and needs a reason', () => {
  const store = fixture();
  try {
    const before = run(store).rows[0];
    const base = { ...cutoff, mode: 'add', hours: {}, reason: 'Payroll correction (demo)' };
    assert.throws(() => savePayrollInput(store, payroll, 'EMP-001', { ...base, overrides: [{ component: 'allowance', amount: 1500, reason: '' }] }), /reason/);
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
  } finally { store.close(); }
});

test('with separate overtime approval, pending overtime is flagged and rejected overtime is not paid', () => {
  const paid = fixture(ot);
  const separate = s => { ot(s); s.rules[0].overtimeApproval = 'separate'; };
  const pending = fixture(s => { separate(s); s.attendance[0].overtimeStatus = 'pending'; });
  const rejected = fixture(s => { separate(s); s.attendance[0].overtimeStatus = 'rejected'; });
  try {
    assert.ok(run(paid).rows[0].earnings.regularOT > 0, 'default policy: approved attendance pays overtime');
    const p = run(pending);
    assert.equal(p.rows[0].earnings.regularOT, 0); assert.ok(p.blockers.some(b => /pending approval/.test(b)));
    const r = run(rejected);
    assert.equal(r.rows[0].earnings.regularOT, 0); assert.ok(!r.blockers.some(b => /overtime/.test(b)));
  } finally { paid.close(); pending.close(); rejected.close(); }
});
