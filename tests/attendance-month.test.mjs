import test from 'node:test';
import assert from 'node:assert/strict';
import { monthSheet } from '../public/attendance-month.js';

const esc = s => String(s);
const base = () => ({
  employees: [{ id: 'E1', name: 'Reyes, Patrick', startDate: '2026-09-01', restDays: [0, 6] }],
  attendance: [
    { employeeId: 'E1', date: '2026-10-27', status: 'present', timeIn: '09:00', scheduledIn: '09:00', timeOut: '18:00' },
    { employeeId: 'E1', date: '2026-10-28', status: 'present', timeIn: '09:00', scheduledIn: '09:00', timeOut: '14:04' },
  ],
  leaves: [{ employeeId: 'E1', status: 'pending', startDate: '2026-10-28', endDate: '2026-10-28', startTime: '14:00', endTime: '18:00', countedDates: ['2026-10-28'], partialDates: ['2026-10-28'] }],
  holidays: [], rules: [], openClockIns: [],
});
// Present / Absent / Leave totals of the only employee row.
const totals = html => [...html.matchAll(/<td class="am-num am-(present|absent|leave)">([\d.]+)<\/td>/g)].map(m => Number(m[2]));

test('a worked half beside a half-day leave is a half day: 0.5 present and 0.5 leave once approved', () => {
  const pending = monthSheet({ state: base(), esc, today: '2026-10-28', month: '2026-10' });
  assert.match(pending, /am-mark am-half am-pending" title="Half day: worked half, half-day leave not yet approved"/);
  assert.deepEqual(totals(pending), [1.5, 0.5, 0], 'Oct 27 full + Oct 28 half present; the other half absent while pending');
  const s = base(); s.leaves[0].status = 'approved';
  const approved = monthSheet({ state: s, esc, today: '2026-10-28', month: '2026-10' });
  assert.match(approved, /am-mark am-half" title="Half day: worked half, half-day leave approved"/);
  assert.deepEqual(totals(approved), [1.5, 0, 0.5]);
  const whole = base(); whole.leaves = [];
  assert.deepEqual(totals(monthSheet({ state: whole, esc, today: '2026-10-28', month: '2026-10' })), [2, 0, 0], 'without a half-day leave the day stays present');
});

test('a recorded day off is shown as a day off, not as leave', () => {
  const s = base(); s.leaves = [];
  s.attendance.push({ employeeId: 'E1', date: '2026-10-26', status: 'off', timeIn: '', timeOut: '', scheduledIn: '08:00' });
  const html = monthSheet({ state: s, esc, today: '2026-10-28', month: '2026-10' });
  assert.deepEqual(totals(html), [2, 0, 0], 'neither leave nor absent');
});
