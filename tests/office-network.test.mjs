import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { punch, reviewOutOfOffice, liveDashboard } from '../src/portal.mjs';
import { changeOfficeNetworks, networkStatus } from '../src/office-network.mjs';

const worker = { id: 'worker', username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
function fixture() { const store = new Store(':memory:'); const state = completeState(); state.attendance = []; store.write(state); return store; }
const reading = (kind, id, now, extra = {}) => ({ kind, requestId: id, latitude: 14.55, longitude: 121.02, accuracy: 15, capturedAt: now.toISOString(), ...extra });
const OFFICE = '203.177.10.20', HOME = '112.198.1.2';

test('office Wi-Fi: time in only from the office address; out of office needs a reason and HR approval', () => {
  const store = fixture(), now = new Date('2026-09-01T00:05:00Z');
  try {
    assert.deepEqual(networkStatus(store, HOME), { configured: false, office: false }, 'no address saved: not restricted');
    assert.throws(() => changeOfficeNetworks(store, admin, { action: 'add-current' }, '192.168.1.5'), /public address/);
    changeOfficeNetworks(store, admin, { action: 'add-current' }, `::ffff:${OFFICE}`);
    assert.deepEqual(networkStatus(store, OFFICE), { configured: true, office: true });
    assert.throws(() => punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', now), now, { ip: HOME }), /not at the office/);
    assert.throws(() => punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', now, { mode: 'outside', reason: 'x' }), now, { ip: HOME }), /reason/);
    const away = punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', now, { mode: 'outside', reason: 'Client meeting in Makati' }), now, { ip: HOME });
    assert.equal(away.outOfOffice, true); assert.equal(away.approval, 'pending');
    assert.equal(liveDashboard(store, admin, now).outOfOffice.length, 1, 'listed for HR');
    assert.throws(() => reviewOutOfOffice(store, worker, away.id, { decision: 'approve' }), /permission/i);
    assert.throws(() => reviewOutOfOffice(store, admin, away.id, { decision: 'reject', note: '' }), /reason/);
    assert.equal(reviewOutOfOffice(store, admin, away.id, { decision: 'approve' }).approval, 'approved');
    assert.equal(liveDashboard(store, admin, now).outOfOffice.length, 0);
    const end = new Date('2026-09-01T09:05:00Z');
    const out = punch(store, worker, reading('out', '22222222-2222-4222-8222-222222222222', end), end, { ip: OFFICE });
    assert.equal(out.onOfficeNetwork, true); assert.ok(!out.outOfOffice);
  } finally { store.close(); }
});

test('office area: a phone at the office may time in even when the office internet address changed', () => {
  const store = fixture(), now = new Date('2026-09-01T00:05:00Z');
  try {
    changeOfficeNetworks(store, admin, { action: 'add-current' }, OFFICE);
    const row = store.db.prepare('SELECT id, data FROM hr_settings LIMIT 1').get(), settings = row ? JSON.parse(row.data) : { company: {} };
    settings.company = { ...settings.company, officeAddress: '104 Paseo de Roxas, San Lorenzo, Makati City', officeLatitude: 14.55, officeLongitude: 121.02, officeRadius: 150 };
    if (row) store.db.prepare('UPDATE hr_settings SET data=? WHERE id=?').run(JSON.stringify(settings), row.id); else store.db.prepare('INSERT INTO hr_settings(id, data) VALUES(1, ?)').run(JSON.stringify(settings));
    const inOffice = punch(store, worker, reading('in', '33333333-3333-4333-8333-333333333333', now), now, { ip: HOME });
    assert.equal(inOffice.inOfficeArea, true); assert.equal(inOffice.onOfficeNetwork, false); assert.equal(inOffice.outOfOffice, undefined);
    const far = new Date('2026-09-01T09:05:00Z');
    assert.throws(() => punch(store, worker, reading('out', '44444444-4444-4444-8444-444444444444', far, { latitude: 14.65, longitude: 121.10 }), far, { ip: HOME }), /not at the office/);
  } finally { store.close(); }
});
