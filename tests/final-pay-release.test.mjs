import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { computeFinalPay, setFinalPayRelease, finalPayOverview, savePriorEarnings } from '../src/thirteenth.mjs';
import { completeState } from './helpers.mjs';

const payroll = { username: 'pay1', role: 'payroll' }, viewer = { username: 'v', role: 'viewer' };

test('final pay release status: Released / Not released, kept on the record and audited', () => {
  const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s);
  try {
    savePriorEarnings(store, payroll, { entries: ['01', '02', '03', '04', '05', '06', '07', '08'].map(m => ({ employeeId: 'EMP-001', month: `2026-${m}`, basic: 30000 })) });
    const r = computeFinalPay(store, payroll, { employeeId: 'EMP-001', separationDate: '2026-09-30', separationCause: 'none', unpaidDays: 0, save: true });
    assert.equal(finalPayOverview(store, payroll).records[0].release, undefined, 'not released at first');
    const done = setFinalPayRelease(store, payroll, r.id, { released: true, releasedOn: '2026-10-15' });
    assert.deepEqual([done.release.released, done.release.releasedOn, done.release.by], [true, '2026-10-15', 'pay1']);
    assert.equal(finalPayOverview(store, payroll).records[0].release.released, true);
    assert.equal(setFinalPayRelease(store, payroll, r.id, { released: false }).release.released, false);
    assert.throws(() => setFinalPayRelease(store, viewer, r.id, { released: true }), /permission/i);
    assert.throws(() => setFinalPayRelease(store, payroll, 'nope', { released: true }), /not found/i);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action IN ('release-final-pay','unrelease-final-pay')").get().n, 2);
  } finally { store.close(); }
});
