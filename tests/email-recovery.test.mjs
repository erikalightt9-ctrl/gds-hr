import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Store } from '../src/store.mjs';
import { addUser, login, requestRecovery, redeemPasswordReset, setUserEmail, registeredEmail } from '../src/auth.mjs';
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
