import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { addUser } from '../src/auth.mjs';
import { completeState, admin } from './helpers.mjs';
import { saveFeishuLogin, feishuLoginStatus, feishuLoginAvailable, startFeishu, finishFeishu, myFeishu, unlinkFeishu } from '../src/feishu-login.mjs';

const ORIGIN = 'https://hr.example.test', CALLBACK = `${ORIGIN}/api/login/feishu/callback`;
const APP = { appId: 'cli_a1b2c3d4e5f6a7b8', appSecret: 'not-a-real-secret-0123456789', enabled: true };

// A stand-in for Feishu: the code exchange and the user-info call.
function feishu({ openId = 'ou_employee1', name = 'Juan Dela Cruz', tokenError = '', callback = CALLBACK } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/open-apis/authen/v2/oauth/token')) {
      const body = JSON.parse(init.body);
      if (tokenError) return { ok: false, json: async () => ({ code: 20003, error: 'invalid_grant', error_description: tokenError }) };
      assert.equal(body.grant_type, 'authorization_code'); assert.equal(body.client_id, APP.appId); assert.equal(body.client_secret, APP.appSecret); assert.equal(body.redirect_uri, callback);
      return { ok: true, json: async () => ({ code: 0, access_token: 'u-token', token_type: 'Bearer', expires_in: 7200 }) };
    }
    if (url.endsWith('/open-apis/authen/v1/user_info')) {
      assert.equal(init.headers.Authorization, 'Bearer u-token');
      return { ok: true, json: async () => ({ code: 0, data: { open_id: openId, union_id: 'on_union1', tenant_key: 'tenant1', name } }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetchImpl };
}
async function setup() {
  const store = new Store(':memory:'); store.write(completeState());
  const created = await addUser(store, { username: 'emp1', password: 'employee-pass-123', role: 'employee', employeeId: 'EMP-001' }, admin);
  const row = store.db.prepare('SELECT * FROM users WHERE id=?').get(created.id);
  const actor = { id: row.id, username: row.username, role: row.role, employeeId: row.employee_id };
  return { store, actor };
}
const stateOf = url => new URL(url).searchParams.get('state');

test('settings: admin only, the App Secret is never shown back, and the callback address to register is given', async () => {
  const { store, actor } = await setup();
  assert.throws(() => saveFeishuLogin(store, actor, APP), /permission/);
  assert.throws(() => saveFeishuLogin(store, admin, { ...APP, appId: 'not-an-app-id' }), /App ID/);
  const status = saveFeishuLogin(store, admin, APP);
  assert.equal(status.enabled, true); assert.equal(status.hasSecret, true);
  assert.ok(!JSON.stringify(feishuLoginStatus(store, admin, { origin: ORIGIN })).includes(APP.appSecret), 'secret never returned');
  assert.equal(feishuLoginStatus(store, admin, { origin: ORIGIN }).callbackUrl, CALLBACK);
  assert.deepEqual(feishuLoginAvailable(store), { enabled: true });
  assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE kind='integrations' AND record_id='feishu-login'").get(), 'audited');
});

test('not set up: no sign-in button and starting is refused', async () => {
  const { store } = await setup();
  assert.deepEqual(feishuLoginAvailable(store), { enabled: false });
  assert.throws(() => startFeishu(store, { kind: 'login' }, { origin: ORIGIN }), /not set up/i);
});

test('an employee links Feishu while signed in, then signs in with Feishu alone', async () => {
  const { store, actor } = await setup(); saveFeishuLogin(store, admin, APP);
  const linkUrl = startFeishu(store, { kind: 'link', user: actor }, { origin: ORIGIN });
  const u = new URL(linkUrl);
  assert.equal(u.origin, 'https://accounts.feishu.cn'); assert.equal(u.searchParams.get('client_id'), APP.appId); assert.equal(u.searchParams.get('redirect_uri'), CALLBACK); assert.equal(u.searchParams.get('response_type'), 'code');
  const { fetchImpl } = feishu();
  const linked = await finishFeishu(store, { code: 'code-1', state: stateOf(linkUrl) }, { origin: ORIGIN, fetchImpl });
  assert.equal(linked.kind, 'link');
  assert.equal(myFeishu(store, actor).linked, true); assert.equal(myFeishu(store, actor).name, 'Juan Dela Cruz');

  const loginUrl = startFeishu(store, { kind: 'login' }, { origin: ORIGIN });
  const login = await finishFeishu(store, { code: 'code-2', state: stateOf(loginUrl) }, { origin: ORIGIN, fetchImpl });
  assert.equal(login.kind, 'login'); assert.equal(login.user.id, actor.id);
  await assert.rejects(finishFeishu(store, { code: 'code-3', state: stateOf(loginUrl) }, { origin: ORIGIN, fetchImpl }), /expired|not found/i, 'a state works once');
  assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE action='feishu-sign-in'").get());
});

test('sign-in is refused for an unlinked Feishu account, a disabled account, an admin, or a Feishu error', async () => {
  const { store, actor } = await setup(); saveFeishuLogin(store, admin, APP);
  const login = async fetchImpl => finishFeishu(store, { code: 'c', state: stateOf(startFeishu(store, { kind: 'login' }, { origin: ORIGIN })) }, { origin: ORIGIN, fetchImpl });
  await assert.rejects(login(feishu({ openId: 'ou_stranger' }).fetchImpl), /not linked/i);
  await finishFeishu(store, { code: 'c', state: stateOf(startFeishu(store, { kind: 'link', user: actor }, { origin: ORIGIN })) }, { origin: ORIGIN, fetchImpl: feishu().fetchImpl });
  store.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(actor.id);
  await assert.rejects(login(feishu().fetchImpl), /disabled/i);
  store.db.prepare("UPDATE users SET disabled=0, role='admin' WHERE id=?").run(actor.id);
  await assert.rejects(login(feishu().fetchImpl), /administrator/i);
  store.db.prepare("UPDATE users SET role='employee' WHERE id=?").run(actor.id);
  await assert.rejects(login(feishu({ tokenError: 'code expired' }).fetchImpl), /Feishu/);
});

test('one Feishu account links to one HR account; unlinking stops Feishu sign-in; admins cannot link', async () => {
  const { store, actor } = await setup(); saveFeishuLogin(store, admin, APP);
  const other = await addUser(store, { username: 'hr2', password: 'hr-password-123', role: 'hr' }, admin);
  const link = (user, openId) => finishFeishu(store, { code: 'c', state: stateOf(startFeishu(store, { kind: 'link', user }, { origin: ORIGIN })) }, { origin: ORIGIN, fetchImpl: feishu({ openId }).fetchImpl });
  await link(actor, 'ou_same');
  await assert.rejects(link({ id: other.id, username: 'hr2', role: 'hr' }, 'ou_same'), /already linked/i);
  assert.throws(() => startFeishu(store, { kind: 'link', user: admin }, { origin: ORIGIN }), /administrator/i);
  unlinkFeishu(store, actor);
  assert.equal(myFeishu(store, actor).linked, false);
  const state = stateOf(startFeishu(store, { kind: 'login' }, { origin: ORIGIN }));
  await assert.rejects(finishFeishu(store, { code: 'c', state }, { origin: ORIGIN, fetchImpl: feishu({ openId: 'ou_same' }).fetchImpl }), /not linked/i);
});

test('Lark (larksuite.com) accounts use the Lark addresses', async () => {
  const { store } = await setup(); saveFeishuLogin(store, admin, { ...APP, domain: 'lark' });
  assert.equal(new URL(startFeishu(store, { kind: 'login' }, { origin: ORIGIN })).origin, 'https://accounts.larksuite.com');
});

test('HTTP: start redirects to Feishu, the callback signs a linked employee in and lands on the app', async t => {
  const { createApp } = await import('../src/server.mjs');
  const { store, actor } = await setup(); saveFeishuLogin(store, admin, APP);
  const origin = 'http://127.0.0.1:3400', { fetchImpl } = feishu({ callback: `${origin}/api/login/feishu/callback` });
  const app = createApp({ store, origin, setupToken: '', fetchImpl });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/api/login/feishu/available`)).json(), { enabled: true });
  // link first (as the signed-in employee would), using the same origin as the server
  const linkState = stateOf(startFeishu(store, { kind: 'link', user: actor }, { origin }));
  const linked = await fetch(`${base}/api/login/feishu/callback?code=c1&state=${linkState}`);
  assert.match(await linked.text(), /url=\/#feishu-linked/);
  const start = await fetch(`${base}/api/login/feishu/start`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const state = stateOf(start.headers.get('location'));
  const back = await fetch(`${base}/api/login/feishu/callback?code=c2&state=${state}`);
  assert.equal(back.status, 200);
  assert.ok(back.headers.getSetCookie().some(c => /^hr_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict/.test(c)), 'session cookie set');
  const bad = await fetch(`${base}/api/login/feishu/callback?code=c3&state=${'0'.repeat(64)}`);
  assert.match(await bad.text(), /#feishu-error=/); assert.ok(!bad.headers.getSetCookie().length, 'no cookie on failure');
  const cancelled = await fetch(`${base}/api/login/feishu/callback?error=access_denied&state=x`);
  assert.match(decodeURIComponent(await cancelled.text()), /cancelled/);
});
