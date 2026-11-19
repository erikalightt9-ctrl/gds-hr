import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { validateWebhook, feishuSign, saveFeishu, feishuStatus, connectFeishu, sendFeishuTest } from '../src/feishu.mjs';

const HOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/11111111-2222-3333-4444-555555555555';
function setup() {
  const store = new Store(':memory:'); store.write(completeState());
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ code: 0, msg: 'success' }) }; };
  return { store, sent, fetchImpl };
}

test('only Feishu / Lark custom-bot webhook addresses are accepted', () => {
  assert.equal(validateWebhook(HOOK), HOOK);
  assert.equal(validateWebhook('https://open.larksuite.com/open-apis/bot/v2/hook/abc-12345'), 'https://open.larksuite.com/open-apis/bot/v2/hook/abc-12345');
  for (const bad of ['http://open.feishu.cn/open-apis/bot/v2/hook/x', 'https://evil.example/open-apis/bot/v2/hook/x', 'https://open.feishu.cn/other/path', 'not a url']) assert.throws(() => validateWebhook(bad), /Feishu/);
});

test('signature follows Feishu: base64(HMAC-SHA256 keyed by "timestamp\\nsecret" over an empty message)', () => {
  const expected = createHmac('sha256', '1700000000\nsecret-value').update('').digest('base64');
  assert.equal(feishuSign('1700000000', 'secret-value'), expected);
});

test('settings: admin only; the webhook and secret are never shown back in full', () => {
  const { store } = setup();
  assert.throws(() => saveFeishu(store, { id: 'h', username: 'hr', role: 'hr' }, { webhook: HOOK, enabled: true }), /permission/);
  saveFeishu(store, admin, { webhook: HOOK, secret: 'abc123secret', enabled: true });
  const s = feishuStatus(store, admin);
  assert.equal(s.enabled, true); assert.equal(s.hasSecret, true);
  assert.ok(!JSON.stringify(s).includes('555555555555') && !JSON.stringify(s).includes('abc123secret'));
  saveFeishu(store, admin, { enabled: false });
  assert.equal(feishuStatus(store, admin).configured, true, 'a blank webhook keeps the saved one');
});

test('HR notices are posted to the Feishu group in one batched message; employees\' own notices are not', async () => {
  const { store, sent, fetchImpl } = setup();
  saveFeishu(store, admin, { webhook: HOOK, secret: 'abc123secret', enabled: true });
  const feishu = connectFeishu(store, { fetchImpl, delayMs: 0, origin: 'https://hr.example.test' });
  store.notify(null, 'EMP-001: new attendance request AR-2026-0001.');
  store.notify(null, 'EMP-002 submitted an attendance explanation.');
  store.notify('EMP-001', 'Your leave was approved.');   // the employee's own notice: never sent
  await feishu.flush();
  assert.equal(sent.length, 1, 'one message for the batch');
  const { url, body } = sent[0];
  assert.equal(url, HOOK); assert.equal(body.msg_type, 'text');
  assert.match(body.content.text, /AR-2026-0001/); assert.match(body.content.text, /explanation/);
  assert.doesNotMatch(body.content.text, /leave was approved/);
  assert.match(body.content.text, /https:\/\/hr\.example\.test/);
  assert.ok(body.timestamp && body.sign, 'signed when a secret is saved');
  assert.ok(feishuStatus(store, admin).lastSentAt);
});

test('a new leave application is announced too', async () => {
  const { store, sent, fetchImpl } = setup();
  saveFeishu(store, admin, { webhook: HOOK, enabled: true });
  const feishu = connectFeishu(store, { fetchImpl, delayMs: 0 });
  store.log({ username: 'emp1' }, 'apply', 'leaves', 'L1', null, { id: 'L1', employeeId: 'EMP-001', startDate: '2026-11-20', endDate: '2026-11-21', days: 2, reference: 'LV-2026-0009' });
  await feishu.flush();
  assert.match(sent[0].body.content.text, /leave.*2026-11-20/i);
});

test('nothing is sent while switched off; a failed post is recorded and never breaks the HR action', async () => {
  const { store, sent, fetchImpl } = setup();
  saveFeishu(store, admin, { webhook: HOOK, enabled: false });
  let feishu = connectFeishu(store, { fetchImpl, delayMs: 0 });
  store.notify(null, 'off'); await feishu.flush();
  assert.equal(sent.length, 0);
  saveFeishu(store, admin, { enabled: true });
  feishu = connectFeishu(store, { fetchImpl: async () => ({ ok: true, json: async () => ({ code: 19021, msg: 'sign match fail or timestamp is not within one hour from current time' }) }), delayMs: 0 });
  assert.doesNotThrow(() => store.notify(null, 'will fail'));
  await feishu.flush();
  assert.match(feishuStatus(store, admin).lastError, /sign match fail/);
});

test('Send test message reports the result', async () => {
  const { store, sent, fetchImpl } = setup();
  saveFeishu(store, admin, { webhook: HOOK, enabled: true });
  const result = await sendFeishuTest(store, admin, { fetchImpl });
  assert.equal(result.ok, true); assert.match(sent[0].body.content.text, /test/i);
});
