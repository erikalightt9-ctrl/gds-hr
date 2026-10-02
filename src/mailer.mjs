// Minimal SMTP sender for password-reset links (no third-party dependency).
// Configured from the environment; when HR_SMTP_HOST is unset there is no mailer and recovery falls back to HR.
//   HR_SMTP_HOST, HR_SMTP_PORT (465 = TLS, otherwise STARTTLS), HR_SMTP_USER, HR_SMTP_PASS, HR_MAIL_FROM
//   HR_SMTP_SECURE = tls | starttls | plain   (plain is accepted only for a relay on this machine)
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const ADDRESS = /^[^\s@<>"',;:\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const isEmailAddress = value => typeof value === 'string' && value.length <= 254 && ADDRESS.test(value);

export function mailerFromEnv(env = process.env) {
  if (!env.HR_SMTP_HOST) return null;
  const port = Number(env.HR_SMTP_PORT || 587);
  const secure = env.HR_SMTP_SECURE || (port === 465 ? 'tls' : 'starttls');
  if (!['tls', 'starttls', 'plain'].includes(secure)) throw new Error('HR_SMTP_SECURE must be tls, starttls or plain.');
  if (secure === 'plain' && !LOCAL_HOSTS.has(env.HR_SMTP_HOST)) throw new Error('Unencrypted SMTP is allowed only for a relay on this machine.');
  const from = env.HR_MAIL_FROM || env.HR_SMTP_USER;
  if (!isEmailAddress(from)) throw new Error('Set HR_MAIL_FROM to the sending email address.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HR_SMTP_PORT is not a valid port.');
  return createMailer({ host: env.HR_SMTP_HOST, port, secure, user: env.HR_SMTP_USER, pass: env.HR_SMTP_PASS, from });
}

export function createMailer({ host, port, secure, user, pass, from, timeoutMs = 20000 }) {
  return {
    from,
    async send({ to, subject, text }) {
      if (!isEmailAddress(to)) throw new Error('Invalid recipient address.');
      if (/[\r\n]/.test(subject)) throw new Error('Invalid subject.');
      const session = await open({ host, port, secure, timeoutMs });
      try {
        await session.expect(220);
        let features = await session.command(`EHLO ${hostLabel(from)}`, 250);
        if (secure === 'starttls') {
          if (!/STARTTLS/i.test(features)) throw new Error('The mail server does not offer STARTTLS.');
          await session.command('STARTTLS', 220);
          await session.upgrade(host);
          features = await session.command(`EHLO ${hostLabel(from)}`, 250);
        }
        if (user) {
          if (/AUTH[ =][^\n]*PLAIN/i.test(features)) await session.command(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass || ''}`).toString('base64')}`, 235);
          else {
            await session.command('AUTH LOGIN', 334);
            await session.command(Buffer.from(user).toString('base64'), 334);
            await session.command(Buffer.from(pass || '').toString('base64'), 235);
          }
        }
        await session.command(`MAIL FROM:<${from}>`, 250);
        await session.command(`RCPT TO:<${to}>`, [250, 251]);
        await session.command('DATA', 354);
        await session.command(`${message({ from, to, subject, text })}\r\n.`, 250);
        await session.command('QUIT', 221).catch(() => {});
      } finally { session.close(); }
    },
  };
}

const hostLabel = from => from.split('@')[1];
function message({ from, to, subject, text }) {
  const body = text.replace(/\r?\n/g, '\r\n').split('\r\n').map(line => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
  return [
    `From: GDS CAPITAL INC. HR <${from}>`, `To: <${to}>`, `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomUUID()}@${hostLabel(from)}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', body,
  ].join('\r\n');
}

// One SMTP conversation: reads complete (possibly multi-line) replies and checks their status codes.
function open({ host, port, secure, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let socket = secure === 'tls' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buffer = '', waiting = null, failure = null;
    const onData = chunk => { buffer += chunk.toString('utf8'); drain(); };
    const onError = error => { failure = error; if (waiting) { const w = waiting; waiting = null; w.reject(error); } };
    const attach = s => { s.setTimeout(timeoutMs, () => s.destroy(new Error('Mail server timed out.'))); s.on('data', onData); s.on('error', onError); };
    function drain() {
      if (!waiting) return;
      const lines = buffer.split('\r\n'), end = lines.findIndex(l => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
      if (end < 0) return;
      const reply = lines.slice(0, end + 1).join('\n'); buffer = lines.slice(end + 1).join('\r\n');
      const w = waiting; waiting = null; w.resolve(reply);
    }
    const read = () => new Promise((ok, fail) => { if (failure) { fail(failure); return; } waiting = { resolve: ok, reject: fail }; drain(); });
    const check = async codes => {
      const reply = await read(), code = Number(reply.split('\n').at(-1).slice(0, 3));
      if (![].concat(codes).includes(code)) throw new Error(`Mail server refused the message (${code}).`);
      return reply;
    };
    const session = {
      expect: check,
      command: (line, codes) => { socket.write(`${line}\r\n`); return check(codes); },
      upgrade: name => new Promise((ok, fail) => {
        socket.removeListener('data', onData);
        const secured = tls.connect({ socket, servername: name }, () => ok());
        secured.once('error', fail); socket = secured; attach(secured);
      }),
      close: () => socket.destroy(),
    };
    attach(socket);
    socket.once(secure === 'tls' ? 'secureConnect' : 'connect', () => resolve(session));
    socket.once('error', reject);
  });
}
