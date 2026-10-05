import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { userSchema } from './schema.mjs';
import { AppError, permit } from './service.mjs';
import { isEmailAddress } from './mailer.mjs';
const scrypt = promisify(scryptCallback);
const hashToken = token => createHash('sha256').update(token).digest('hex');
export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function addUser(store, input, actor = null) {
  const value = userSchema.parse(input);
  if (actor) permit(actor, ['admin']);
  const hash = await passwordHash(value.password);
  return store.transaction(() => {
    if (!actor && store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n) throw new AppError('Initial setup is already complete.', 409);
    if (!actor && value.role !== 'admin') throw new AppError('The first user must be an administrator.');
    if (store.db.prepare('SELECT id FROM users WHERE username=?').get(value.username)) throw new AppError('Username already exists.');
    const employees = store.read().employees;
    if (employees.some(e => e.id.toLowerCase() === value.username.toLowerCase() && e.id !== value.employeeId)) throw new AppError('This username is reserved for an Employee ID.');
    if (['employee', 'dept_manager'].includes(value.role) && (!employees.some(e => e.id === value.employeeId) || store.db.prepare('SELECT id FROM users WHERE employee_id=? OR username=?').get(value.employeeId, value.employeeId))) throw new AppError('Employee does not exist or already has an account/identifier.');
    const user = { id: randomUUID(), username: value.username, role: value.role, employeeId: value.employeeId || null };
    store.db.prepare('INSERT INTO users(id,username,password_hash,role,employee_id) VALUES(?,?,?,?,?)').run(user.id, user.username, hash, user.role, user.employeeId);
    store.log(actor || user, 'create', 'users', user.id, null, user);
    return user;
  });
}
// New employees get their portal login automatically when HR encodes them. The username is the Employee ID and
// the password is random and unknown to anyone: the employee sets their own through a setup link (emailed when email
// is configured and an address is on file) or a one-time code an administrator issues from Account & access.
export const SETUP_LINK_HOURS = 72;
export async function provisionEmployeeAccount(store, actor, employeeId, { mailer = null, origin = '' } = {}) {
  const employee = store.read().employees.find(e => e.id === employeeId);
  if (!employee || employee.archived) return null;
  if (store.db.prepare('SELECT id FROM users WHERE employee_id=? OR username=? COLLATE NOCASE').get(employeeId, employeeId)) return null;
  const hash = await passwordHash(randomBytes(32).toString('hex'));
  const user = store.transaction(() => {
    if (store.db.prepare('SELECT id FROM users WHERE employee_id=? OR username=? COLLATE NOCASE').get(employeeId, employeeId)) return null;
    const value = { id: randomUUID(), username: employeeId, role: 'employee', employeeId };
    store.db.prepare('INSERT INTO users(id,username,password_hash,role,employee_id) VALUES(?,?,?,?,?)').run(value.id, value.username, hash, value.role, value.employeeId);
    store.log(actor, 'auto-create-account', 'users', value.id, null, value);
    return value;
  });
  if (!user) return null;
  const email = mailer ? registeredEmail(store, { email: null, employee_id: employeeId }) : null;
  let emailed = false;
  if (email) {
    const token = randomBytes(32).toString('hex'), expires = Date.now() + SETUP_LINK_HOURS * 3600000;
    store.db.prepare('INSERT INTO password_resets VALUES(?,?,?)').run(hashToken(token), user.id, expires);
    store.log(actor, 'email-setup-link', 'users', user.id, null, { sentTo: maskEmail(email), expires });
    emailed = await mailer.send({ to: email, subject: 'Your GDS HR account', text: setupEmail(employee.name, employeeId, `${origin}/#reset=${token}`) }).then(() => true, error => { console.error('Account setup email failed:', error.message); return false; });
  }
  // Without an email, the account waits in Account & access for an administrator to issue a setup code.
  if (!emailed) store.db.prepare('INSERT INTO recovery_requests(id,user_id,created_at) VALUES(?,?,?)').run(randomUUID(), user.id, new Date().toISOString());
  return { ...user, emailed };
}
const setupEmail = (name, username, link) => `Hello ${name},

Your GDS CAPITAL INC. HR account is ready. Your username is your Employee ID: ${username}

Open this link to choose your password. It works once and expires in ${SETUP_LINK_HOURS} hours:
${link}

For help, contact HR.

GDS CAPITAL INC. Human Resources`;
export async function provisionMissingAccounts(store, actor, options) {
  permit(actor, ['admin']);
  const linked = new Set(store.db.prepare('SELECT employee_id FROM users WHERE employee_id IS NOT NULL').all().map(r => r.employee_id));
  const created = [];
  for (const e of store.read().employees.filter(e => !e.archived && !linked.has(e.id))) { const u = await provisionEmployeeAccount(store, actor, e.id, options); if (u) created.push(u); }
  return { created: created.length, emailed: created.filter(u => u.emailed).length };
}
export function checkLimit(store, key, maximum = 10) {
  const now = Date.now();
  store.db.prepare('DELETE FROM login_limits WHERE until_ms < ?').run(now);
  const row = store.db.prepare('SELECT * FROM login_limits WHERE key=?').get(key);
  if (row && row.attempts >= maximum) throw new AppError('Too many sign-in attempts. Try again in 15 minutes.', 429);
  store.db.prepare('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key, now + 900000);
}
export async function login(store, username, password, key, otp = '') {
  checkLimit(store, key, 100);
  const accountKey = `account-login:${username.toLowerCase()}`; checkLimit(store, accountKey);
  let user = store.db.prepare('SELECT * FROM users WHERE username=? OR employee_id=? COLLATE NOCASE').get(username, username);
  const stored = user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
  const computed = await passwordHash(password, stored.split(':')[0]);
  user = user ? store.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) : null;
  if (!timingSafeEqual(Buffer.from(stored.split(':')[1], 'hex'), Buffer.from(computed.split(':')[1], 'hex')) || !user || user.disabled || user.password_hash !== stored) throw new AppError('Incorrect username or password.', 401);
  if (user.mfa_secret) {
    const step = verifyTotp(user.mfa_secret, otp, user.mfa_last_step);
    store.db.prepare('UPDATE users SET mfa_last_step=? WHERE id=?').run(step, user.id);
  }
  store.db.prepare('DELETE FROM login_limits WHERE key=?').run(accountKey);
  const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
  store.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hashToken(token), user.id, csrf, Date.now() + 8 * 3600000);
  return { token, csrf, user: { id: user.id, username: user.username, role: user.role, employeeId: user.employee_id, mfaEnabled: !!user.mfa_secret } };
}
export function session(store, cookie = '') {
  const token = cookie.split(';').map(v => v.trim()).find(v => v.startsWith('hr_session='))?.slice(11);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = store.db.prepare('SELECT s.csrf, s.expires, u.id, u.username, u.role, u.employee_id, u.disabled, u.mfa_secret FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(hashToken(token));
  if (!row || row.disabled || row.expires < Date.now()) return null;
  return { user: { id: row.id, username: row.username, role: row.role, employeeId: row.employee_id, mfaEnabled: !!row.mfa_secret }, csrf: row.csrf, tokenHash: hashToken(token) };
}
export async function changePassword(store, user, currentPassword, newPassword) {
  const row = store.db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
  const computed = await passwordHash(currentPassword, row.password_hash.split(':')[0]);
  if (!timingSafeEqual(Buffer.from(row.password_hash), Buffer.from(computed))) throw new AppError('Current password is incorrect.', 401);
  if (newPassword.length < 12 || newPassword.length > 200) throw new AppError('Use a password of 12–200 characters.');
  const hash = await passwordHash(newPassword);
  store.transaction(() => {
    if (store.db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)?.password_hash !== row.password_hash) throw new AppError('Account changed during this request. Sign in again.', 409);
    store.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    store.db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
    store.log(user, 'password-change', 'users', user.id, null, null);
  });
}

