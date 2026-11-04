import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeDetail } from '../public/notice-detail.js';

const data = {
  history: [{ id: 'e1', workDate: '2026-11-03', kind: 'out', time: '18:06', atOffice: true, place: '104 Paseo de Roxas, Makati City' }],
  explanations: [{ date: '2026-11-03', status: 'returned', reason: 'Traffic', explanation: 'Heavy rain on EDSA', comments: [{ side: 'hr', text: 'Please attach proof' }] }],
  leaves: [{ typeId: 'vl', startDate: '2026-11-10', endDate: '2026-11-11', days: 2, status: 'approved' }],
  balances: [{ typeId: 'vl', name: 'Vacation Leave' }],
  payslips: [{ start: '2026-10-16', end: '2026-10-31', payDate: '2026-11-08', net: 12345.5 }],
};
const rowsOf = d => Object.fromEntries(d.rows);

test('a notification opens the record behind it and the section that holds it', () => {
  const clock = noticeDetail({ message: 'Time out recorded at 18:06 and sent to HR.', at: '2026-11-03T10:06:57Z' }, data);
  assert.equal(clock.tab, 'attendance');
  assert.equal(rowsOf(clock)['Time out'], '18:06'); assert.equal(rowsOf(clock).Where, 'Office');

  const expl = noticeDetail({ message: 'Attendance explanation submitted for 2026-11-03. Waiting for HR review.', at: '2026-11-03T10:07:19Z' }, data);
  assert.equal(expl.tab, 'explanations');
  assert.equal(rowsOf(expl).Status, 'Sent back to you'); assert.equal(rowsOf(expl)['HR comment'], 'Please attach proof');

  const leave = noticeDetail({ message: 'Leave request 2026-11-10 to 2026-11-11: approved.', at: '2026-11-03T00:00:00Z' }, data);
  assert.equal(leave.tab, 'leave'); assert.equal(rowsOf(leave)['Leave type'], 'Vacation Leave');

  const pay = noticeDetail({ message: 'Your payslip for 2026-10-16 to 2026-10-31 is now available.', at: '2026-11-08T00:00:00Z' }, data);
  assert.equal(pay.tab, 'payslips'); assert.equal(rowsOf(pay)['Salary day'], '2026-11-08');

  assert.equal(noticeDetail({ message: '201 document uploaded: Government-issued ID. Waiting for HR review.', at: '' }, data).tab, 'files201');
});

test('an unknown notice or a missing record still opens with the message alone', () => {
  const plain = noticeDetail({ message: 'Welcome to GDS HR.', at: '' }, {});
  assert.equal(plain.tab, null); assert.deepEqual(plain.rows, []);
  const old = noticeDetail({ message: 'Attendance explanation submitted for 2026-07-11. Waiting for HR review.', at: '' }, {});
  assert.equal(old.tab, 'explanations'); assert.deepEqual(old.rows, [['Date', '2026-07-11']]);
});
