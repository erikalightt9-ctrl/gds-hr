import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';
import { addUser, login, signOutEverywhere } from '../src/auth.mjs';
import { createHash } from 'node:crypto';

const hash = t => createHash('sha256').update(t).digest('hex');

test('an account signed in on one device cannot sign in on another until signed out (administrators too)', async () => {
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const admin = { username: 'boss', role: 'admin' };
    const emp = await addUser(store, { username: 'worker1', password: 'Worker-pass-2026!', role: 'employee', employeeId: 'EMP-001' }, admin);
    const first = await login(store, 'worker1', 'Worker-pass-2026!', 'k1');
    await assert.rejects(login(store, 'worker1', 'Worker-pass-2026!', 'k2'), /already signed in on another device/);
    const again = await login(store, 'worker1', 'Worker-pass-2026!', 'k3', '', { currentTokenHash: hash(first.token) });
    assert.ok(again.token, 'the same device may sign in again');
    assert.throws(() => signOutEverywhere(store, { username: 'x', role: 'employee' }, emp.id), /permission/i);
    assert.equal(signOutEverywhere(store, admin, emp.id).signedOut, 1);
    assert.ok((await login(store, 'worker1', 'Worker-pass-2026!', 'k4')).token, 'signs in on the new device after HR signs the old one out');
    await addUser(store, { username: 'boss2', password: 'Admin-pass-2026!!', role: 'admin' }, admin);
    await login(store, 'boss2', 'Admin-pass-2026!!', 'k5');
    await assert.rejects(login(store, 'boss2', 'Admin-pass-2026!!', 'k6'), /already signed in on another device/, 'administrators too');
  } finally { store.close(); }
});

test('a staff account can link itself to its own employee record (My account); employee accounts cannot change theirs', async () => {
  const { myAccount, linkMyAccount } = await import('../src/auth.mjs');
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const admin = await addUser(store, { username: 'boss3', password: 'Admin-pass-2026!!', role: 'admin' }, { username: 'setup', role: 'admin' });
    const employees = store.read().employees, id = employees[0].id;
    assert.equal(myAccount(store, admin, employees).employeeId, '');
    assert.equal(linkMyAccount(store, admin, id, employees).employeeName, employees[0].name);
    assert.equal(linkMyAccount(store, admin, '', employees).employeeId, '', 'unlinked again');
    assert.throws(() => linkMyAccount(store, { id: 'x', role: 'employee' }, id, employees), /already linked/);
  } finally { store.close(); }
});

test('a Maker can fill empty details and record government numbers, but not change details the employee provided (approved by HR)', async () => {
  const { lockFields, assertMakerCanChange, missingDetails } = await import('../src/field-locks.mjs');
  const { saveProfile } = await import('../src/profiles.mjs');
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const id = store.read().employees[0].id, maker = { username: 'mk', role: 'maker' }, hr = { username: 'hr1', role: 'hr' };
    saveProfile(store, maker, id, 'government', { sss: '34-1234567-8' });   // was refused before
    saveProfile(store, hr, id, 'personal', { firstName: 'Ana', lastName: 'Cruz', mobile: '09170000000' });
    assert.ok(missingDetails(store, id).includes('Date of birth'));
    lockFields(store, hr, id, ['contact.mobile']);
    assert.throws(() => assertMakerCanChange(store, maker, id, { contact: { mobile: '09179999999' } }), /provided by the employee/);
    assert.doesNotThrow(() => assertMakerCanChange(store, maker, id, { contact: { mobile: '09170000000' }, personal: { birthDate: '1990-01-01' } }), 'unchanged locked detail and an empty one are fine');
    assert.doesNotThrow(() => assertMakerCanChange(store, hr, id, { contact: { mobile: '09179999999' } }), 'HR can still change it');
  } finally { store.close(); }
});

test('work schedule: HR or Maker sets it on the 201 profile and attendance uses it (start time, rest days, hours)', async () => {
  const { saveSchedule, scheduleOf } = await import('../src/work-schedule.mjs');
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const id = store.read().employees[0].id, maker = { username: 'mk', role: 'maker' };
    const s = saveSchedule(store, maker, id, { start: '07:00', end: '19:00', hoursPerDay: 12, mealBreakMinutes: 0, restDays: [6], arrangement: 'Office' });
    assert.equal(s.text, '07:00–19:00 · 12 h · Sat off');
    const e = store.read().employees.find(x => x.id === id);
    assert.equal(e.scheduleStart, '07:00'); assert.deepEqual(e.restDays, [6]);
    assert.equal(scheduleOf(store, e).hoursPerDay, 12);
    assert.throws(() => saveSchedule(store, maker, id, { start: '09:00', end: '12:00', hoursPerDay: 8, mealBreakMinutes: 60, restDays: [0] }), /does not fit/);
    assert.throws(() => saveSchedule(store, { username: 'v', role: 'viewer' }, id, { start: '09:00', end: '18:00', hoursPerDay: 8, mealBreakMinutes: 60, restDays: [0] }), /permission/i);
  } finally { store.close(); }
});

test('a session ends after 5 minutes without use; active use keeps it going; the other device can then sign in', async () => {
  const { session } = await import('../src/auth.mjs');
  const store = new Store(':memory:'); store.write(completeState());
  try {
    await addUser(store, { username: 'worker2', password: 'Worker-pass-2026!', role: 'employee', employeeId: 'EMP-001' }, { username: 'boss', role: 'admin' });
    const first = await login(store, 'worker2', 'Worker-pass-2026!', 'a1'), cookie = `hr_session=${first.token}`;
    const expires = () => store.db.prepare('SELECT expires FROM sessions').get().expires;
    const left = expires() - Date.now();
    assert.ok(left > 4.9 * 60000 && left <= 5 * 60000, 'five minutes');
    store.db.prepare('UPDATE sessions SET expires=?').run(Date.now() + 60000);
    session(store, cookie); assert.ok(expires() - Date.now() < 61000, 'a background check does not extend it');
    session(store, cookie, { active: true }); assert.ok(expires() - Date.now() > 4.9 * 60000, 'active use extends it to five minutes again');
    store.db.prepare('UPDATE sessions SET expires=?').run(Date.now() - 1);
    assert.equal(session(store, cookie, { active: true }), null, 'signed out after 5 minutes unused');
    assert.ok((await login(store, 'worker2', 'Worker-pass-2026!', 'a2')).token, 'another device can sign in once the unused one has timed out');
  } finally { store.close(); }
});

test('a staff member linked to their own record can still get one employee login', async () => {
  const { linkMyAccount } = await import('../src/auth.mjs');
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const setup = { username: 'setup', role: 'admin' }, employees = store.read().employees, id = employees[0].id;
    const boss = await addUser(store, { username: 'boss9', password: 'Admin-pass-2026!!', role: 'admin' }, setup);
    linkMyAccount(store, boss, id, employees);
    assert.ok(await addUser(store, { username: 'boss9.emp', password: 'Employee-pass-26', role: 'employee', employeeId: id }, setup), 'admin link does not block the employee login');
    await assert.rejects(addUser(store, { username: 'boss9.emp2', password: 'Employee-pass-26', role: 'employee', employeeId: id }, setup), /already has an employee login: boss9.emp/);
  } finally { store.close(); }
});