export const EMAIL_RESET_MINUTES = 30;
const EMAIL_RESEND_MINUTES = 2;
const RECOVERY_MESSAGE = `If the account exists, a password reset link has been sent to its registered email. The link expires in ${EMAIL_RESET_MINUTES} minutes. If no email arrives, contact HR to verify your identity and receive a reset code.`;
const profileEmails = (store, employeeId) => {
  if (!employeeId) return [];
  const rows = store.db.prepare("SELECT section,data FROM employee_profiles WHERE employee_id=? AND section IN ('employment','personal')").all(employeeId);
  const data = Object.fromEntries(rows.map(r => [r.section, JSON.parse(r.data)]));
  return [data.employment?.businessEmail, data.personal?.personalEmail].map(v => (v || '').trim()).filter(isEmailAddress);
};
// The registered email: set on the account by an administrator, otherwise the employee profile's business, then personal email.
export function registeredEmail(store, user) {
  return isEmailAddress(user.email) ? user.email : profileEmails(store, user.employee_id)[0] || null;
}
function findRecoveryAccount(store, identifier) {
  const direct = store.db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR employee_id=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(identifier, identifier, identifier);
  if (direct || !isEmailAddress(identifier)) return direct;
  const wanted = identifier.toLowerCase();
  return store.db.prepare('SELECT * FROM users WHERE employee_id IS NOT NULL').all().find(u => profileEmails(store, u.employee_id).some(e => e.toLowerCase() === wanted)) || null;
}
// Forgot password: emails a one-time reset link to the registered address, or queues an HR request when no email can be sent.
// The reply is identical either way so it never reveals whether an account or address exists.
// `delivery` lets callers (tests) wait for the email; the HTTP route does not, so timing reveals nothing either.
export function requestRecovery(store, identifier, { mailer = null, origin = '' } = {}) {
  const user = findRecoveryAccount(store, identifier.trim());
  let delivery = Promise.resolve(false);
  if (user && !user.disabled) {
    const email = mailer ? registeredEmail(store, user) : null;
    if (email) {
      const recent = store.db.prepare('SELECT expires FROM password_resets WHERE user_id=?').get(user.id);
      if (!recent || recent.expires < Date.now() + (EMAIL_RESET_MINUTES - EMAIL_RESEND_MINUTES) * 60000) {
        const token = randomBytes(32).toString('hex'), expires = Date.now() + EMAIL_RESET_MINUTES * 60000;
        store.transaction(() => {
          store.db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
          store.db.prepare('INSERT INTO password_resets VALUES(?,?,?)').run(hashToken(token), user.id, expires);
          store.log({ username: 'recovery-request' }, 'email-reset-link', 'users', user.id, null, { sentTo: maskEmail(email), expires });
        });
        delivery = mailer.send({ to: email, subject: 'GDS HR password reset', text: resetEmail(user.username, `${origin}/#reset=${token}`) })
          .then(() => true, error => { console.error('Password reset email failed:', error.message); return false; });
      }
    } else if (!store.db.prepare('SELECT id FROM recovery_requests WHERE user_id=? AND resolved=0').get(user.id)) {
      store.transaction(() => {
        store.db.prepare('INSERT INTO recovery_requests(id,user_id,created_at) VALUES(?,?,?)').run(randomUUID(), user.id, new Date().toISOString());
        store.log({ username: 'recovery-request' }, 'request-recovery', 'users', user.id, null, null);
      });
    }
  }
  return { message: RECOVERY_MESSAGE, delivery };
}
export const maskEmail = email => email.replace(/^(.)(.*)(@.*)$/, (_, first, rest, domain) => `${first}${'*'.repeat(Math.min(rest.length, 6))}${domain}`);
const resetEmail = (username, link) => `Hello,

We received a request to reset the password for your GDS CAPITAL INC. HR account (${username}).

Open this link to choose a new password. It works once and expires in ${EMAIL_RESET_MINUTES} minutes:
${link}

If you did not ask for this, ignore this email; your password stays the same. For help, contact HR.

GDS CAPITAL INC. Human Resources`;
// Administrators record the email each account's reset links go to (blank clears it and falls back to the employee profile).
export function setUserEmail(store, actor, userId, email) {
  permit(actor, ['admin']);
  const value = (email || '').trim();
  if (value && !isEmailAddress(value)) throw new AppError('Enter a valid email address.');
  const user = store.db.prepare('SELECT id,email FROM users WHERE id=?').get(userId);
  if (!user) throw new AppError('User not found.', 404);
  if (value && store.db.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE AND id<>?').get(value, userId)) throw new AppError('Another account already uses this email.');
  store.transaction(() => {
    store.db.prepare('UPDATE users SET email=? WHERE id=?').run(value || null, userId);
    store.log(actor, 'set-account-email', 'users', userId, { email: user.email || null }, { email: value || null });
  });
  return { email: value || null };
}
export function issuePasswordReset(store, actor, userId, resetMfa = false) {
  permit(actor, ['admin']);
  const user = store.db.prepare('SELECT id FROM users WHERE id=?').get(userId);
  if (!user) throw new AppError('User not found.', 404);
  const token = randomBytes(32).toString('hex'), expires = Date.now() + 15 * 60000;
  store.transaction(() => {
    store.db.prepare('DELETE FROM password_resets WHERE user_id=?').run(userId);
    store.db.prepare('INSERT INTO password_resets VALUES(?,?,?)').run(hashToken(token), userId, expires);
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    store.db.prepare('UPDATE recovery_requests SET resolved=1 WHERE user_id=?').run(userId);
    if (resetMfa) store.db.prepare('UPDATE users SET mfa_secret=NULL,mfa_pending=NULL,mfa_last_step=NULL WHERE id=?').run(userId);
    store.log(actor, 'issue-password-reset', 'users', userId, null, { expires, resetMfa });
  });
  return { token, expires, message: 'Give this one-time code directly to the employee after verifying their identity. It expires in 15 minutes.' };
}
export async function redeemPasswordReset(store, token, password) {
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 12 || password.length > 200) throw new AppError('Invalid reset code or password.');
  const hash = await passwordHash(password);
  return store.transaction(() => {
    const reset = store.db.prepare('SELECT * FROM password_resets WHERE token_hash=?').get(hashToken(token));
    if (!reset || reset.expires < Date.now()) throw new AppError('Reset code is invalid or expired.');
    store.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, reset.user_id);
    store.db.prepare('DELETE FROM password_resets WHERE user_id=?').run(reset.user_id);
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(reset.user_id);
    store.log({ username: 'password-recovery' }, 'password-reset', 'users', reset.user_id, null, null);
    return { ok: true };
  });
}
export function setDisabled(store, actor, id, disabled) {
  permit(actor, ['admin']);
  if (id === actor.id) throw new AppError('You cannot disable your own account.');
  if (!store.db.prepare('SELECT id FROM users WHERE id=?').get(id)) throw new AppError('User not found.', 404);
  store.transaction(() => {
    store.db.prepare('UPDATE users SET disabled=? WHERE id=?').run(disabled ? 1 : 0, id);
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    store.log(actor, disabled ? 'disable-account' : 'enable-account', 'users', id, null, { disabled });
  });
}
// Remove a login account (e.g. a demo or duplicate account). Employee records and the audit trail are untouched;
// the deletion itself is audited. Admins cannot delete themselves or the last enabled administrator.
export function deleteUser(store, actor, id, confirmUsername) {
  permit(actor, ['admin']);
  if (id === actor.id) throw new AppError('You cannot delete your own account.');
  const user = store.db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) throw new AppError('User not found.', 404);
  if (String(confirmUsername || '').toLowerCase() !== user.username.toLowerCase()) throw new AppError('Type the account username to confirm the deletion.');
  if (user.role === 'admin' && !user.disabled && store.db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0 AND id<>?").get(id).n === 0) throw new AppError('This is the last enabled administrator account.');
  store.transaction(() => {
    for (const table of ['sessions', 'password_resets', 'recovery_requests']) store.db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(id);
    store.db.prepare('DELETE FROM users WHERE id=?').run(id);
    store.log(actor, 'delete-account', 'users', id, { username: user.username, role: user.role, employeeId: user.employee_id || null }, null);
  });
  return { ok: true };
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) { let bits = ''; for (const byte of bytes) bits += byte.toString(2).padStart(8, '0'); return bits.match(/.{1,5}/g).map(b => alphabet[parseInt(b.padEnd(5, '0'), 2)]).join(''); }
export function totpCode(secret, now = Date.now()) {
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest(), offset = hash.at(-1) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
function verifyTotp(secret, code, lastStep = null) {
  if (!/^\d{6}$/.test(code)) throw new AppError('Enter your six-digit authenticator code.', 401);
  const current = Math.floor(Date.now() / 30000);
  for (const step of [current, current - 1, current + 1]) if ((lastStep === null || step > lastStep) && timingSafeEqual(Buffer.from(totpCode(secret, step * 30000)), Buffer.from(code))) return step;
  throw new AppError('Authenticator code is invalid or already used. Wait for the next code.', 401);
}
export async function configureMfa(store, user, input) {
  const row = store.db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  const hash = await passwordHash(input.password || '', row.password_hash.split(':')[0]);
  if (!timingSafeEqual(Buffer.from(hash), Buffer.from(row.password_hash))) throw new AppError('Current password is incorrect.', 401);
  return store.transaction(() => {
  const current = store.db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if (current.disabled || current.password_hash !== row.password_hash || current.mfa_secret !== row.mfa_secret || current.mfa_pending !== row.mfa_pending) throw new AppError('Account changed during this request. Sign in again.', 409);
  if (input.action === 'begin') {
    if (row.mfa_secret) throw new AppError('Two-factor authentication is already enabled.');
    const secret = base32(randomBytes(20)); store.db.prepare('UPDATE users SET mfa_pending=? WHERE id=?').run(secret, user.id);
    return { secret, issuer: 'GDS CAPITAL INC.', account: user.username };
  }
  if (input.action === 'confirm') {
    if (!row.mfa_pending) throw new AppError('Start two-factor setup first.');
    const step = verifyTotp(row.mfa_pending, input.code);
    store.db.prepare('UPDATE users SET mfa_secret=mfa_pending,mfa_pending=NULL,mfa_last_step=? WHERE id=?').run(step, user.id);
  } else if (input.action === 'disable') {
    if (!row.mfa_secret) throw new AppError('Two-factor authentication is not enabled.');
    verifyTotp(row.mfa_secret, input.code);
    store.db.prepare('UPDATE users SET mfa_secret=NULL,mfa_pending=NULL,mfa_last_step=NULL WHERE id=?').run(user.id);
  } else throw new AppError('Unknown two-factor action.');
  store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  store.log(user, `mfa-${input.action}`, 'users', user.id, null, null);
  return { ok: true, signInAgain: true };
  });
}
