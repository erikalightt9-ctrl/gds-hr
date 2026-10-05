// HTTP routes for the HR 201 modules (/api/hr/...). Every handler enforces its own permission on the server.
import { AppError, permit } from './service.mjs';
import { visibleAudit, uploadDocument } from './profiles.mjs';
import { readSettings, saveSettings, directory, createEmployee, updateEmployee, employeeForm, archiveEmployee, restoreEmployee, dashboard, assertCanView } from './hr201.mjs';
import { checklistFor, employeeChecklist, upload201, reviewDocument, setNotApplicable, document201Content, documentSummary } from './documents201.mjs';
import { saveMemoDraft, publishMemo, startRevision, saveRevision, archiveMemo, deleteMemoDraft, addMemoAttachment, memoAttachment, listMemos, memoDetail, myMemos, acknowledgeMemo, memoSummary, memosForEmployee } from './memos.mjs';
import { saveTraining, deleteTraining, assignParticipants, updateParticipant, listTrainings, trainingDetail, myTrainings, trainingSummary, trainingsForEmployee } from './trainings.mjs';
import { mySheet, saveMySheet, listSheets, sheetDetail, reviewSheet, pendingSheets } from './datasheets.mjs';
import { HR_TEAM, DIRECTORY, DASHBOARD, ROLE_LABELS } from './roles.mjs';

