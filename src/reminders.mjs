// Attendance reminders in Philippine Time (Asia/Manila, UTC+8): 5 minutes before the scheduled start ("please time
// in", only if not yet timed in) and 5 minutes after the scheduled end ("please time out", only if timed in and not
// out). Skipped on rest days, holidays, approved full-day leave and work-from-home days counted present without time
// in. Each reminder is sent once (hr_counters), goes to the employee's bell and, where enabled, to their devices by
// Web Push. Reminders never record a time in or time out.
import { z } from 'zod';
import { AppError } from './service.mjs';
import { scheduleOn, isRest, ruleOn } from './engine.mjs';
import { sendPush, vapidKeys, allowedEndpoint } from './web-push.mjs';

export const LEAD_MINUTES = 5;
const WINDOW = { in: 55, out: 115 };   // a reminder missed (e.g. server restarting) is still sent within this many minutes
const manila = now => new Date(now.getTime() + 8 * 3600000).toISOString();
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock12 = t => { const h = Number(t.slice(0, 2)), m = t.slice(3, 5); return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`; };
const profileOf = (state, id) => state.employeeProfiles?.find(p => p.employeeId === id && p.section === 'attendance') || {};

// The reminders due at this moment that were not sent yet.
export function dueReminders(store, now = new Date()) {
  const state = store.read(), local = manila(now), day = local.slice(0, 10), minute = toMin(local.slice(11, 16));
  const withLogin = new Set(store.db.prepare("SELECT employee_id FROM users WHERE employee_id IS NOT NULL AND role IN ('employee','dept_manager') AND disabled=0").all().map(r => r.employee_id));
  const holiday = state.holidays.some(h => h.date === day && h.kind !== 'ordinary');
  const due = [];
  for (const e of state.employees) {
    if (!withLogin.has(e.id) || e.draft || e.archived || e.active === false || !e.startDate || e.startDate > day || (e.endDate && e.endDate < day)) continue;
    if (holiday || isRest(e, day)) continue;
    if (state.leaves.some(l => l.employeeId === e.id && l.status === 'approved' && (l.countedDates || []).includes(day) && !(l.partialDates || []).includes(day))) continue;
    const profile = profileOf(state, e.id), s = scheduleOn(e, profile, day, ruleOn(state, day));
    if (s.autoPresent || !s.start) continue;
    const start = toMin(s.start), end = s.end ? toMin(s.end) + (toMin(s.end) <= start ? 1440 : 0) : start + Math.round(s.hoursPerDay * 60) + (s.mealBreakMinutes ?? 60);
    const events = store.db.prepare('SELECT data FROM clock_events WHERE employee_id=? AND work_date=?').all(e.id, day).map(r => JSON.parse(r.data));
    const timedIn = events.some(x => x.kind === 'in') || state.attendance.some(a => a.employeeId === e.id && a.date === day);
    const timedOut = events.some(x => x.kind === 'out') || state.attendance.some(a => a.employeeId === e.id && a.date === day && a.timeOut);
    const inAt = start - LEAD_MINUTES, outAt = end + LEAD_MINUTES;
    if (!timedIn && minute >= inAt && minute <= inAt + WINDOW.in) due.push({ employeeId: e.id, date: day, kind: 'in', message: `Work starts at ${clock12(s.start)}. Please remember to time in.` });
    if (outAt < 1440 && timedIn && !timedOut && minute >= outAt && minute <= outAt + WINDOW.out) due.push({ employeeId: e.id, date: day, kind: 'out', message: 'Please remember to time out before leaving.' });
  }
  return due.filter(r => !store.db.prepare('SELECT 1 FROM hr_counters WHERE key=?').get(reminderKey(r)));
}
const reminderKey = r => `reminder:${r.date}:${r.employeeId}:${r.kind}`;

// Sends the due reminders once each: bell notice always, device notifications where the employee turned them on.
export async function runReminders(store, now = new Date(), { push = sendPush, subject } = {}) {
  const sent = [];
  for (const r of dueReminders(store, now)) {
    const claimed = store.db.prepare('INSERT OR IGNORE INTO hr_counters(key,value) VALUES(?,1)').run(reminderKey(r)).changes;
    if (!claimed) continue;   // another check already sent it
    store.notify(r.employeeId, `⏰ ${r.message}`);
    await pushTo(store, r.employeeId, { title: 'GDS HR · Attendance reminder', body: r.message, tag: `attendance-${r.kind}-${r.date}`, url: '/' }, { push, subject });
    sent.push(r);
  }
  return sent;
}
async function pushTo(store, employeeId, message, { push = sendPush, subject } = {}) {
  const subs = store.db.prepare('SELECT endpoint, data FROM push_subscriptions WHERE employee_id=?').all(employeeId).map(r => ({ endpoint: r.endpoint, ...JSON.parse(r.data) }));
  const results = [];
  for (const sub of subs) {
    const result = await push(store, sub, { ...message, sound: sub.prefs?.sound !== false, vibrate: sub.prefs?.vibrate !== false }, subject ? { subject } : {});
    if (result === 'gone') store.db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(sub.endpoint);
    results.push(result);
  }
  return results;
}

// ---------- The employee's own devices ----------
const ownEmployee = actor => { if (actor?.role !== 'employee' || !actor.employeeId) throw new AppError('Only employee accounts receive attendance reminders.', 403); return actor.employeeId; };
const subscriptionSchema = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(10).max(100) }).strict(), expirationTime: z.number().nullable().optional() }).strict();
const prefsSchema = z.object({ sound: z.boolean().default(true), vibrate: z.boolean().default(true) }).strict();
export function pushStatus(store, actor) {
  const employeeId = ownEmployee(actor);
  return { publicKey: vapidKeys(store).publicKey, devices: store.db.prepare('SELECT endpoint, data FROM push_subscriptions WHERE employee_id=?').all(employeeId).map(r => ({ endpoint: r.endpoint, prefs: JSON.parse(r.data).prefs })), leadMinutes: LEAD_MINUTES };
}
export function savePushSubscription(store, actor, input) {
  const employeeId = ownEmployee(actor);
  const value = z.object({ subscription: subscriptionSchema, prefs: prefsSchema.default({ sound: true, vibrate: true }) }).strict().parse(input);
  if (!allowedEndpoint(value.subscription.endpoint)) throw new AppError('This browser\'s notification service is not supported.');
  const data = { keys: value.subscription.keys, prefs: value.prefs, savedAt: new Date().toISOString() };
  store.db.prepare('INSERT INTO push_subscriptions(endpoint,employee_id,user_id,data) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET employee_id=excluded.employee_id, user_id=excluded.user_id, data=excluded.data').run(value.subscription.endpoint, employeeId, String(actor.id || actor.username), JSON.stringify(data));
  return { saved: true, prefs: value.prefs };
}
export function removePushSubscription(store, actor, input) {
  const employeeId = ownEmployee(actor), { endpoint } = z.object({ endpoint: z.string().max(1000) }).strict().parse(input);
  store.db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND employee_id=?').run(endpoint, employeeId);
  return { removed: true };
}
export async function sendTestReminder(store, actor, options = {}) {
  const employeeId = ownEmployee(actor);
  const results = await pushTo(store, employeeId, { title: 'GDS HR · Test reminder', body: 'Attendance reminders are working on this device. This test did not record any time in or out.', tag: 'attendance-test', url: '/' }, options);
  return { devices: results.length, sent: results.filter(r => r === 'sent').length };
}
