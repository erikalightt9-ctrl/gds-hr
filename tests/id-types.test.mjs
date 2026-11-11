// The Government-issued ID choices shown in the browser match the list the server accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VALID_ID_TYPES as server } from '../src/documents201.mjs';
import { VALID_ID_TYPES as browser } from '../public/hr-common.js';

test('ID type lists match between the server and the upload forms', () => {
  assert.deepEqual(browser, server);
  for (const t of ['Passport', 'UMID', 'TIN ID']) assert.ok(server.includes(t));
});
