import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Store } from '../src/store.mjs';
import { addUser, login, requestRecovery, redeemPasswordReset, setUserEmail, registeredEmail, issuePasswordReset } from '../src/auth.mjs';
import { createMailer, mailerFromEnv } from '../src/mailer.mjs';
import { completeState } from './helpers.mjs';

const fakeMailer = () => { const sent = []; return { sent, from: 'hr@example.com', send: async mail => { sent.push(mail); } }; };
const linkToken = mail => /#reset=([a-f0-9]{64})/.exec(mail.text)[1];
async function fixture() {
  const store = new Store(':memory:'); store.write(completeState());
  const admin = await addUser(store, { username: 'gds.admin', password: 'initial-password-123', role: 'admin' });
  const employee = await addUser(store, { username: 'EMP-001', password: 'employee-password-1', role: 'employee', employeeId: 'EMP-001' }, admin);
  return { store, admin, employee };
}

test('forgot password emails a one-time link to the registered email and the link resets the password once', async () => {
  const { store, admin } = await fixture();
  try {
    const mailer = fakeMailer();
    setUserEmail(store, admin, admin.id, 'Erika@Example.com');
    const result = requestRecovery(store, 'gds.admin', { mailer, origin: 'https://hr.example.com' });
    assert.equal(await result.delivery, true);
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0].to, 'Erika@Example.com');
    assert.match(mailer.sent[0].text, /https:\/\/hr\.example\.com\/#reset=[a-f0-9]{64}/);
    // A second request within two minutes does not send another email.
    await requestRecovery(store, 'erika@example.com', { mailer, origin: 'https://hr.example.com' }).delivery;
    assert.equal(mailer.sent.length, 1);
    await redeemPasswordReset(store, linkToken(mailer.sent[0]), 'brand-new-password-1');
    await assert.rejects(() => redeemPasswordReset(store, linkToken(mailer.sent[0]), 'another-password-12'), /invalid or expired/);
    assert.ok(await login(store, 'gds.admin', 'brand-new-password-1', 'test'));
  } finally { store.close(); }
});

test('employee reset emails fall back to the profile email; no email or unknown accounts get the same reply', async () => {
  const { store, admin, employee } = await fixture();
  try {
    const mailer = fakeMailer();
    const none = requestRecovery(store, 'EMP-001', { mailer });
    assert.equal(await none.delivery, false);
    assert.equal(mailer.sent.length, 0);
    assert.ok(store.db.prepare('SELECT id FROM recovery_requests WHERE user_id=?').get(employee.id), 'HR receives the request instead');
    const unknown = requestRecovery(store, 'nobody@example.com', { mailer });
    assert.equal(unknown.message, none.message);
    store.db.prepare('INSERT INTO employee_profiles VALUES(?,?,?)').run('EMP-001', 'employment', JSON.stringify({ businessEmail: 'alex@gds.example' }));
    assert.equal(registeredEmail(store, store.db.prepare('SELECT * FROM users WHERE id=?').get(employee.id)), 'alex@gds.example');
    await requestRecovery(store, 'alex@gds.example', { mailer }).delivery;
    assert.equal(mailer.sent[0].to, 'alex@gds.example');
    assert.throws(() => setUserEmail(store, admin, employee.id, 'not-an-email'), /valid email/);
    assert.throws(() => setUserEmail(store, { username: 'x', role: 'hr' }, employee.id, 'a@b.co'), /permission/i);
  } finally { store.close(); }
});

