// Sign in with Feishu (Lark) — OAuth 2.0 authorization code with a separate "GDS HR System" Feishu app.
//   - An administrator saves the app's App ID and App Secret in Settings (secret kept in the private DB, never shown).
//   - Each person links their own Feishu account from Account & security while signed in with their password; the
//     system never matches Feishu accounts by name or email. One Feishu account ↔ one HR account.
//   - A linked account can then sign in with Feishu alone. Administrator accounts keep password sign-in only.
//   - The HR system stays in control of every record; Feishu only confirms who the person is.
// Feishu addresses: accounts.feishu.cn …/authen/v1/authorize, open.feishu.cn …/authen/v2/oauth/token and
// …/authen/v1/user_info (Lark: larksuite.com). The callback address registered in the Feishu app is
// <HR_ORIGIN>/api/login/feishu/callback.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';

const DOMAINS = {
  feishu: { accounts: 'https://accounts.feishu.cn', open: 'https://open.feishu.cn' },
  lark: { accounts: 'https://accounts.larksuite.com', open: 'https://open.larksuite.com' },
};
const STATE_MS = 10 * 60000;
const NO_FEISHU_ROLES = ['admin'];
export const feishuCallbackUrl = origin => `${origin}/api/login/feishu/callback`;

const ready = new WeakSet();
function tables(store) {
  if (ready.has(store)) return;
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (name TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feishu_links (user_id TEXT PRIMARY KEY, open_id TEXT NOT NULL UNIQUE, union_id TEXT, tenant_key TEXT, name TEXT, linked_at TEXT NOT NULL, last_used TEXT);
    CREATE TABLE IF NOT EXISTS feishu_states (state TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT, expires INTEGER NOT NULL);`);
  ready.add(store);
}
function config(store) {
  tables(store);
  return JSON.parse(store.db.prepare("SELECT data FROM integrations WHERE name='feishu-login'").get()?.data || '{}');
}
function writeConfig(store, value) {
  tables(store);
  store.db.prepare("INSERT INTO integrations(name, data) VALUES('feishu-login', ?) ON CONFLICT(name) DO UPDATE SET data=excluded.data").run(JSON.stringify(value));
}
const usable = c => !!(c.enabled && c.appId && c.appSecret);

// ---------- Settings (admin) ----------
export function feishuLoginStatus(store, actor, { origin }) {
  permit(actor, ['admin']);
  const c = config(store);
  return { configured: !!(c.appId && c.appSecret), enabled: usable(c), appId: c.appId || '', hasSecret: !!c.appSecret, domain: c.domain || 'feishu', callbackUrl: feishuCallbackUrl(origin), linked: store.db.prepare('SELECT COUNT(*) AS n FROM feishu_links').get().n };
}
const saveSchema = z.object({ appId: z.string().trim().max(64).optional(), appSecret: z.string().trim().max(200).optional(), domain: z.enum(['feishu', 'lark']).optional(), enabled: z.boolean().optional(), remove: z.boolean().optional() }).strict();
export function saveFeishuLogin(store, actor, input, { origin = '' } = {}) {
  permit(actor, ['admin']);
  const v = saveSchema.parse(input), before = config(store);
  if (v.remove) { writeConfig(store, {}); store.log(actor, 'remove', 'integrations', 'feishu-login', { configured: !!before.appId }, null); return feishuLoginStatus(store, actor, { origin }); }
  const next = { ...before };
  if (v.appId) { if (!/^cli_[A-Za-z0-9]{8,40}$/.test(v.appId)) throw new AppError('Enter the App ID from the Feishu app (it starts with cli_).', 400); next.appId = v.appId; }
  if (v.appSecret) next.appSecret = v.appSecret;
  if (v.domain) next.domain = v.domain;
  if (v.enabled !== undefined) next.enabled = v.enabled;
  if (next.enabled && !(next.appId && next.appSecret)) throw new AppError('Enter the App ID and App Secret first.', 400);
  writeConfig(store, next);
  store.log(actor, 'save', 'integrations', 'feishu-login', { enabled: !!before.enabled, appId: before.appId || '', domain: before.domain || 'feishu' }, { enabled: !!next.enabled, appId: next.appId || '', domain: next.domain || 'feishu', secretChanged: !!v.appSecret });
  return feishuLoginStatus(store, actor, { origin });
}
export function feishuLoginAvailable(store) { return { enabled: usable(config(store)) }; }

// ---------- Start: the address to send the browser to ----------
export function startFeishu(store, { kind, user = null }, { origin }) {
  const c = config(store);
  if (!usable(c)) throw new AppError('Feishu sign-in is not set up yet. Ask HR.', 400);
  if (kind === 'link') {
    if (!user) throw new AppError('Please sign in.', 401);
    if (NO_FEISHU_ROLES.includes(user.role)) throw new AppError('Administrator accounts sign in with their password only.', 403);
  }
  const state = randomBytes(32).toString('hex');
  store.db.prepare('DELETE FROM feishu_states WHERE expires < ?').run(Date.now());
  store.db.prepare('INSERT INTO feishu_states VALUES(?,?,?,?)').run(state, kind === 'link' ? 'link' : 'login', kind === 'link' ? user.id : null, Date.now() + STATE_MS);
  const url = new URL('/open-apis/authen/v1/authorize', DOMAINS[c.domain || 'feishu'].accounts);
  url.search = new URLSearchParams({ client_id: c.appId, response_type: 'code', redirect_uri: feishuCallbackUrl(origin), state }).toString();
  return url.toString();
}

// ---------- Callback: exchange the code, read who it is, then link or sign in ----------
async function feishuIdentity(c, code, origin, fetchImpl) {
  const base = DOMAINS[c.domain || 'feishu'].open;
  let token;
  try {
    const r = await fetchImpl(`${base}/open-apis/authen/v2/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ grant_type: 'authorization_code', client_id: c.appId, client_secret: c.appSecret, code, redirect_uri: feishuCallbackUrl(origin) }), signal: AbortSignal.timeout(10000) });
    token = await r.json();
  } catch { throw new AppError('Feishu could not be reached. Try again.', 502); }
  if (!token?.access_token || (token.code && token.code !== 0)) throw new AppError(`Feishu sign-in failed: ${token?.error_description || token?.msg || token?.error || 'no access token'}.`, 401);
  let info;
  try {
    const r = await fetchImpl(`${base}/open-apis/authen/v1/user_info`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000) });
    info = await r.json();
  } catch { throw new AppError('Feishu could not be reached. Try again.', 502); }
  const d = info?.data;
  if (info?.code !== 0 || !d?.open_id) throw new AppError(`Feishu sign-in failed: ${info?.msg || 'no user information'}.`, 401);
  return { openId: String(d.open_id), unionId: d.union_id ? String(d.union_id) : null, tenantKey: d.tenant_key ? String(d.tenant_key) : null, name: String(d.name || d.en_name || '').slice(0, 120) };
}
export async function finishFeishu(store, { code, state }, { origin, fetchImpl = fetch }) {
  const c = config(store);
  if (!usable(c)) throw new AppError('Feishu sign-in is not set up yet. Ask HR.', 400);
  const row = typeof state === 'string' && /^[a-f0-9]{64}$/.test(state) ? store.db.prepare('SELECT * FROM feishu_states WHERE state=?').get(state) : null;
  if (!row || row.expires < Date.now()) throw new AppError('The Feishu sign-in expired or was not found. Try again.', 401);
  store.db.prepare('DELETE FROM feishu_states WHERE state=?').run(state);
  if (typeof code !== 'string' || !code || code.length > 512) throw new AppError('Feishu did not return a sign-in code. Try again.', 400);
  const who = await feishuIdentity(c, code, origin, fetchImpl), now = new Date().toISOString();

  if (row.kind === 'link') {
    const user = store.db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
    if (!user || user.disabled) throw new AppError('This account is not available.', 403);
    if (NO_FEISHU_ROLES.includes(user.role)) throw new AppError('Administrator accounts sign in with their password only.', 403);
    const taken = store.db.prepare('SELECT user_id FROM feishu_links WHERE open_id=?').get(who.openId);
    if (taken && taken.user_id !== user.id) throw new AppError('This Feishu account is already linked to another HR account. Ask HR.', 409);
    store.db.prepare('INSERT INTO feishu_links VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET open_id=excluded.open_id, union_id=excluded.union_id, tenant_key=excluded.tenant_key, name=excluded.name, linked_at=excluded.linked_at').run(user.id, who.openId, who.unionId, who.tenantKey, who.name, now);
    const actor = { id: user.id, username: user.username, role: user.role };
    store.log(actor, 'feishu-link', 'users', user.id, null, { feishuName: who.name });
    if (user.employee_id) store.notify(user.employee_id, `Your Feishu account (${who.name || 'Feishu'}) is now linked. You can sign in with Feishu. If this was not you, tell HR at once.`);
    return { kind: 'link', user };
  }
  const link = store.db.prepare('SELECT * FROM feishu_links WHERE open_id=?').get(who.openId);
  if (!link) throw new AppError('This Feishu account is not linked to an HR account. Sign in with your username and password, then link Feishu in Account & security.', 401);
  const user = store.db.prepare('SELECT * FROM users WHERE id=?').get(link.user_id);
  if (!user) throw new AppError('This Feishu account is not linked to an HR account.', 401);
  if (user.disabled) throw new AppError('This account is disabled. Contact HR.', 403);
  if (NO_FEISHU_ROLES.includes(user.role)) throw new AppError('Administrator accounts sign in with their password only.', 403);
  store.db.prepare('UPDATE feishu_links SET last_used=?, name=? WHERE user_id=?').run(now, who.name || link.name, user.id);
  store.log({ id: user.id, username: user.username, role: user.role }, 'feishu-sign-in', 'users', user.id, null, { feishuName: who.name });
  return { kind: 'login', user };
}

// ---------- The person's own link ----------
export function myFeishu(store, actor) {
  const link = (tables(store), store.db.prepare('SELECT name, linked_at, last_used FROM feishu_links WHERE user_id=?').get(actor.id));
  return { available: feishuLoginAvailable(store).enabled, allowed: !NO_FEISHU_ROLES.includes(actor.role), linked: !!link, name: link?.name || '', linkedAt: link?.linked_at || '', lastUsed: link?.last_used || '' };
}
export function unlinkFeishu(store, actor) {
  tables(store);
  const removed = store.db.prepare('DELETE FROM feishu_links WHERE user_id=?').run(actor.id).changes;
  if (removed) store.log(actor, 'feishu-unlink', 'users', actor.id, null, null);
  return myFeishu(store, actor);
}
