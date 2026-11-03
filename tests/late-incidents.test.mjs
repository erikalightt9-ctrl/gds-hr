import test from 'node:test';
import assert from 'node:assert/strict';
import { lateIncidents, letterMessage, LETTER_AFTER } from '../src/late-incidents.mjs';
import { fixture, attend } from './engine-fixture.mjs';

test('late incidents: 15 minutes or more counts (even when offset); under 15 does not; the 3rd in a month needs a letter', () => {
  const s = fixture(); s.rules[0].graceMinutes = 15;
  s.attendance = [
    attend('2026-10-01', { timeIn: '08:14', timeOut: '16:14' }), // 14 min: grace, not an incident
    attend('2026-10-02', { timeIn: '08:15', timeOut: '16:15' }), // 15 min, offset: still an incident
    attend('2026-10-05', { timeIn: '08:37' }),
    attend('2026-10-06', { timeIn: '08:26', exception: true }), // approved exception: not counted
    attend('2026-10-07', { timeIn: '08:20' }),
    attend('2026-09-30', { timeIn: '09:00' }), // other month
  ];
  const list = lateIncidents(s, 'EMP-001', '2026-10');
  assert.deepEqual(list.map(x => x.date), ['2026-10-02', '2026-10-05', '2026-10-07']);
  assert.equal(list.length >= LETTER_AFTER, true);
  assert.match(letterMessage(list.length, '2026-10'), /3 times in October 2026.*explanation letter/);
});
