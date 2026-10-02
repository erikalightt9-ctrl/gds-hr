import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { calculatePayroll } from '../src/engine.mjs';
import { saveRecord, preview, postPayroll } from '../src/service.mjs';
import { saveProfile } from '../src/profiles.mjs';
import { schemas } from '../src/schema.mjs';

const hr = { username: 'hr1', role: 'hr' }, viewer = { username: 'v', role: 'viewer' };
// SSS Circular 2024-006 brackets: employee 5% of MSC, employer 10% of MSC plus EC (10 below 15,000 MSC, 30 from 15,000).
function sss() {
  const rows = [{ from: 0, to: 5250, fixed: 250, rate: 0, excessOver: 0, employerFixed: 500, employerRate: 0, ec: 10 }];
  for (let msc = 5500; msc <= 34500; msc += 500) rows.push({ from: msc - 250, to: msc + 250, fixed: msc * 0.05, rate: 0, excessOver: 0, employerFixed: msc * 0.10, employerRate: 0, ec: msc < 15000 ? 10 : 30 });
  rows.push({ from: 34750, to: null, fixed: 1750, rate: 0, excessOver: 0, employerFixed: 3500, employerRate: 0, ec: 30 });
  return rows;
}
const philHealth = [{ from: 0, to: 10000, fixed: 250, rate: 0, excessOver: 0, employerFixed: 250, employerRate: 0, ec: 0 }, { from: 10000, to: 100000, fixed: 0, rate: 0.025, excessOver: 0, employerFixed: 0, employerRate: 0.025, ec: 0 }, { from: 100000, to: null, fixed: 2500, rate: 0, excessOver: 0, employerFixed: 2500, employerRate: 0, ec: 0 }];
const pagIbig = [{ from: 0, to: null, fixed: 200, rate: 0, excessOver: 0, employerFixed: 200, employerRate: 0, ec: 0 }];
function withTables(state) {
  state.rules[0].contributions = { SSS: sss(), PhilHealth: philHealth, 'Pag-IBIG': pagIbig };
  return state;
}

test('employer shares are calculated separately and never reduce net pay', () => {
  const state = withTables(completeState());   // monthly salary 30,000, semi-monthly cutoff (× 0.5)
  const row = calculatePayroll(state, '2026-09-01', '2026-09-15').rows[0];
  assert.deepEqual(row.employer, { SSS: 1500, 'SSS EC': 15, PhilHealth: 375, 'Pag-IBIG': 100 });
  assert.equal(row.employerTotal, 1990);
  assert.equal(row.deductions.SSS, 750);
  assert.equal(row.deductions.PhilHealth, 375);
  assert.equal(row.deductions['Pag-IBIG'], 100);
  const noEmployer = completeState(); noEmployer.rules[0].contributions = { SSS: sss().map(b => ({ ...b, employerFixed: 0, ec: 0 })), PhilHealth: philHealth, 'Pag-IBIG': pagIbig };
  assert.equal(calculatePayroll(noEmployer, '2026-09-01', '2026-09-15').rows[0].net, row.net, 'employer amounts do not change take-home pay');
  assert.ok(row.trace.some(t => t.side === 'employer' && t.component === 'SSS EC'));
});

test('legacy brackets without employer fields still parse and give zero employer share', () => {
  const legacy = { from: 0, to: null, fixed: 100, rate: 0, excessOver: 0 };
  assert.deepEqual(schemas.rules.shape.contributions.shape.SSS.element.parse(legacy), { ...legacy, employerFixed: 0, employerRate: 0, ec: 0 });
});

test('HR can override one employee\'s calculated shares; viewers cannot', () => {
  const store = new Store(':memory:');
  try {
    store.write(withTables(completeState()));
    saveProfile(store, hr, 'EMP-001', 'contributions', { sssEmployee: 900, sssEmployer: 1800, sssEc: 30, philHealthEmployee: null, philHealthEmployer: null, pagIbigEmployee: 100, pagIbigEmployer: 100, reason: 'SSS adjustment per HR' });
    assert.throws(() => saveProfile(store, viewer, 'EMP-001', 'contributions', { reason: 'x' }));
    const row = preview(store, '2026-09-01', '2026-09-15').rows[0];
    assert.equal(row.deductions.SSS, 450, 'override is monthly; cutoff takes half');
    assert.deepEqual(row.employer, { SSS: 900, 'SSS EC': 15, PhilHealth: 375, 'Pag-IBIG': 50 });
    assert.ok(row.trace.some(t => t.component === 'SSS' && /override/i.test(t.formula)));
  } finally { store.close(); }
});

test('HR can edit rates; rules used by posted payroll stay locked, unused approved rules can be corrected', () => {
  const store = new Store(':memory:');
  try {
    const state = withTables(completeState()); state.rules[0].id = 'r-2026'; store.write(state);
    const rule = store.read().rules[0];
    saveRecord(store, hr, 'rules', { ...rule, contributions: { ...rule.contributions, 'Pag-IBIG': [{ ...pagIbig[0], fixed: 150 }] }, approvedBy: 'approve' });
    assert.equal(store.read().rules[0].contributions['Pag-IBIG'][0].fixed, 150, 'approved but unused version corrected');
    saveRecord(store, hr, 'rules', { ...store.read().rules[0], contributions: { ...rule.contributions, 'Pag-IBIG': pagIbig }, approvedBy: 'approve' });
    const p = preview(store, '2026-09-01', '2026-09-15');
    postPayroll(store, admin, { start: p.start, end: p.end, pay13th: false, fingerprint: p.fingerprint });
    assert.throws(() => saveRecord(store, hr, 'rules', { ...store.read().rules[0], approvedBy: 'approve' }), /posted payroll/);
    assert.equal(store.read().runs[0].rows[0].employerTotal, 1990, 'posted payroll keeps its employer amounts');
  } finally { store.close(); }
});
