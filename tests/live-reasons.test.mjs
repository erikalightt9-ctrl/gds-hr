import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';
import { reasonsFor } from '../src/live-reasons.mjs';
import { fileOvertime } from '../src/overtime.mjs';

const worker = { username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
const day = '2026-09-02';

test('Live attendance reasons gather the day\'s out-of-office, late explanation, leave and overtime with their details', () => {
  const store = new Store(':memory:'), s = completeState();
  s.leaves = [{ id: 'lv1', employeeId: 'EMP-001', typeId: s.leaveTypes[0].id, startDate: day, endDate: day, days: 0.5, countedDates: [day], partialDates: [day], reason: 'Medical appointment — Dental check-up at 2 PM', documentReference: '11111111-2222-3333-4444-555555555555', status: 'pending', proofStatus: 'submitted', proofNote: '' }];
  store.write(s);
  try {
    store.db.prepare('INSERT INTO clock_events(id,employee_id,work_date,kind,data) VALUES(?,?,?,?,?)').run('ev1', 'EMP-001', day, 'in', JSON.stringify({ id: 'ev1', employeeId: 'EMP-001', workDate: day, kind: 'in', time: '09:10', outOfOffice: true, reason: 'Client meeting — ABC Corp. in Makati until 11 AM' }));
    store.db.prepare('INSERT INTO attendance_explanations VALUES(?,?,?)').run('ex1', 'EMP-001', JSON.stringify({ id: 'ex1', employeeId: 'EMP-001', date: day, reason: 'Traffic / transportation delay', explanation: 'EDSA was closed', requestedOffset: 10, status: 'pending', documentId: '' }));
    fileOvertime(store, worker, { date: day, startTime: '17:00', endTime: '19:00', reason: 'Month-end / cut-off deadline — Closing the September books' });
    const reasons = reasonsFor(store, store.read(), 'EMP-001', day);
    assert.deepEqual(reasons.map(r => [r.kind, r.label]), [['out-of-office', 'Client meeting'], ['late', 'Traffic / transportation delay'], ['leave', 'Medical appointment'], ['overtime', 'Month-end / cut-off deadline']]);
    assert.equal(reasons[0].explanation, 'ABC Corp. in Makati until 11 AM');
    assert.equal(reasons[1].explanation, 'EDSA was closed');
    const leave = reasons.find(r => r.kind === 'leave');
    assert.equal(leave.explanation, 'Dental check-up at 2 PM'); assert.equal(leave.proof, 'submitted'); assert.ok(leave.documentId, 'proof of leave is linked');
    assert.match(reasons[3].detail, /17:00–19:00 · 2 h filed/);
    assert.deepEqual(reasonsFor(store, store.read(), 'EMP-001', '2026-09-03'), [], 'other days have no reasons');
  } finally { store.close(); }
});
