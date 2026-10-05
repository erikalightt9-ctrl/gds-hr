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
