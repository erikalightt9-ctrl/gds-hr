// Feishu (Lark) group alerts: HR notices are posted to an HR group chat through a Feishu "Custom bot" webhook.
//   - Sent: every notice addressed to HR (store.notify(null, …): attendance requests, explanations, overtime, documents,
//     loans, off-site time in/out, blocked sign-ins, late time ins …) and new leave applications.
//   - Never sent: an employee's own notices (their decisions, payslips, memos).
//   - Messages arriving within a few seconds go out as one message, so a busy minute does not flood the chat.
//   - Posting runs after the HR action has been saved and never fails it; the last error is shown in Settings.
// The webhook address and the optional signing secret are kept in the private database and never shown back in full.
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';

const HOOK = /^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]{8,80}$/;
const MAX_LINES = 20;

export function validateWebhook(url) {
  const value = String(url || '').trim();
  if (!HOOK.test(value)) throw new AppError('Paste the Feishu custom bot webhook address (https://open.feishu.cn/open-apis/bot/v2/hook/…).', 400);
  return value;
}
// Feishu "Signature verification": base64(HMAC-SHA256 with key "timestamp\nsecret" over an empty message).
export const feishuSign = (timestamp, secret) => createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');

const ready = new WeakSet();
function config(store) {
  if (!ready.has(store)) { store.db.exec('CREATE TABLE IF NOT EXISTS integrations (name TEXT PRIMARY KEY, data TEXT NOT NULL)'); ready.add(store); }
  return JSON.parse(store.db.prepare("SELECT data FROM integrations WHERE name='feishu'").get()?.data || '{}');
}
function writeConfig(store, value) {
  config(store);
  store.db.prepare("INSERT INTO integrations(name, data) VALUES('feishu', ?) ON CONFLICT(name) DO UPDATE SET data=excluded.data").run(JSON.stringify(value));
}
const mask = url => (url ? `${url.slice(0, url.lastIndexOf('/') + 1)}…${url.slice(-4)}` : '');

export function feishuStatus(store, actor) {
  permit(actor, ['admin']);
  const c = config(store);
  return { configured: !!c.webhook, enabled: !!c.enabled && !!c.webhook, webhook: mask(c.webhook), hasSecret: !!c.secret, lastSentAt: c.lastSentAt || '', lastError: c.lastError || '', lastErrorAt: c.lastErrorAt || '' };
}
const saveSchema = z.object({ webhook: z.string().max(300).optional(), secret: z.string().max(200).optional(), removeSecret: z.boolean().optional(), enabled: z.boolean().optional(), remove: z.boolean().optional() }).strict();
export function saveFeishu(store, actor, input) {
  permit(actor, ['admin']);
  const v = saveSchema.parse(input), before = config(store);
  if (v.remove) { writeConfig(store, {}); store.log(actor, 'remove', 'integrations', 'feishu', { configured: !!before.webhook }, null); return feishuStatus(store, actor); }
  const next = { ...before };
  if (v.webhook?.trim()) next.webhook = validateWebhook(v.webhook);
  if (v.secret?.trim()) next.secret = v.secret.trim();
  if (v.removeSecret) delete next.secret;
  if (v.enabled !== undefined) next.enabled = v.enabled;
  if (next.enabled && !next.webhook) throw new AppError('Paste the Feishu webhook address first.', 400);
  writeConfig(store, next);
  store.log(actor, 'save', 'integrations', 'feishu', { enabled: !!before.enabled, configured: !!before.webhook, signed: !!before.secret }, { enabled: !!next.enabled, configured: !!next.webhook, signed: !!next.secret });
  return feishuStatus(store, actor);
}

