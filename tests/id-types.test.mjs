// The Government-issued ID choices shown in the browser match the list the server accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VALID_ID_TYPES as server, idFileName } from '../src/documents201.mjs';
import { VALID_ID_TYPES as browser } from '../public/hr-common.js';

test('ID type lists match between the server and the upload forms', () => {
  assert.deepEqual(browser, server);
  for (const t of ['Passport', 'UMID', 'TIN ID']) assert.ok(server.includes(t));
});

test('ID files are named after the chosen ID', () => {
  assert.equal(idFileName('Passport', 'image/jpeg'), 'Passport ID.jpg');
  assert.equal(idFileName('UMID', 'image/png'), 'UMID ID.png');
  assert.equal(idFileName('TIN ID', 'application/pdf'), 'TIN ID.pdf');
  assert.equal(idFileName("Driver's license", 'image/jpeg'), "Driver's license.jpg");
  assert.equal(idFileName('ACR I-Card (foreign national)', 'image/jpeg'), 'ACR I-Card (foreign national).jpg');
});
