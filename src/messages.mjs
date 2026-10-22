// Messages between the people who use this system (one-to-one). Staff can message anyone; an employee can message
// HR, Maker and the administrator only (employee to employee is not allowed).
// Only the two people in a conversation can read it; administrators cannot open other people's conversations.
// The content is not copied into the audit trail.
// "Everyone": one conversation every user reads (announcements). Only HR, Admin and Maker post there, so it never
// becomes an employee-to-employee chat; employees reply to HR privately.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './service.mjs';
import { staffNames } from './staff-names.mjs';
import { ROLE_LABELS } from './roles.mjs';

// Roles an employee may message.
const EMPLOYEE_CAN_MESSAGE = ['admin', 'hr', 'hr_staff', 'maker'];
const MAX_LENGTH = 2000, PER_MINUTE = 30, HISTORY = 300;
export const EVERYONE = 'everyone';
const CAN_POST_EVERYONE = ['admin', 'hr', 'hr_staff', 'maker'];
const ensure = store => store.db.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, from_user TEXT NOT NULL, to_user TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT);
  CREATE INDEX IF NOT EXISTS messages_pair ON messages(from_user, to_user, created_at);
  CREATE INDEX IF NOT EXISTS messages_unread ON messages(to_user, read_at);
  CREATE TABLE IF NOT EXISTS message_group_reads (user_id TEXT PRIMARY KEY, read_at TEXT NOT NULL);`);
const groupReadAt = (store, userId) => store.db.prepare('SELECT read_at FROM message_group_reads WHERE user_id=?').get(userId)?.read_at || '';
const groupUnread = (store, actor) => store.db.prepare('SELECT COUNT(*) n FROM messages WHERE to_user=? AND from_user<>? AND created_at>?').get(EVERYONE, actor.id, groupReadAt(store, actor.id)).n;

// Live delivery: the server's event stream tells the sender's and recipient's screens that something arrived.
const listeners = new Set();
export const onChat = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const announce = userIds => { for (const l of listeners) { try { l(userIds); } catch { /* a closed screen must not stop delivery */ } } };

const sent = new Map();   // user id -> send times in the last minute (flood guard)
function guard(userId) {
  const now = Date.now(), recent = (sent.get(userId) || []).filter(t => now - t < 60000);
  if (recent.length >= PER_MINUTE) throw new AppError('You are sending messages too quickly. Wait a minute and try again.', 429);
  sent.set(userId, [...recent, now]);
}
function people(store, actor) {
  const names = staffNames(store);
  return store.db.prepare('SELECT id, username, role FROM users WHERE disabled=0 AND id<>? ORDER BY username').all(actor.id)
    .filter(u => actor.role !== 'employee' || EMPLOYEE_CAN_MESSAGE.includes(u.role))
    .map(u => ({ id: u.id, name: names[u.username] || u.username, username: u.username, role: ROLE_LABELS[u.role] || u.role }));
}
const contact = (store, actor, id) => {
  const person = people(store, actor).find(p => p.id === id);
  if (!person) throw new AppError('That person is not a user of this system.', 404);
  return person;
};

export function messageContacts(store, actor) {
  ensure(store);
  const last = new Map(), unread = new Map();
  for (const m of store.db.prepare('SELECT from_user, to_user, body, created_at FROM messages WHERE (from_user=? OR to_user=?) AND to_user<>? ORDER BY created_at').all(actor.id, actor.id, EVERYONE)) {
    const other = m.from_user === actor.id ? m.to_user : m.from_user;
    last.set(other, { body: m.body.slice(0, 80), at: m.created_at, mine: m.from_user === actor.id });
  }
  for (const r of store.db.prepare('SELECT from_user, COUNT(*) n FROM messages WHERE to_user=? AND read_at IS NULL GROUP BY from_user').all(actor.id)) unread.set(r.from_user, r.n);
  const contacts = people(store, actor).map(p => ({ ...p, last: last.get(p.id) || null, unread: unread.get(p.id) || 0 }))
    .sort((a, b) => (b.last?.at || '').localeCompare(a.last?.at || '') || a.name.localeCompare(b.name));
  const lastGroup = store.db.prepare('SELECT from_user, body, created_at FROM messages WHERE to_user=? ORDER BY created_at DESC LIMIT 1').get(EVERYONE), gUnread = groupUnread(store, actor);
  const everyone = { id: EVERYONE, name: 'Everyone', username: 'everyone', role: 'All staff · announcements', group: true, last: lastGroup ? { body: lastGroup.body.slice(0, 80), at: lastGroup.created_at, mine: lastGroup.from_user === actor.id } : null, unread: gUnread };
  return { contacts: [everyone, ...contacts], unread: [...unread.values()].reduce((s, n) => s + n, 0) + gUnread };
}
export function unreadMessages(store, actor) {
  ensure(store);
  return { unread: store.db.prepare('SELECT COUNT(*) n FROM messages WHERE to_user=? AND read_at IS NULL').get(actor.id).n + groupUnread(store, actor) };
}
// Opening a conversation marks what the other person sent as read.
export function conversation(store, actor, otherId) {
  ensure(store);
  if (otherId === EVERYONE) {
    const names = staffNames(store), users = new Map(store.db.prepare('SELECT id, username FROM users').all().map(u => [u.id, names[u.username] || u.username]));
    store.db.prepare('INSERT INTO message_group_reads(user_id, read_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET read_at=excluded.read_at').run(actor.id, new Date().toISOString());
    const rows = store.db.prepare('SELECT id, from_user, body, created_at FROM messages WHERE to_user=? ORDER BY created_at DESC LIMIT ?').all(EVERYONE, HISTORY).reverse();
    announce([actor.id]);
    return { contact: { id: EVERYONE, name: 'Everyone', role: 'All staff · announcements', group: true }, canPost: CAN_POST_EVERYONE.includes(actor.role), messages: rows.map(m => ({ id: m.id, mine: m.from_user === actor.id, from: users.get(m.from_user) || '', body: m.body, at: m.created_at, read: false })) };
  }
  const person = contact(store, actor, otherId);
  const marked = store.db.prepare('UPDATE messages SET read_at=? WHERE from_user=? AND to_user=? AND read_at IS NULL').run(new Date().toISOString(), otherId, actor.id).changes;
  const rows = store.db.prepare('SELECT id, from_user, body, created_at, read_at FROM messages WHERE (from_user=? AND to_user=?) OR (from_user=? AND to_user=?) ORDER BY created_at DESC LIMIT ?').all(actor.id, otherId, otherId, actor.id, HISTORY);
  if (marked) announce([actor.id]);
  return { contact: person, messages: rows.reverse().map(m => ({ id: m.id, mine: m.from_user === actor.id, body: m.body, at: m.created_at, read: !!m.read_at })) };
}
export function sendMessage(store, actor, otherId, input) {
  ensure(store);
  const { body } = z.object({ body: z.string().trim().min(1, 'Type a message.').max(MAX_LENGTH, `Keep a message under ${MAX_LENGTH} characters.`) }).strict().parse(input);
  if (otherId === EVERYONE) {
    if (!CAN_POST_EVERYONE.includes(actor.role)) throw new AppError('Only HR can post to everyone. Reply to HR in a private message.', 403);
  } else contact(store, actor, otherId);
  guard(actor.id);
  const message = { id: randomUUID(), from_user: actor.id, to_user: otherId, body, created_at: new Date().toISOString() };
  store.db.prepare('INSERT INTO messages(id, from_user, to_user, body, created_at) VALUES(?,?,?,?,?)').run(message.id, message.from_user, message.to_user, message.body, message.created_at);
  announce(otherId === EVERYONE ? store.db.prepare('SELECT id FROM users WHERE disabled=0').all().map(u => u.id) : [actor.id, otherId]);
  return { id: message.id, mine: true, body, at: message.created_at, read: false };
}