async function post(store, text, fetchImpl) {
  const c = config(store);
  if (!c.webhook) return { ok: false, error: 'Not set up.' };
  const body = { msg_type: 'text', content: { text } };
  if (c.secret) { const timestamp = String(Math.floor(Date.now() / 1000)); Object.assign(body, { timestamp, sign: feishuSign(timestamp, c.secret) }); }
  let error = '';
  try {
    const response = await fetchImpl(c.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const reply = await response.json().catch(() => ({}));
    if (!response.ok || (reply.code ?? reply.StatusCode ?? 0) !== 0) error = `Feishu replied: ${reply.msg || reply.StatusMessage || response.status}`;
  } catch (e) { error = `Could not reach Feishu: ${e.message}`; }
  const now = new Date().toISOString(), latest = config(store);
  writeConfig(store, error ? { ...latest, lastError: error, lastErrorAt: now } : { ...latest, lastSentAt: now, lastError: '', lastErrorAt: '' });
  return error ? { ok: false, error } : { ok: true };
}

// Resolve person identifiers for outgoing alerts only; stored HR notices remain unchanged.
export function nameFeishuAlert(store, line) {
  const text = String(line);
  try {
    const stateRow = store.db.prepare('SELECT data FROM state WHERE id=1').get();
    const employees = JSON.parse(stateRow?.data || '{}').employees || [];
    for (const employee of [...employees].sort((a, b) => String(b.id).length - String(a.id).length)) {
      const id = String(employee.id || '');
      if (!id || !text.startsWith(id)) continue;
      const rest = text.slice(id.length);
      if (!/^(?:\s|:)/.test(rest)) continue;
      const name = typeof employee.name === 'string' && employee.name.trim() ? employee.name.trim().replace(/[\r\n]+/g, ' ') : 'Unknown employee';
      if (rest.startsWith(':')) return name + rest;
      const detail = rest.trimStart();
      if (detail.startsWith(name + ':')) return detail;
      return name + ' ' + detail;
    }
    // Device alerts may identify a user account rather than an employee.
    const colon = text.indexOf(':');
    if (colon > 0 && /sign-in from a new phone/.test(text)) {
      const key = text.slice(0, colon);
      const user = store.db.prepare('SELECT display_name, employee_id FROM users WHERE username=?').get(key);
      const linked = employees.find(e => e.id === user?.employee_id);
      const name = linked?.name || user?.display_name;
      return (typeof name === 'string' && name.trim() ? name.trim().replace(/[\r\n]+/g, ' ') : 'Unknown user') + text.slice(colon);
    }
    // Retired/missing employee records must not become guessed names.
    if (/^(?:\d{4}-\d{3,}|EMP-[A-Za-z0-9-]+)(?=:|\s)/.test(text)) {
      return text.replace(/^(?:\d{4}-\d{3,}|EMP-[A-Za-z0-9-]+)(?:\s+[^:]+)?(?=:)/, 'Unknown employee');
    }
    return text;
  } catch {
    // Identity lookup failure must never leak an ID-only person label or block an HR action.
    return text.replace(/^(?:\d{4}-\d{3,}|EMP-[A-Za-z0-9-]+)(?:\s+[^:]+)?(?=:)/, 'Unknown employee');
  }
}

// Hooks HR notices and leave applications on this store. Safe to call again (the latest settings are used).
export function connectFeishu(store, { fetchImpl = globalThis.fetch, delayMs = 3000, origin = '' } = {}) {   // no title line: each alert is only its own line
  const queue = [];
  let timer = null, pending = Promise.resolve();
  const flush = () => {
    clearTimeout(timer); timer = null;
    const lines = queue.splice(0);
    if (!lines.length) return pending;
    const c = config(store);
    if (!c.enabled || !c.webhook) return pending;
    const shown = lines.slice(0, MAX_LINES), more = lines.length - shown.length;
    const text = `${shown.map(l => `• ${l}`).join('\n')}${more ? `\n• … and ${more} more` : ''}${origin ? `\nOpen: ${origin}` : ''}`;
    pending = pending.then(() => post(store, text, fetchImpl)).catch(() => {});
    return pending;
  };
  const enqueue = line => {
    try {
      if (!config(store).enabled) return;
      queue.push(nameFeishuAlert(store, line).slice(0, 500));
      if (!timer) { timer = setTimeout(flush, delayMs); timer.unref?.(); }
    } catch { /* an alert must never break the HR action that triggered it */ }
  };
  if (!store.feishuOriginal) {
    store.feishuOriginal = { notify: store.notify.bind(store), log: store.log.bind(store) };
    store.notify = (employeeId, message) => { store.feishuOriginal.notify(employeeId, message); if (employeeId === null) store.feishuHook?.(message); };
    store.log = (actor, action, kind, id, before, after) => {
      const result = store.feishuOriginal.log(actor, action, kind, id, before, after);
      if (kind === 'leaves' && action === 'apply' && after) store.feishuHook?.(`${after.employeeId}: new leave application ${after.reference || ''} ${after.startDate} → ${after.endDate} (${after.days ?? '?'} day${after.days === 1 ? '' : 's'}). Review it in Leave Management.`.replace(/ {2,}/g, ' '));
      return result;
    };
  }
  store.feishuHook = enqueue;
  return { flush };
}

export async function sendFeishuTest(store, actor, { fetchImpl = globalThis.fetch, title = 'GDS HR' } = {}) {
  permit(actor, ['admin']);
  if (!config(store).webhook) throw new AppError('Paste the Feishu webhook address first.', 400);
  return post(store, `【${title}】\n• Test message from the HR system (${actor.username}). HR alerts will appear in this chat.`, fetchImpl);
}
