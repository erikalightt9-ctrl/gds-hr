import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';
import { runTardinessMemos, tardiness } from '../src/tardiness-memo.mjs';
import { myMemos } from '../src/memos.mjs';

// EMP-001 is scheduled 08:00 on weekdays (rest days Saturday and Sunday) and has September attendance in the fixture.
function fixture(lateDays) {
  const store = new Store(':memory:'), s = completeState();
  for (const [date, timeIn, offset = 0] of lateDays) {
    const a = s.attendance.find(x => x.date === date);
    Object.assign(a, { timeIn, offsetMinutes: offset, explanation: offset ? 'Approved offset' : '' });
  }
  store.write(s);
  return store;
}
const OCT_5 = new Date('2026-10-05T02:00:00Z');   // 10:00 AM in Manila

test('3 or more workdays 15+ minutes late in the month bring one memo on the 5th, offsets included', () => {
  const store = fixture([['2026-09-01', '08:20'], ['2026-09-02', '08:15', 15], ['2026-09-03', '08:40'], ['2026-09-04', '08:14']]);
  try {
    assert.deepEqual(runTardinessMemos(store, new Date('2026-10-04T02:00:00Z')), [], 'nothing before the 5th');
    const found = tardiness(store, store.read(), store.read().employees.find(e => e.id === 'EMP-001'), '2026-09');
    assert.deepEqual(found.map(o => [o.date, o.minutesLate, o.approvedOffset]), [['2026-09-01', 20, 0], ['2026-09-02', 15, 15], ['2026-09-03', 40, 0]], '14 minutes does not count; an offset day still counts');
    const issued = runTardinessMemos(store, OCT_5);
    assert.equal(issued.length, 1); assert.equal(issued[0].occurrences, 3);
    assert.deepEqual(runTardinessMemos(store, new Date('2026-10-06T02:00:00Z')), [], 'never twice for the same month');
    const [memo] = myMemos(store, { role: 'employee', employeeId: 'EMP-001' });
    assert.equal(memo.title, 'Monthly Tardiness Reminder — September 2026');
    assert.ok(memo.ackRequired && !memo.acknowledgedAt, 'acknowledgement required');
    assert.match(memo.body, /on 3 occasions during September 2026/);
    assert.match(memo.body, /Sep 2, 2026 \(Wed\) — scheduled 8:00 AM, time in 8:15 AM, 15 min late \(approved offset 15 min\)/);
    assert.match(memo.body, /does not by itself impose a salary deduction/);
    assert.equal(memo.attachments.length, 1, 'PDF on the letterhead attached');
    const pdf = store.db.prepare('SELECT content FROM memo_attachments WHERE id=?').get(memo.attachments[0].id).content;
    assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-');
    assert.ok(store.db.prepare("SELECT 1 FROM notifications WHERE employee_id='EMP-001' AND message LIKE 'New memo: Monthly Tardiness Reminder%'").get(), 'employee bell');
    assert.ok(store.db.prepare("SELECT 1 FROM notifications WHERE employee_id IS NULL AND message LIKE 'Monthly tardiness memo%'").get(), 'HR and admins told');
    assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE action='issue-tardiness-memo'").get(), 'audited');
  } finally { store.close(); }
});

test('fewer than 3 qualifying days bring no memo', () => {
  const store = fixture([['2026-09-01', '08:20'], ['2026-09-02', '08:30'], ['2026-09-03', '08:10']]);
  try { assert.deepEqual(runTardinessMemos(store, OCT_5), []); } finally { store.close(); }
});