test('the SMTP sender delivers a complete message and rejects header injection', async () => {
  const received = [];
  const server = net.createServer(socket => {
    let data = false, body = '';
    socket.write('220 test ESMTP\r\n');
    socket.on('data', chunk => {
      for (const line of chunk.toString().split('\r\n').filter((l, i, all) => i < all.length - 1 || l)) {
        if (data) { if (line === '.') { data = false; received.push(body); socket.write('250 queued\r\n'); } else body += `${line}\n`; continue; }
        if (line.startsWith('EHLO')) socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (line.startsWith('AUTH PLAIN')) socket.write('235 ok\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 go\r\n'); }
        else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const mailer = createMailer({ host: '127.0.0.1', port: server.address().port, secure: 'plain', user: 'hr@example.com', pass: 'x', from: 'hr@example.com' });
    await mailer.send({ to: 'staff@example.com', subject: 'GDS HR password reset', text: 'Line one\n.dot line' });
    assert.match(received[0], /Subject: GDS HR password reset/);
    assert.match(received[0], /\n\.\.dot line/);
    await assert.rejects(() => mailer.send({ to: 'a@b.co\r\nBcc: x@y.co', subject: 's', text: 't' }), /recipient/);
    await assert.rejects(() => mailer.send({ to: 'a@b.co', subject: 'a\r\nBcc: x@y.co', text: 't' }), /subject/);
  } finally { server.close(); }
  assert.equal(mailerFromEnv({}), null);
  assert.throws(() => mailerFromEnv({ HR_SMTP_HOST: 'smtp.example.com', HR_SMTP_SECURE: 'plain', HR_MAIL_FROM: 'hr@example.com' }), /this machine/);
});

test('employee self-service: link to the registered email, single use, expires, old sessions end, no HR step', async () => {
  const { store, employee } = await fixture();
  try {
    const mailer = fakeMailer();
    store.db.prepare('INSERT INTO employee_profiles VALUES(?,?,?)').run('EMP-001', 'employment', JSON.stringify({ businessEmail: 'alex@gds.example' }));
    const before = await login(store, 'EMP-001', 'employee-password-1', 'test');
    assert.equal(await requestRecovery(store, 'EMP-001', { mailer, origin: 'https://hr.example.com' }).delivery, true);
    assert.equal(mailer.sent[0].to, 'alex@gds.example');
    assert.match(mailer.sent[0].text, /https:\/\/hr\.example\.com\/#reset=[a-f0-9]{64}/);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM recovery_requests').get().n, 0, 'no HR request when the email went out');
    const stored = store.db.prepare('SELECT token_hash FROM password_resets WHERE user_id=?').get(employee.id);
    assert.notEqual(stored.token_hash, linkToken(mailer.sent[0]), 'only a hash of the link is stored');
    await redeemPasswordReset(store, linkToken(mailer.sent[0]), 'brand-new-pass-9');
    await assert.rejects(() => redeemPasswordReset(store, linkToken(mailer.sent[0]), 'another-pass-99'), /invalid or expired/, 'single use');
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(employee.id).n, 0, 'signed out everywhere');
    assert.ok(before);
    await login(store, 'EMP-001', 'brand-new-pass-9', 'test');
    // Expired link: refused.
    store.db.prepare('DELETE FROM password_resets').run();
    await requestRecovery(store, 'EMP-001', { mailer }).delivery;
    store.db.prepare('UPDATE password_resets SET expires=?').run(Date.now() - 1);
    await assert.rejects(() => redeemPasswordReset(store, linkToken(mailer.sent.at(-1)), 'later-pass-999'), /invalid or expired/);
  } finally { store.close(); }
});

test('a reset email that cannot be sent goes to HR (alert) and the unsent link is withdrawn', async () => {
  const { store, employee } = await fixture();
  try {
    const failing = { from: 'hr@example.com', send: async () => { throw new Error('Mail server refused the message (535).'); } };
    store.db.prepare('INSERT INTO employee_profiles VALUES(?,?,?)').run('EMP-001', 'employment', JSON.stringify({ businessEmail: 'alex@gds.example' }));
    assert.equal(await requestRecovery(store, 'EMP-001', { mailer: failing }).delivery, false);
    assert.ok(store.db.prepare('SELECT id FROM recovery_requests WHERE user_id=? AND resolved=0').get(employee.id), 'HR has the request');
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM password_resets').get().n, 0, 'no live link left behind');
    assert.ok(store.db.prepare('SELECT message FROM notifications WHERE employee_id IS NULL').all().some(n => /could not be sent \(Mail server refused/.test(n.message)));
  } finally { store.close(); }
});

test('HR Reset password also emails the link to the registered email; the employee sets their own password', async () => {
  const { store, admin, employee } = await fixture();
  try {
    const mailer = fakeMailer();
    store.db.prepare('INSERT INTO employee_profiles VALUES(?,?,?)').run('EMP-001', 'employment', JSON.stringify({ businessEmail: 'alex@gds.example' }));
    const r = issuePasswordReset(store, admin, employee.id, false, { mailer, origin: 'https://hr.example.com' });
    assert.equal(await r.delivery, true);
    assert.equal(r.sentTo, 'a***@gds.example');
    assert.equal(mailer.sent[0].to, 'alex@gds.example');
    assert.equal(linkToken(mailer.sent[0]), r.token, 'the emailed link carries the same one-time code');
    assert.match(mailer.sent[0].text, /expires in 15 minutes/);
    assert.doesNotMatch(mailer.sent[0].text, /password:/i, 'no password in the email');
    await redeemPasswordReset(store, r.token, 'chosen-by-employee-9');
    await login(store, 'EMP-001', 'chosen-by-employee-9', 'test');
    const failing = { from: 'hr@example.com', send: async () => { throw new Error('535'); } };
    const f = issuePasswordReset(store, admin, employee.id, false, { mailer: failing, origin: 'https://hr.example.com' });
    assert.equal(await f.delivery, false, 'HR still has the link to send by hand');
    assert.match(f.token, /^[a-f0-9]{64}$/);
  } finally { store.close(); }
});
