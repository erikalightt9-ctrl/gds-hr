import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState } from './helpers.mjs';
import { addUser } from '../src/auth.mjs';
import { messageContacts, unreadMessages, conversation, sendMessage, onChat } from '../src/messages.mjs';

test('users message each other one-to-one; only the two people can read it; unread counts and live notices', async () => {
  const store = new Store(':memory:'), s = completeState(); s.employees.push({ ...s.employees[0], id: 'EMP-002', name: 'Second, Employee' }); store.write(s);
  try {
    const setup = { username: 'setup', role: 'admin' };
    const a = await addUser(store, { username: 'anna', password: 'Anna-pass-2026', role: 'hr' }, setup);
    const b = await addUser(store, { username: 'ben', password: 'Ben-pass-20266', role: 'employee', employeeId: 'EMP-001' }, setup);
    const c = await addUser(store, { username: 'carl', password: 'Carl-pass-2026', role: 'admin' }, setup);
    const heard = []; const stop = onChat(ids => heard.push(ids));
    sendMessage(store, a, b.id, { body: '  Hello Ben  ' });
    assert.deepEqual(heard.at(-1).sort(), [a.id, b.id].sort(), 'sender and recipient screens are told');
    assert.equal(unreadMessages(store, b).unread, 1);
    const list = messageContacts(store, b);
    assert.equal(list.contacts[0].id, a.id, 'latest conversation first');
    assert.equal(list.contacts[0].unread, 1);
    assert.ok(!list.contacts.some(x => x.id === b.id), 'not yourself');
    const thread = conversation(store, b, a.id);
    assert.equal(thread.messages[0].body, 'Hello Ben'); assert.equal(thread.messages[0].mine, false);
    assert.equal(unreadMessages(store, b).unread, 0, 'opening it marks it read');
    assert.equal(conversation(store, a, b.id).messages[0].read, true, 'the sender sees it was seen');
    assert.equal(conversation(store, c, a.id).messages.length, 0, 'an administrator does not see other people\'s conversations');
    assert.throws(() => sendMessage(store, a, b.id, { body: '   ' }), /Type a message/);
    assert.throws(() => sendMessage(store, a, b.id, { body: 'x'.repeat(2001) }), /under 2000/);
    assert.throws(() => sendMessage(store, a, '00000000-0000-0000-0000-000000000000', { body: 'hi' }), /not a user/);
    store.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(c.id);
    assert.throws(() => sendMessage(store, a, c.id, { body: 'hi' }), /not a user/, 'disabled logins cannot be messaged');
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE after_json LIKE '%Hello Ben%'").get().n, 0, 'content is not copied into the audit trail');
    const d = await addUser(store, { username: 'dina', password: 'Dina-pass-2026', role: 'employee', employeeId: 'EMP-002' }, setup);
    assert.ok(!messageContacts(store, b).contacts.some(x => x.id === d.id), 'employees do not see other employees');
    assert.throws(() => sendMessage(store, b, d.id, { body: 'hi' }), /not a user/, 'employee to employee is not allowed');
    assert.ok(messageContacts(store, a).contacts.some(x => x.id === d.id), 'HR sees every employee');
    const mk = await addUser(store, { username: 'mike', password: 'Mike-pass-2026', role: 'maker' }, setup);
    assert.ok(messageContacts(store, b).contacts.some(x => x.id === mk.id), 'an employee can message Maker');
    assert.ok(sendMessage(store, b, a.id, { body: 'Thanks HR' }).id, 'an employee can message HR');
    stop();
  } finally { store.close(); }
});

test('daily attendance record prints one date as a PDF (and Excel) for staff', async () => {
  const { buildReport } = await import('../src/reports.mjs');
  const store = new Store(':memory:'); store.write(completeState());
  try {
    const day = store.read().attendance[0]?.date || '2026-09-15';
    const pdf = buildReport(store, { username: 'hr1', role: 'hr' }, 'daily-attendance', 'pdf', { date: day });
    assert.equal(pdf.type, 'application/pdf'); const text = pdf.body.toString('latin1');
    assert.ok(text.includes('Daily attendance record') && text.includes(day), 'title and the chosen date');
    assert.equal(buildReport(store, { username: 'hr1', role: 'hr' }, 'daily-attendance', 'xlsx', { date: day }).type.includes('spreadsheet'), true);
    assert.throws(() => buildReport(store, { username: 'e', role: 'employee' }, 'daily-attendance', 'pdf', { date: day }), /cannot download/);
  } finally { store.close(); }
});
