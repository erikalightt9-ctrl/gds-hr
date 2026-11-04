import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';
import { applyLeave, attachLeaveProof, reviewLeaveProof, employeeDashboard } from '../src/portal.mjs';
import { uploadDocument } from '../src/profiles.mjs';
import { reviewLeave } from '../src/service.mjs';
import { leaveBalance } from '../src/engine.mjs';

const worker = { id: 'w', username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
const hr = { username: 'hr1', role: 'hr' };
function fixture() {
  const store = new Store(':memory:'), state = completeState();
  state.attendance = [];
  state.employees[0].leaveEligibility = ['sil', 'unpaid'];
  state.leaveTypes = state.leaveTypes.map(t => t.id === 'sil' ? { ...t, entitledDays: 10, minServiceMonths: 0, documentsRequired: false } : t);
  store.write(state); return store;
}
const sil = store => { const s = store.read(); return leaveBalance(s, s.employees[0], s.leaveTypes.find(t => t.id === 'sil'), '2026-12-31'); };

test('HR approves, rejects and cancels employee leave; one balance, shown the same to employee and HR', () => {
  const store = fixture();
  try {
    const before = sil(store).available;
    const leave = applyLeave(store, worker, { typeId: 'sil', startDate: '2026-11-09', endDate: '2026-11-10', reason: 'Family trip' });
    assert.equal(sil(store).used, 0, 'pending does not consume credits');
    assert.ok(store.db.prepare("SELECT 1 FROM notifications WHERE employee_id IS NULL").get(), "HR is notified of the new request");
    assert.throws(() => reviewLeave(store, worker, leave.id, { decision: 'approve' }), /permission/i);
    assert.equal(leave.proofStatus, 'required', 'a 2-day leave needs proof');
    assert.throws(() => reviewLeave(store, hr, leave.id, { decision: 'approve' }), /supporting document is needed/);
    const doc = uploadDocument(store, worker, 'EMP-001', { type: 'Leave Supporting', name: 'itinerary.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.7 itinerary').toString('base64') });
    attachLeaveProof(store, worker, leave.id, { documentId: doc.id });
    reviewLeaveProof(store, { username: 'hr1', role: 'hr' }, leave.id, { decision: 'verified', note: '' });
    reviewLeave(store, hr, leave.id, { decision: 'approve', remarks: 'Enjoy' });
    assert.equal(sil(store).available, before - 2, '2 days deducted');
    const mine = employeeDashboard(store, worker);
    assert.equal(mine.balances.find(b => b.typeId === 'sil').available, before - 2, 'employee sees the same balance');
    assert.equal(mine.leaves.find(l => l.id === leave.id).hrRemarks, 'Enjoy');
    assert.throws(() => reviewLeave(store, hr, leave.id, { decision: 'approve' }), /already approved/);
    assert.throws(() => reviewLeave(store, hr, leave.id, { decision: 'cancel' }), /reason/);
    reviewLeave(store, hr, leave.id, { decision: 'cancel', remarks: 'Trip moved' });
    assert.equal(sil(store).available, before, 'cancelling restores the credits');
    const second = applyLeave(store, worker, { typeId: 'sil', startDate: '2026-11-16', endDate: '2026-11-16', reason: 'Errand' });
    assert.throws(() => reviewLeave(store, hr, second.id, { decision: 'reject' }), /reason/);
    reviewLeave(store, hr, second.id, { decision: 'reject', remarks: 'Peak week' });
    assert.equal(sil(store).available, before, 'rejected leave does not consume credits');
    assert.match(store.db.prepare("SELECT message FROM notifications WHERE employee_id='EMP-001' ORDER BY rowid DESC LIMIT 1").get().message, /rejected — HR remarks: Peak week/);
  } finally { store.close(); }
});
