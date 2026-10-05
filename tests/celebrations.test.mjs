import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { celebrationsOn } from '../src/celebrations.mjs';
import { createEmployee, archiveEmployee, readSettings, saveSettings } from '../src/hr201.mjs';
import { completeState } from './helpers.mjs';

const hr = { username: 'hr', role: 'hr' }, admin = { username: 'a', role: 'admin' };
const person = (first, last, birthDate, dateHired) => ({ personal: { firstName: first, lastName: last, birthDate }, contact: {}, emergency: {}, employment: { dateHired, department: 'Ops', position: 'Analyst', classification: 'Regular' }, confirmDuplicate: true });

test('birthdays and work anniversaries are found for the day, for active employees only, without ages', () => {
  const store = new Store(':memory:'), s = completeState(); s.employees = []; store.write(s);
  try {
    createEmployee(store, hr, person('Ana', 'Demo', '1990-10-05', '2020-10-05'));       // both on Oct 5, 6 years
    createEmployee(store, hr, person('Ben', 'Test', '1992-03-01', '2026-10-05'));       // hired today: no anniversary yet
    const gone = createEmployee(store, hr, person('Cy', 'Gone', '1988-10-05', '2019-01-01')).created.id;
    archiveEmployee(store, hr, gone, { reason: 'Resigned (demo)' });
    createEmployee(store, hr, person('Leap', 'Day', '1996-02-29', '2016-02-29'));
    const today = celebrationsOn(store, '2026-10-05').celebrations;
    assert.deepEqual(today.map(c => `${c.name}:${c.occasion}${c.years ? `:${c.years}` : ''}`), ['Ana Demo:anniversary:6', 'Ana Demo:birthday']);
    assert.ok(!JSON.stringify(today).includes('1990'), 'no birth year or age');
    assert.match(today.find(c => c.occasion === 'anniversary').title, /Happy 6-Year Work Anniversary, Ana Demo!/);
    assert.equal(celebrationsOn(store, '2026-02-28').celebrations.length, 2, 'Feb 29 → Feb 28 by default (birthday and anniversary)');
    saveSettings(store, admin, { ...readSettings(store), celebrations: { leapDay: 'mar1' } });
    assert.equal(celebrationsOn(store, '2026-02-28').celebrations.length, 0);
    assert.ok(celebrationsOn(store, '2026-03-01').celebrations.some(c => c.name === 'Leap Day'));
    assert.equal(celebrationsOn(store, '2028-02-29').celebrations.filter(c => c.name === 'Leap Day').length, 2, 'leap years use Feb 29');
  } finally { store.close(); }
});
