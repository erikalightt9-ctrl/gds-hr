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

test('released final pay is recorded in the 201 file: Compensation → Final pay and the clearance item', async () => {
  const { requestMovement, decideMovement, listMovements } = await import('../src/movements.mjs');
  const { profileExtras } = await import('../src/hr201.mjs');
  const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s);
  const a1 = { username: 'admin1', role: 'admin' }, a2 = { username: 'admin2', role: 'admin' };
  store.db.prepare('INSERT INTO employee_profiles(employee_id,section,data) VALUES(?,?,?)').run('EMP-001', 'employment', JSON.stringify({ position: 'Clerk' }));
  try {
    const sep = requestMovement(store, a1, { employeeId: 'EMP-001', type: 'separation', effectiveDate: '2026-09-30', reason: 'Resignation letter received and accepted', separationKind: 'Resignation' });
    decideMovement(store, a2, sep.id, { decision: 'approve' });
    savePriorEarnings(store, payroll, { entries: ['01', '02', '03', '04', '05', '06', '07', '08'].map(m => ({ employeeId: 'EMP-001', month: `2026-${m}`, basic: 30000 })) });
    const r = computeFinalPay(store, payroll, { employeeId: 'EMP-001', separationDate: '2026-09-30', separationCause: 'none', unpaidDays: 0, save: true });
    const item = () => listMovements(store, a1, 'EMP-001').find(m => m.id === sep.id).clearance.find(i => i.key === 'finalpay');
    assert.equal(item().status, 'pending');
    setFinalPayRelease(store, payroll, r.id, { released: true, releasedOn: '2026-10-20' });
    assert.equal(item().status, 'cleared'); assert.match(item().note, /released on 2026-10-20/);
    const fp = profileExtras(store, a1, 'EMP-001').finalPay;
    assert.deepEqual([fp.length, fp[0].id, fp[0].release.released, fp[0].release.releasedOn], [1, r.id, true, '2026-10-20']);
    setFinalPayRelease(store, payroll, r.id, { released: false });
    assert.equal(item().status, 'pending', 'back to not released: the clearance item reopens');
  } finally { store.close(); }
});
