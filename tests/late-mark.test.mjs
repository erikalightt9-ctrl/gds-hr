import test from 'node:test';
import assert from 'node:assert/strict';
import { graceFloor, isGraceLate, lateMinutes } from '../public/late-mark.js';

test('a late at or above the grace period stays late even when an offset would cover the minutes', () => {
  assert.equal(graceFloor(15), 15);
  assert.equal(graceFloor(0), 1, 'a zero grace period still treats one minute as late');
  assert.equal(lateMinutes('09:20', '09:00'), 20);
  assert.equal(lateMinutes('08:50', '09:00'), -10);
  assert.equal(isGraceLate(20, 15), true, '20 minutes is late whether or not an offset is approved');
  assert.equal(isGraceLate(15, 15), true);
  assert.equal(isGraceLate(10, 15), false, 'under 15 minutes is not tagged late');
  assert.equal(isGraceLate(0, 15), false);
});
