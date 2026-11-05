import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { punch, liveDashboard, employeeClockEvents, locateAddress, clockFlags } from '../src/portal.mjs';
import { changeOfficeNetworks, networkStatus } from '../src/office-network.mjs';
import { addressParts, formatAddress, missingParts, reverseGeocode, cachedAddress } from '../src/geocode.mjs';

const worker = { id: 'worker', username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
function fixture() { const store = new Store(':memory:'); const state = completeState(); state.attendance = []; store.write(state); return store; }
const reading = (kind, id, now, extra = {}) => ({ kind, requestId: id, latitude: 14.55, longitude: 121.02, accuracy: 15, capturedAt: now.toISOString(), ...extra });
const OFFICE = '203.177.10.20', HOME = '112.198.1.2';
// A Nominatim-style answer for 14.55, 121.02 (no network in tests).
const NOMINATIM = { name: 'ABC Building', address: { building: 'ABC Building', house_number: '123', road: 'Example Street', quarter: 'San Antonio', city: 'Makati', state: 'Metro Manila', postcode: '1203', country: 'Philippines' } };
const fakeFetch = body => async () => ({ ok: true, json: async () => body });
const offsite = (kind, id, now, extra = {}) => reading(kind, id, now, { mode: 'outside', reason: 'Client meeting in Makati', addressConfirmed: true, ...extra });

test('office attendance: only from the authorized office Wi-Fi (public address), with the exact message otherwise', () => {
  const store = fixture(), now = new Date('2026-09-01T00:05:00Z');
  try {
    assert.deepEqual(networkStatus(store, HOME), { configured: false, office: false }, 'no address saved: set-up mode, not restricted');
    assert.throws(() => changeOfficeNetworks(store, admin, { action: 'add-current' }, '192.168.1.5'), /public address/);
    changeOfficeNetworks(store, admin, { action: 'add-current' }, `::ffff:${OFFICE}`);
    assert.deepEqual(networkStatus(store, OFFICE), { configured: true, office: true });
    assert.throws(() => punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', now), now, { ip: HOME }), /only available when connected to the company.s authorized office Wi-Fi network/);
    const event = punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', now, { connection: { type: 'wifi', effectiveType: '4g' } }), now, { ip: OFFICE, userAgent: 'Mozilla/5.0 (Android)' });
    assert.equal(event.attendanceType, 'office'); assert.equal(event.network.verified, true); assert.equal(event.network.connection.type, 'wifi');
    assert.equal(event.recordedAt, now.toISOString(), 'server time'); assert.equal(event.latitude, 14.55, 'GPS kept as extra verification');
    assert.equal(event.device.userAgent, 'Mozilla/5.0 (Android)');
  } finally { store.close(); }
});

test('office area no longer replaces the Wi-Fi check: inside the office radius but off the office network is refused', () => {
  const store = fixture(), now = new Date('2026-09-01T00:05:00Z');
  try {
    changeOfficeNetworks(store, admin, { action: 'add-current' }, OFFICE);
    const row = store.db.prepare('SELECT id, data FROM hr_settings LIMIT 1').get(), settings = row ? JSON.parse(row.data) : { company: {} };
    settings.company = { ...settings.company, officeAddress: '104 Paseo de Roxas, San Lorenzo, Makati City', officeLatitude: 14.55, officeLongitude: 121.02, officeRadius: 150 };
    if (row) store.db.prepare('UPDATE hr_settings SET data=? WHERE id=?').run(JSON.stringify(settings), row.id); else store.db.prepare('INSERT INTO hr_settings(id, data) VALUES(1, ?)').run(JSON.stringify(settings));
    assert.throws(() => punch(store, worker, reading('in', '33333333-3333-4333-8333-333333333333', now), now, { ip: HOME }), /authorized office Wi-Fi/);
  } finally { store.close(); }
});

test('address: the most precise readable address from the map service, nothing added that it did not return', () => {
  const parts = addressParts(NOMINATIM);
  assert.equal(formatAddress(parts), 'ABC Building, 123 Example Street, San Antonio, Makati, Metro Manila, 1203, Philippines');
  assert.deepEqual(missingParts(parts), []);
  const partial = addressParts({ address: { city: 'Makati', country: 'Philippines' } });
  assert.equal(formatAddress(partial), 'Makati, Philippines', 'no street or barangay invented');
  assert.deepEqual(missingParts(partial), ['street', 'barangay']);
});

test('off-site work: any connection; GPS + a confirmed address; the server-found address is stored with the timestamp', async () => {
  const store = fixture(), now = new Date();
  try {
    changeOfficeNetworks(store, admin, { action: 'add-current' }, OFFICE);
    const found = await locateAddress(store, worker, { latitude: 14.55, longitude: 121.02, accuracy: 15 }, { fetchImpl: fakeFetch(NOMINATIM) });
    assert.equal(found.formatted, 'ABC Building, 123 Example Street, San Antonio, Makati, Metro Manila, 1203, Philippines');
    assert.equal(found.limit, 50); assert.equal(found.lowAccuracy, false);
    assert.throws(() => punch(store, worker, offsite('in', '55555555-5555-4555-8555-555555555555', now, { addressConfirmed: false }), now, { ip: HOME }), /confirm your location/);
    const event = punch(store, worker, offsite('in', '55555555-5555-4555-8555-555555555555', now), now, { ip: HOME });
    assert.equal(event.attendanceType, 'offsite'); assert.equal(event.network.verified, false);
    assert.equal(event.address, found.formatted); assert.equal(event.addressDetected, found.formatted); assert.equal(event.addressCorrected, false);
    assert.equal(event.addressParts.street, 'Example Street'); assert.equal(event.accuracy, 15); assert.deepEqual(event.flags, []);
    assert.equal(liveDashboard(store, admin, now).outOfOffice, undefined, 'recorded at once, no approval');
    assert.equal(employeeClockEvents(store, admin, 'EMP-001', now.toISOString().slice(0, 7))[0].place, found.formatted, 'HR sees the captured address');
    assert.throws(() => employeeClockEvents(store, worker, 'EMP-001', '2026-09'), /permission/i, 'precise locations for HR / Admin only');
  } finally { store.close(); }
});

test('off-site flags: low accuracy is recorded but flagged; corrected / typed addresses and impossible travel are flagged', async () => {
  const store = fixture(), now = new Date();
  try {
    await reverseGeocode(store, 14.55, 121.02, { fetchImpl: fakeFetch(NOMINATIM) });
    const event = punch(store, worker, offsite('in', '66666666-6666-4666-8666-666666666666', now, { accuracy: 120, address: 'Unit 5, ABC Building, 123 Example Street, Makati' }), now, { ip: HOME });
    assert.equal(event.addressCorrected, true); assert.equal(event.address, 'Unit 5, ABC Building, 123 Example Street, Makati');
    assert.ok(event.flags.some(f => /Low GPS accuracy: ±120 m \(limit 50 m\)/.test(f)));
    assert.ok(event.flags.includes('Address corrected by the employee'));
    const typed = clockFlags({ mode: 'outside', accuracy: 10, address: 'Somewhere typed' }, { limit: 50, detected: null, previous: null, now });
    assert.deepEqual(typed, ['Address not found automatically; typed by the employee']);
    const travel = clockFlags({ mode: 'outside', accuracy: 0, latitude: 10.3, longitude: 123.9 }, { limit: 50, detected: { formatted: '' }, previous: { latitude: 14.55, longitude: 121.02, recordedAt: new Date(now.getTime() - 30 * 60000).toISOString() }, now });
    assert.ok(travel.some(f => /simulated/.test(f)) && travel.some(f => /Impossible travel/.test(f)));
  } finally { store.close(); }
});

test('off-site work: no address found and none typed is refused; an unreachable service never invents one', async () => {
  const store = fixture(), now = new Date();
  try {
    const failed = await reverseGeocode(store, 14.6, 121.1, { fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(failed.formatted, ''); assert.match(failed.error, /could not be reached/);
    assert.equal(cachedAddress(store, 14.6, 121.1), null, 'failures are not cached');
    assert.throws(() => punch(store, worker, offsite('in', '77777777-7777-4777-8777-777777777777', now, { latitude: 14.6, longitude: 121.1 }), now, { ip: HOME }), /Type the address/);
  } finally { store.close(); }
});
