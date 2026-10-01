import test from 'node:test';
import assert from 'node:assert/strict';
import { MANDATES, bracketShare } from '../public/contributions.js';

const mandate = key => MANDATES.find(m => m.key === key);
const flat = (from, to, fixed) => ({ from, to, fixed, rate: 0, excessOver: 0 });

test('mandated shares follow 2026 SSS, PhilHealth and Pag-IBIG rules', () => {
  assert.deepEqual(mandate('SSS').shares(20000), { base: 20000, employee: 1000, employer: 2030 });
  assert.deepEqual(mandate('SSS').shares(4000), { base: 5000, employee: 250, employer: 510 });
  assert.equal(mandate('SSS').shares(15249.99).base, 15000);
  assert.equal(mandate('SSS').shares(50000).employee, 1750);
  assert.deepEqual(mandate('PhilHealth').shares(8000), { base: 10000, employee: 250, employer: 250 });
  assert.equal(mandate('PhilHealth').shares(150000).employee, 2500);
  assert.deepEqual(mandate('Pag-IBIG').shares(1500), { base: 1500, employee: 15, employer: 30 });
  assert.equal(mandate('Pag-IBIG').shares(25000).employee, 200);
});

test('bracket shares use the payroll formula and reject gaps or overlaps', () => {
  const philHealth = [flat(0, 10000, 250), { from: 10000, to: 100000, fixed: 0, rate: 0.025, excessOver: 0 }, flat(100000, null, 2500)];
  assert.equal(bracketShare(philHealth, 22000), 550);
  assert.equal(bracketShare(philHealth, 100000), 2500);
  assert.equal(bracketShare([flat(0, 100, 1)], 500), null);
});
