import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';
import { easter, holidaysFor, ensureHolidayYears } from '../src/holidays-auto.mjs';

test('calculated holidays match the 2026 proclamation (Holy Week, National Heroes Day)', () => {
  assert.equal(easter(2026), '2026-04-05');
  const h = Object.fromEntries(holidaysFor(2026).map(x => [x.name, x.date]));
  assert.equal(h['Maundy Thursday'], '2026-04-02');
  assert.equal(h['Good Friday'], '2026-04-03');
  assert.equal(h['Black Saturday'], '2026-04-04');
  assert.equal(h['National Heroes Day'], '2026-08-31');
  const h27 = Object.fromEntries(holidaysFor(2027).map(x => [x.name, x.date]));
  assert.equal(h27['Good Friday'], '2027-03-26');
  assert.equal(h27['National Heroes Day'], '2027-08-30');
  assert.equal(h27['Chinese New Year'], '2027-02-06');
});

test('next year is added automatically once; a year HR already set is left alone', () => {
  const store = new Store(':memory:'); const s = completeState(); s.holidays = [{ id: 'h1', date: '2026-01-01', name: "New Year's Day", kind: 'regular', basis: 'Proclamation' }]; store.write(s);
  try {
    assert.deepEqual(ensureHolidayYears(store, '2026-10-08'), [2027]);
    assert.ok(store.read().holidays.filter(h => h.date.startsWith('2027-')).length >= 19);
    assert.deepEqual(ensureHolidayYears(store, '2026-10-09'), [], 'not added twice');
    assert.equal(store.read().holidays.filter(h => h.date.startsWith('2026-')).length, 1, '2026 untouched');
  } finally { store.close(); }
});
