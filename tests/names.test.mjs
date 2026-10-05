import test from 'node:test';
import assert from 'node:assert/strict';
import { titleCase, personalNames, sectionNames } from '../src/names.mjs';

test('names are capitalized word by word', () => {
  assert.equal(titleCase('juan DELA cruz'), 'Juan Dela Cruz');
  assert.equal(titleCase('  ma.   rita  '), 'Ma. Rita');
  assert.equal(titleCase("anne-marie o'brien"), "Anne-Marie O'Brien");
  assert.equal(titleCase('iii'), 'III'); assert.equal(titleCase('jr.'), 'Jr.');
  assert.equal(titleCase('ñoño'), 'Ñoño');
  assert.deepEqual(personalNames({ firstName: 'PATRICK oliver', lastName: 'reyes', sex: 'Male' }), { firstName: 'Patrick Oliver', lastName: 'Reyes', sex: 'Male' });
  assert.equal(sectionNames('family', { spouse: { name: 'maria santos' }, children: [{ name: 'ana santos' }] }).children[0].name, 'Ana Santos');
});

test('existing upper-case names are capitalized once, with an audit entry', async () => {
  const { Store } = await import('../src/store.mjs');
  const { completeState } = await import('./helpers.mjs');
  const { capitalizeExistingNames } = await import('../src/names.mjs');
  const store = new Store(':memory:');
  try {
    const s = completeState(); s.employees[0].name = 'REYES, PATRICK OLIVER L.'; store.write(s);
    store.db.prepare("INSERT INTO employee_profiles VALUES('EMP-001','personal',?)").run(JSON.stringify({ lastName: 'REYES', firstName: 'PATRICK OLIVER', middleName: 'L.' }));
    assert.ok(capitalizeExistingNames(store) >= 2);
    assert.equal(store.read().employees[0].name, 'Reyes, Patrick Oliver L.');
    assert.equal(store.audit().find(a => a.kind === 'employees' && a.action === 'capitalize-names').before.name, 'REYES, PATRICK OLIVER L.');
    assert.equal(capitalizeExistingNames(store), 0, 'runs only once');
  } finally { store.close(); }
});

test('every employee is moved to GDS Capital HQ once, audited', async () => {
  const { Store } = await import('../src/store.mjs');
  const { completeState } = await import('./helpers.mjs');
  const { runMigrations, HEADQUARTERS } = await import('../src/migrations.mjs');
  const store = new Store(':memory:');
  try {
    store.write(completeState());
    assert.equal(runMigrations(store).departments, 1);
    assert.equal(store.read().employees[0].department, HEADQUARTERS);
    assert.equal(store.audit().find(a => a.action === 'set-department').before.department, 'Operations');
    assert.equal(runMigrations(store).departments, 0, 'runs only once');
  } finally { store.close(); }
});