const BIG = 28_500_000;
const fileHeaders = (meta, download) => ({ 'Content-Type': meta.mime, 'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="document"; filename*=UTF-8''${encodeURIComponent(meta.name)}`, 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" });

// Activity for one employee, without values (so sensitive identifiers never show in the general log).
function activityFor(store, actor, id) {
  return visibleAudit(store, actor).filter(a => a.recordId === id || a.after?.employeeId === id || a.before?.employeeId === id).slice(0, 200)
    .map(a => ({ at: a.at, actor: a.actor, action: a.action, area: a.kind.replace(/^profile:/, 'Profile · ').replace(/^document:/, 'Document · ') }));
}
function overviewExtras(store, actor) {
  const docs = HR_TEAM.includes(actor.role) ? documentSummary(store, actor) : null, memos = memoSummary(store, actor), trainings = trainingSummary(store, actor);
  return {
    totals: { missingDocuments: docs?.missingDocuments ?? null, employeesMissing: docs?.employeesMissing ?? null, pendingAcks: memos.pending, overdueAcks: memos.overdue, upcomingTrainings: trainings.upcoming, pendingSheets: HR_TEAM.includes(actor.role) ? pendingSheets(store) : null, documentsToReview: docs?.pendingReview ?? null, expiredDocuments: docs?.expired ?? null, expiringDocuments: docs?.expiringSoon ?? null, overdueDocuments: docs?.overdue ?? null },
    sections: { missing: docs ? docs.rows.filter(r => r.required && ['Missing', 'Rejected', 'Expired'].includes(r.status)).slice(0, 12) : [], nextTrainings: trainings.next, overdueMemos: memos.rows.filter(r => r.overdue).slice(0, 8) },
  };
}

export async function handleHrRoutes({ req, res, pathname, url, auth, store, send, readBody }) {
  if (!pathname.startsWith('/api/hr/')) return false;
  const actor = auth.user, method = req.method, m = re => pathname.match(re);
  let p;

  // ---------- Employee self-service ----------
  if (pathname.startsWith('/api/hr/me/')) {
    permit(actor, ['employee']);
    if (pathname === '/api/hr/me/memos' && method === 'GET') { send(200, myMemos(store, actor)); return true; }
    if ((p = m(/^\/api\/hr\/me\/memos\/([a-f0-9-]+)\/(\d+)\/acknowledge$/)) && method === 'POST') { send(200, acknowledgeMemo(store, actor, p[1], Number(p[2]))); return true; }
    if (pathname === '/api/hr/me/trainings' && method === 'GET') { send(200, myTrainings(store, actor)); return true; }
    if ((p = m(/^\/api\/hr\/me\/trainings\/([a-f0-9-]+)\/registration$/)) && method === 'POST') { const b = await readBody(req); send(200, updateParticipant(store, actor, p[1], actor.employeeId, { registration: b.registration })); return true; }
    if (pathname === '/api/hr/me/datasheet' && method === 'GET') { send(200, mySheet(store, actor)); return true; }
    if (pathname === '/api/hr/me/datasheet' && method === 'POST') { const b = await readBody(req); send(200, saveMySheet(store, actor, b.fields, !!b.submit)); return true; }
    if (pathname === '/api/hr/me/documents' && method === 'GET') { send(200, employeeChecklist(store, actor, actor.employeeId)); return true; }
    if (pathname === '/api/hr/me/documents' && method === 'POST') { send(201, upload201(store, actor, actor.employeeId, await readBody(req, BIG))); return true; }
    if ((p = m(/^\/api\/hr\/me\/documents\/([a-f0-9-]+)\/content$/)) && method === 'GET') { const { meta, content } = document201Content(store, actor, p[1]); res.writeHead(200, fileHeaders(meta, url.searchParams.has('download'))); res.end(content); return true; }
    if ((p = m(/^\/api\/hr\/me\/memo-attachments\/([a-f0-9-]+)$/)) && method === 'GET') { const row = memoAttachment(store, actor, p[1]); res.writeHead(200, fileHeaders(row, url.searchParams.has('download'))); res.end(row.content); return true; }
    throw new AppError('Not found.', 404);
  }
  if (actor.role === 'employee') throw new AppError('This area is restricted to authorized staff.', 403);

  // ---------- Shared ----------
  if (pathname === '/api/hr/context' && method === 'GET') {
    permit(actor, DASHBOARD);
    const s = readSettings(store);
    send(200, { roleLabel: ROLE_LABELS[actor.role], company: s.company, departments: s.departments, positions: s.positions, classifications: s.classifications, requirements: s.documentRequirements.map(r => ({ id: r.id, name: r.name, category: r.category, required: r.required, expires: r.expires, restricted: r.restricted })), optionalFields: s.optionalFields, uploads: s.uploads, can: { manage: HR_TEAM.includes(actor.role), approve: ['admin', 'hr'].includes(actor.role), settings: actor.role === 'admin', sensitiveIds: ['admin', 'hr', 'payroll'].includes(actor.role) } });
    return true;
  }
  if (pathname === '/api/hr/settings' && method === 'GET') { permit(actor, ['admin']); send(200, readSettings(store)); return true; }
  if (pathname === '/api/hr/settings' && method === 'POST') { send(200, saveSettings(store, actor, await readBody(req, 512000))); return true; }
  if (pathname === '/api/hr/dashboard' && method === 'GET') { send(200, dashboard(store, actor, overviewExtras(store, actor))); return true; }
  if (pathname === '/api/hr/notifications' && method === 'GET') {
    permit(actor, DASHBOARD);
    const items = [];
    if (HR_TEAM.includes(actor.role)) {
      const docs = documentSummary(store, actor), sheets = pendingSheets(store);
      if (sheets) items.push({ text: `${sheets} data sheet${sheets === 1 ? '' : 's'} awaiting review`, nav: 'datasheets' });
      if (docs.pendingReview) items.push({ text: `${docs.pendingReview} document${docs.pendingReview === 1 ? '' : 's'} to review`, nav: 'files', filter: 'review' });
      if (docs.expired) items.push({ text: `${docs.expired} expired document${docs.expired === 1 ? '' : 's'}`, nav: 'files', filter: 'expired' });
      if (docs.overdue) items.push({ text: `${docs.overdue} overdue document submission${docs.overdue === 1 ? '' : 's'}`, nav: 'files', filter: 'missing' });
    }
    const memos = memoSummary(store, actor);
    if (memos.overdue) items.push({ text: `${memos.overdue} overdue memo acknowledgement${memos.overdue === 1 ? '' : 's'}`, nav: 'memos' });
    send(200, { count: items.length, items }); return true;
  }

  // ---------- Employees / 201 ----------
  if (pathname === '/api/hr/employees' && method === 'GET') {
    const people = directory(store, actor);
    if (!HR_TEAM.includes(actor.role)) { send(200, people); return true; }
    // HR sees each employee's 201 progress in the directory.
    const settings = readSettings(store), employees = new Map(store.read().employees.map(e => [e.id, e]));
    send(200, people.map(p => { const c = checklistFor(store, actor, employees.get(p.id), settings); return { ...p, documents: { percent: c.percent, required: c.requiredCount, verified: c.completeCount, missing: c.items.filter(i => i.requirement.required && ['Missing', 'Rejected', 'Expired'].includes(i.status)).length, review: c.items.filter(i => ['Submitted', 'Under Review'].includes(i.status)).length, expired: c.items.filter(i => i.status === 'Expired').length } }; }));
    return true;
  }
  if ((p = m(/^\/api\/hr\/employees\/([^/]+)\/photo$/))) {
    const id = decodeURIComponent(p[1]);
    if (method === 'GET') {
      assertCanView(store, actor, id);
      const row = store.db.prepare('SELECT metadata, content FROM employee_documents WHERE employee_id=?').all(id).map(r => ({ meta: JSON.parse(r.metadata), content: r.content })).filter(r => r.meta.type === 'Photo' && r.meta.status === 'Active').sort((a, b) => b.meta.uploadedAt.localeCompare(a.meta.uploadedAt))[0];
      if (!row) throw new AppError('No photo.', 404);
      res.writeHead(200, { 'Content-Type': row.meta.mime, 'Cache-Control': 'private, no-store' }); res.end(row.content); return true;
    }
    if (method === 'POST') {
      permit(actor, HR_TEAM);
      const body = await readBody(req, 4_000_000), limit = readSettings(store).uploads.photoMB;
      if (!['image/png', 'image/jpeg'].includes(body.mime)) throw new AppError('Use a JPG or PNG photo.');
      if (Buffer.from(String(body.data || ''), 'base64').length > limit * 1024 * 1024) throw new AppError(`Photos can be up to ${limit} MB.`);
      send(201, uploadDocument(store, { ...actor, role: 'hr' }, id, { type: 'Photo', name: body.name, mime: body.mime, data: body.data })); return true;
    }
  }
  if (pathname === '/api/hr/employees' && method === 'POST') { send(201, createEmployee(store, actor, await readBody(req))); return true; }
  if ((p = m(/^\/api\/hr\/employees\/([^/]+)$/))) {
    const id = decodeURIComponent(p[1]);
    if (method === 'GET') { send(200, employeeForm(store, actor, id)); return true; }
    if (method === 'POST') { send(200, updateEmployee(store, actor, id, await readBody(req))); return true; }
  }
  if ((p = m(/^\/api\/hr\/employees\/([^/]+)\/(archive|restore)$/)) && method === 'POST') { const id = decodeURIComponent(p[1]); send(200, p[2] === 'archive' ? archiveEmployee(store, actor, id, await readBody(req)) : restoreEmployee(store, actor, id)); return true; }
  if ((p = m(/^\/api\/hr\/employees\/([^/]+)\/activity$/)) && method === 'GET') {
    const id = decodeURIComponent(p[1]); assertCanView(store, actor, id);
    send(200, { activity: HR_TEAM.includes(actor.role) ? activityFor(store, actor, id) : [], memos: memosForEmployee(store, actor, id), trainings: trainingsForEmployee(store, id) }); return true;
  }
  if ((p = m(/^\/api\/hr\/employees\/([^/]+)\/documents$/))) {
    const id = decodeURIComponent(p[1]);
    if (method === 'GET') { send(200, employeeChecklist(store, actor, id)); return true; }
    if (method === 'POST') { send(201, upload201(store, actor, id, await readBody(req, BIG))); return true; }
  }
  if ((p = m(/^\/api\/hr\/employees\/([^/]+)\/requirements\/([a-z0-9-]+)$/)) && method === 'POST') { send(200, setNotApplicable(store, actor, decodeURIComponent(p[1]), p[2], await readBody(req))); return true; }
  if ((p = m(/^\/api\/hr\/documents\/([a-f0-9-]+)\/review$/)) && method === 'POST') { send(200, reviewDocument(store, actor, p[1], await readBody(req))); return true; }
  if ((p = m(/^\/api\/hr\/documents\/([a-f0-9-]+)\/content$/)) && method === 'GET') { const { meta, content } = document201Content(store, actor, p[1]); res.writeHead(200, fileHeaders(meta, url.searchParams.has('download'))); res.end(content); return true; }

  // ---------- Memos ----------
  if (pathname === '/api/hr/memos' && method === 'GET') { send(200, listMemos(store, actor)); return true; }
  if (pathname === '/api/hr/memos' && method === 'POST') { send(201, saveMemoDraft(store, actor, null, await readBody(req))); return true; }
  if ((p = m(/^\/api\/hr\/memos\/([a-f0-9-]+)$/))) {
    if (method === 'GET') { send(200, memoDetail(store, actor, p[1])); return true; }
    if (method === 'POST') { send(200, saveMemoDraft(store, actor, p[1], await readBody(req))); return true; }
    if (method === 'DELETE') { send(200, deleteMemoDraft(store, actor, p[1])); return true; }
  }
  if ((p = m(/^\/api\/hr\/memos\/([a-f0-9-]+)\/(publish|revise|revision|archive|attachments)$/)) && method === 'POST') {
    const action = p[2], body = action === 'attachments' ? await readBody(req, 14_500_000) : ['publish', 'revision'].includes(action) ? await readBody(req) : null;
    send(200, action === 'publish' ? publishMemo(store, actor, p[1], body) : action === 'revise' ? startRevision(store, actor, p[1]) : action === 'revision' ? saveRevision(store, actor, p[1], body) : action === 'archive' ? archiveMemo(store, actor, p[1]) : addMemoAttachment(store, actor, p[1], body));
    return true;
  }
  if ((p = m(/^\/api\/hr\/memo-attachments\/([a-f0-9-]+)$/)) && method === 'GET') { const row = memoAttachment(store, actor, p[1]); res.writeHead(200, fileHeaders(row, url.searchParams.has('download'))); res.end(row.content); return true; }

  // ---------- Trainings ----------
  if (pathname === '/api/hr/trainings' && method === 'GET') { send(200, listTrainings(store, actor)); return true; }
  if (pathname === '/api/hr/trainings' && method === 'POST') { send(201, saveTraining(store, actor, null, await readBody(req))); return true; }
  if ((p = m(/^\/api\/hr\/trainings\/([a-f0-9-]+)$/))) {
    if (method === 'GET') { send(200, trainingDetail(store, actor, p[1])); return true; }
    if (method === 'POST') { send(200, saveTraining(store, actor, p[1], await readBody(req))); return true; }
    if (method === 'DELETE') { send(200, deleteTraining(store, actor, p[1])); return true; }
  }
  if ((p = m(/^\/api\/hr\/trainings\/([a-f0-9-]+)\/participants$/)) && method === 'POST') { send(200, assignParticipants(store, actor, p[1], await readBody(req))); return true; }
  if ((p = m(/^\/api\/hr\/trainings\/([a-f0-9-]+)\/participants\/([^/]+)$/)) && method === 'POST') { send(200, updateParticipant(store, actor, p[1], decodeURIComponent(p[2]), await readBody(req))); return true; }

  // ---------- Data sheets ----------
  if (pathname === '/api/hr/datasheets' && method === 'GET') { send(200, listSheets(store, actor)); return true; }
  if ((p = m(/^\/api\/hr\/datasheets\/([a-f0-9-]+)$/)) && method === 'GET') { send(200, sheetDetail(store, actor, p[1])); return true; }
  if ((p = m(/^\/api\/hr\/datasheets\/([a-f0-9-]+)\/review$/)) && method === 'POST') { send(200, reviewSheet(store, actor, p[1], await readBody(req))); return true; }

  permit(actor, DIRECTORY);
  throw new AppError('Not found.', 404);
}
