import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.mjs';
import { saveRecord, deleteRecord, preview, postPayroll, AppError, permit, entityRoles } from './service.mjs';
import { addUser, login, session, checkLimit, changePassword, requestRecovery, issuePasswordReset, redeemPasswordReset, setDisabled, configureMfa } from './auth.mjs';
import { previewSchema, postSchema } from './schema.mjs';
import { leaveBalance } from './engine.mjs';
import { payrollWorkbook } from './export.mjs';
import { availableReports, buildReport, payrollRunPdf } from './reports.mjs';
import { getProfile, saveProfile, uploadDocument, getDocument, updateDocument, visibleAudit, derivedInformation } from './profiles.mjs';
import { employeeDashboard, punch, applyLeave, attachLeaveProof, reviewLeaveProof, cancelLeave, submitExplanation, reviewExplanation, liveDashboard, correctClock, ownPayslip, payslipPdf, locationAddress, earlierHistory } from './portal.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const loginSchema = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200), otp: z.string().max(6).default('') }).strict();
async function readBody(req, maximum = 256000) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new AppError('Use application/json.', 415);
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maximum) throw new AppError('Request is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new AppError('Invalid JSON.'); }
}
function constantEqual(a, b) { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); }
export function createApp({ store, origin, setupToken, demo = false }) {
  const secure = origin.startsWith('https:');
  return http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https://www.openstreetmap.org; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, origin), pathname = url.pathname;
      if (!pathname.startsWith('/api/')) {
        const files = { '/welcome-mascot.png': ['welcome-mascot.png', 'image/png'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/profiles.js': ['profiles.js', 'text/javascript'], '/portal.js': ['portal.js', 'text/javascript'], '/contributions.js': ['contributions.js', 'text/javascript'], '/culture.js': ['culture.js', 'text/javascript'], '/install.js': ['install.js', 'text/javascript'], '/sw.js': ['sw.js', 'text/javascript'], '/offline.html': ['offline.html', 'text/html'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/icons/icon-192.png': ['icons/icon-192.png', 'image/png'], '/icons/icon-512.png': ['icons/icon-512.png', 'image/png'], '/icons/icon-maskable-512.png': ['icons/icon-maskable-512.png', 'image/png'], '/icons/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png'], '/theme.css': ['theme.css', 'text/css'], '/style.css': ['style.css', 'text/css'] };
        const file = files[pathname];
        if (req.method !== 'GET' || !file) throw new AppError('Not found.', 404);
        const body = await readFile(path.join(directory, '../public', file[0]));
        res.writeHead(200, { 'Content-Type': file[1].startsWith('text/') ? `${file[1]}; charset=utf-8` : file[1] }); res.end(body); return;
      }
      const mutation = req.method !== 'GET';
      if (mutation && req.headers.origin !== origin) throw new AppError('Request origin is not allowed.', 403);
      const client = req.socket.remoteAddress || 'unknown';
      if (pathname === '/api/session' && req.method === 'GET') {
        const auth = session(store, req.headers.cookie);
        send(200, { user: auth?.user || null, csrf: auth?.csrf || null, demo, setup: store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0 }); return;
      }
      if (pathname === '/api/setup' && req.method === 'POST') {
        checkLimit(store, `setup:${client}`);
        const body = await readBody(req);
        if (typeof body.token !== 'string' || !setupToken || !constantEqual(body.token, setupToken)) throw new AppError('The setup code is incorrect.', 403);
        const user = await addUser(store, { username: body.username, password: body.password, role: 'admin' });
        send(201, { user }); return;
      }
      if (pathname === '/api/login' && req.method === 'POST') {
        const body = loginSchema.parse(await readBody(req));
        const auth = await login(store, body.username, body.password, `login:${client}`, body.otp);
        res.setHeader('Set-Cookie', `hr_session=${auth.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure ? '; Secure' : ''}`);
        send(200, { user: auth.user, csrf: auth.csrf, demo }); return;
      }
      if (pathname === '/api/recovery/request' && req.method === 'POST') {
        checkLimit(store, `recovery:${client}`); const body = z.object({ identifier: z.string().trim().min(1).max(80) }).strict().parse(await readBody(req));
        send(200, requestRecovery(store, body.identifier)); return;
      }
      if (pathname === '/api/recovery/reset' && req.method === 'POST') {
        checkLimit(store, `reset:${client}`); const body = z.object({ token: z.string().max(64), password: z.string().min(12).max(200) }).strict().parse(await readBody(req));
        send(200, await redeemPasswordReset(store, body.token, body.password)); return;
      }
      const auth = session(store, req.headers.cookie);
      if (!auth) throw new AppError('Please sign in.', 401);
      if (mutation && !constantEqual(String(req.headers['x-csrf-token'] || ''), auth.csrf)) throw new AppError('Your session token is invalid. Reload and try again.', 403);
      if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const valid = () => !!session(store, req.headers.cookie);
        const changed = () => { if (!valid()) { res.end(); return; } res.write(`event: change\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`); };
        res.write('event: ready\ndata: {}\n\n');
        const remove = store.onChange(changed), heartbeat = setInterval(() => { if (!valid()) res.end(); else res.write(': heartbeat\n\n'); }, 15000);
        res.on('close', () => { clearInterval(heartbeat); remove(); }); return;
      }
      if (pathname === '/api/logout' && req.method === 'POST') {
        store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.tokenHash);
        res.setHeader('Set-Cookie', `hr_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
        send(200, { ok: true }); return;
      }
      if (pathname === '/api/password' && req.method === 'POST') {
        checkLimit(store, `password:${auth.user.id}`);
        const body = z.object({ currentPassword: z.string().max(200), newPassword: z.string().min(12).max(200) }).strict().parse(await readBody(req));
        await changePassword(store, auth.user, body.currentPassword, body.newPassword); send(200, { ok: true }); return;
      }
      if (pathname === '/api/mfa' && req.method === 'POST') {
        checkLimit(store, `mfa:${auth.user.id}`);
        const body = z.object({ action: z.enum(['begin', 'confirm', 'disable']), password: z.string().max(200), code: z.string().max(6).default('') }).strict().parse(await readBody(req));
        send(200, await configureMfa(store, auth.user, body)); return;
      }
      const addressRoute = pathname.match(/^\/api\/location-address\/([a-f0-9-]+)$/);
      if (addressRoute && req.method === 'POST') { checkLimit(store, `geocoding:${auth.user.id}`); send(200, await locationAddress(store, auth.user, addressRoute[1])); return; }
      if (pathname.startsWith('/api/me/')) {
        permit(auth.user, ['employee']);
        if (pathname === '/api/me/dashboard' && req.method === 'GET') { send(200, employeeDashboard(store, auth.user)); return; }
        if (pathname === '/api/me/history' && req.method === 'GET') { send(200, earlierHistory(store, auth.user, url.searchParams.get('before') || '')); return; }
        if (pathname === '/api/me/clock' && req.method === 'POST') { checkLimit(store, `clock:${auth.user.id}`); send(200, punch(store, auth.user, await readBody(req))); return; }
        if (pathname === '/api/me/leaves' && req.method === 'POST') { send(201, applyLeave(store, auth.user, await readBody(req))); return; }
        const cancellation = pathname.match(/^\/api\/me\/leaves\/([a-zA-Z0-9_-]+)\/cancel$/);
        if (cancellation && req.method === 'POST') { send(200, cancelLeave(store, auth.user, cancellation[1])); return; }
        const proofUpload = pathname.match(/^\/api\/me\/leaves\/([a-zA-Z0-9_-]+)\/proof$/);
        if (proofUpload && req.method === 'POST') { send(200, attachLeaveProof(store, auth.user, proofUpload[1], await readBody(req))); return; }
        if (pathname === '/api/me/explanations' && req.method === 'POST') { send(201, submitExplanation(store, auth.user, await readBody(req))); return; }
        if (pathname === '/api/me/documents' && req.method === 'POST') { checkLimit(store, `upload:${auth.user.id}`); send(201, uploadDocument(store, auth.user, auth.user.employeeId, await readBody(req, 7100000))); return; }
        const document = pathname.match(/^\/api\/me\/documents\/([a-f0-9-]+)\/content$/);
        if (document && req.method === 'GET') { const doc = getDocument(store, auth.user, document[1]); res.writeHead(200, { 'Content-Type': doc.mime, 'Content-Disposition': `attachment; filename="supporting-document"; filename*=UTF-8''${encodeURIComponent(doc.name)}` }); res.end(Buffer.from(doc.content)); return; }
        const payslip = pathname.match(/^\/api\/me\/payslips\/([a-f0-9-]+)(\.pdf)?$/);
        if (payslip && req.method === 'GET') {
          const data = ownPayslip(store, auth.user, payslip[1]);
          if (payslip[2]) { store.log(auth.user, 'download-payslip', 'payslip', data.id, null, { employeeId: auth.user.employeeId }); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="payslip-${data.start}-${data.end}.pdf"` }); res.end(payslipPdf(data)); return; }
          send(200, data); return;
        }
        throw new AppError('Not found.', 404);
      }
      // Reports: each report checks the role itself; employees can only reach their own "my-" reports.
      if (pathname === '/api/reports' && req.method === 'GET') { send(200, availableReports(auth.user)); return; }
      const reportFile = pathname.match(/^\/api\/reports\/([a-z0-9-]+)\.(xlsx|pdf)$/);
      if (reportFile && req.method === 'GET') {
        const file = buildReport(store, auth.user, reportFile[1], reportFile[2]);
        res.writeHead(200, { 'Content-Type': file.type, 'Content-Disposition': `attachment; filename="${file.filename}"` });
        res.end(file.body); return;
      }
      // Fail closed: employee sessions can never reach staff records, audits, exports or account management.
      if (auth.user.role === 'employee') throw new AppError('This area is restricted to authorized staff.', 403);
      if (pathname === '/api/live' && req.method === 'GET') { send(200, liveDashboard(store, auth.user)); return; }
      if (pathname === '/api/live/correct' && req.method === 'POST') { send(200, correctClock(store, auth.user, await readBody(req))); return; }
      const explanationReview = pathname.match(/^\/api\/explanations\/([a-f0-9-]+)\/review$/);
      if (explanationReview && req.method === 'POST') { send(200, reviewExplanation(store, auth.user, explanationReview[1], await readBody(req))); return; }
      const proofReview = pathname.match(/^\/api\/leaves\/([a-zA-Z0-9_-]+)\/proof-review$/);
      if (proofReview && req.method === 'POST') { send(200, reviewLeaveProof(store, auth.user, proofReview[1], await readBody(req))); return; }
      const userAction = pathname.match(/^\/api\/users\/([a-f0-9-]+)\/(reset|access)$/);
      if (userAction && req.method === 'POST') {
        permit(auth.user, ['admin']); const body = await readBody(req);
        if (userAction[2] === 'reset') { const v = z.object({ resetMfa: z.boolean().default(false) }).strict().parse(body); send(200, issuePasswordReset(store, auth.user, userAction[1], v.resetMfa)); }
        else { const v = z.object({ disabled: z.boolean() }).strict().parse(body); setDisabled(store, auth.user, userAction[1], v.disabled); send(200, { ok: true }); } return;
      }
      if (pathname === '/api/recovery/requests' && req.method === 'GET') { permit(auth.user, ['admin']); send(200, store.db.prepare('SELECT r.id,r.user_id AS userId,r.created_at AS createdAt,u.username,u.employee_id AS employeeId FROM recovery_requests r JOIN users u ON u.id=r.user_id WHERE resolved=0 ORDER BY r.created_at DESC').all()); return; }
      if (pathname === '/api/state' && req.method === 'GET') {
        const state = store.read();
        // Posted source snapshots are loaded only on demand, not on every navigation.
        state.runs = state.runs.map(run => { const copy = { ...run }; delete copy.sources; return copy; });
        const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
        const balances = state.employees.flatMap(e => state.leaveTypes.map(t => ({ employeeId: e.id, typeId: t.id, ...leaveBalance(state, e, t, asOf) })));
        state.anniversaries = state.employees.map(e => ({ employeeId: e.id, name: e.name, ...derivedInformation(e, {}, asOf) })).filter(e => e.nextAnniversary && (Date.parse(e.nextAnniversary) - Date.parse(asOf)) / 86400000 <= 60);
        send(200, { state, balances, asOf }); return;
      }
      if (pathname === '/api/audit' && req.method === 'GET') { send(200, visibleAudit(store, auth.user)); return; }
      const profileRoute = pathname.match(/^\/api\/employees\/([^/]+)\/(profile|profiles\/([a-z]+)|documents)$/);
      if (profileRoute) {
        const id = decodeURIComponent(profileRoute[1]);
        if (req.method === 'GET' && profileRoute[2] === 'profile') { send(200, getProfile(store, auth.user, id)); return; }
        if (req.method === 'POST' && profileRoute[3]) { send(200, saveProfile(store, auth.user, id, profileRoute[3], await readBody(req))); return; }
        if (req.method === 'POST' && profileRoute[2] === 'documents') { permit(auth.user, ['admin', 'hr']); send(201, uploadDocument(store, auth.user, id, await readBody(req, 7100000))); return; }
      }
      const documentRoute = pathname.match(/^\/api\/documents\/([a-f0-9-]+)(\/content)?$/);
      if (documentRoute) {
        if (req.method === 'GET' && documentRoute[2]) {
          const doc = getDocument(store, auth.user, documentRoute[1]);
          res.writeHead(200, { 'Content-Type': doc.mime, 'Content-Disposition': `${doc.type === 'Photo' ? 'inline' : 'attachment'}; filename="employee-document"; filename*=UTF-8''${encodeURIComponent(doc.name)}` }); res.end(Buffer.from(doc.content)); return;
        }
        if (req.method === 'POST' && !documentRoute[2]) { send(200, updateDocument(store, auth.user, documentRoute[1], await readBody(req))); return; }
      }
      if (pathname === '/api/users') {
        permit(auth.user, ['admin']);
        if (req.method === 'GET') { send(200, store.db.prepare('SELECT id, username, role, employee_id AS employeeId, disabled, mfa_secret IS NOT NULL AS mfaEnabled FROM users ORDER BY username').all()); return; }
        if (req.method === 'POST') { send(201, { user: await addUser(store, await readBody(req), auth.user) }); return; }
      }
      if (pathname.startsWith('/api/records/')) {
        const kind = pathname.split('/')[3];
        if (!entityRoles[kind]) throw new AppError('Not found.', 404);
        permit(auth.user, entityRoles[kind]);
        if (req.method === 'POST') { send(200, saveRecord(store, auth.user, kind, await readBody(req))); return; }
        if (req.method === 'DELETE') { deleteRecord(store, auth.user, kind, url.searchParams.get('id')); send(200, { ok: true }); return; }
      }
      if (pathname === '/api/payroll/preview' && req.method === 'POST') {
        const p = previewSchema.parse(await readBody(req)); send(200, preview(store, p.start, p.end, p.pay13th)); return;
      }
      if (pathname === '/api/payroll/post' && req.method === 'POST') {
        permit(auth.user, ['admin', 'payroll']); send(200, postPayroll(store, auth.user, postSchema.parse(await readBody(req)))); return;
      }
      if (pathname.startsWith('/api/runs/') && req.method === 'GET') {
        const id = pathname.split('/')[3].replace(/\.(xlsx|pdf)$/, ''), run = store.read().runs.find(r => r.id === id);
        if (!run) throw new AppError('Payroll not found.', 404);
        if (pathname.endsWith('.xlsx')) {
          store.log(auth.user, 'export', 'runs', run.id, null, { format: 'xlsx' });
          res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="payroll-${run.start}-${run.end}.xlsx"` });
          res.end(payrollWorkbook(run)); return;
        }
        if (pathname.endsWith('.pdf')) {
          store.log(auth.user, 'export', 'runs', run.id, null, { format: 'pdf' });
          res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="payroll-${run.start}-${run.end}.pdf"` });
          res.end(payrollRunPdf(run)); return;
        }
        send(200, run); return;
      }
      throw new AppError('Not found.', 404);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof z.ZodError) { send(400, { error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }); return; }
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) console.error('HR request failed:', error.name);
      send(status, { error: status === 500 ? 'The request could not be completed. Check the server and try again.' : error.message });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const host = process.env.HR_HOST || '127.0.0.1', port = Number(process.env.HR_PORT || 3400);
  const origin = process.env.HR_ORIGIN || `http://127.0.0.1:${port}`;
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !origin.startsWith('https://')) throw new Error('Remote hosting requires an HTTPS HR_ORIGIN and TLS reverse proxy.');
  const data = path.resolve(process.env.HR_DATA_DIR || path.join(directory, '../data'));
  await mkdir(data, { recursive: true });
  const store = new Store(path.join(data, 'hr.sqlite'));
  const setupToken = process.env.HR_SETUP_TOKEN || randomBytes(24).toString('hex');
  const app = createApp({ store, origin, setupToken });
  app.requestTimeout = 15000; app.headersTimeout = 10000;
  app.listen(port, host, () => {
    console.log(`GDS CAPITAL INC. HR is running at ${origin}`);
    if (!store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n) console.log(`One-time setup code: ${setupToken}\nOpen the app to create your administrator account.`);
  });
  const close = () => { app.closeAllConnections(); app.close(() => { store.close(); process.exit(0); }); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
