// HTTP routes for BIR Form 1601-C, the report library and due process cases. Every handler checks its own role.
import { AppError } from './service.mjs';
import { month1601c, year1601c, saveRow, saveReturn, fileReturn, reopenReturn } from './bir1601c.mjs';
import { export1601c } from './bir1601c-export.mjs';
import { listLibrary, uploadReport, uploadVersion, updateReportInfo, downloadReport } from './report-library.mjs';
import { createCase, updateIncident, addFile, addNote, saveNte, issueNte, toEvaluation, scheduleHearing, recordHearing, saveEvaluation, draftDecision, submitDecision, reviewDecision, issueDecision, closeCase } from './discipline.mjs';
import { listCases, caseDetail, dpOptions, listRecords, recordPriorAction, myCases, acknowledgeNotice, submitExplanation, caseFile } from './discipline-views.mjs';
import { readDpSettings, saveDpSettings } from './discipline-settings.mjs';
import { casePdf } from './discipline-pdf.mjs';
import { permit } from './service.mjs';

const BIG = 28_500_000;
const attachment = (name, type, inline = false) => ({ 'Content-Type': type, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" });
const CASE_ACTIONS = {
  incident: updateIncident, files: addFile, notes: addNote, nte: saveNte, 'issue-nte': (s, a, id) => issueNte(s, a, id), 'no-explanation': toEvaluation, hearing: scheduleHearing, 'hearing-record': recordHearing,
  evaluation: saveEvaluation, decision: draftDecision, 'submit-decision': (s, a, id) => submitDecision(s, a, id), 'review-decision': reviewDecision, 'issue-decision': (s, a, id) => issueDecision(s, a, id), close: closeCase,
};

export async function handleComplianceRoutes({ req, res, pathname, url, auth, store, send, readBody }) {
  const actor = auth.user, method = req.method, q = k => url.searchParams.get(k) || '';
  let p;
  // ---------- Employee: own due process notices ----------
  if (pathname.startsWith('/api/hr/me/cases')) {
    if (pathname === '/api/hr/me/cases' && method === 'GET') { send(200, myCases(store, actor)); return true; }
    if ((p = pathname.match(/^\/api\/hr\/me\/cases\/([a-f0-9-]+)\/acknowledge\/(nte|hearing|decision)$/)) && method === 'POST') { send(200, acknowledgeNotice(store, actor, p[1], p[2])); return true; }
    if ((p = pathname.match(/^\/api\/hr\/me\/cases\/([a-f0-9-]+)\/explanation$/)) && method === 'POST') { send(201, submitExplanation(store, actor, p[1], await readBody(req, BIG))); return true; }
    if ((p = pathname.match(/^\/api\/hr\/me\/cases\/([a-f0-9-]+)\/(nte|hearing|decision|explanation)\.pdf$/)) && method === 'GET') { permit(actor, ['employee']); const f = casePdf(store, actor, p[1], p[2]); res.writeHead(200, attachment(f.filename, 'application/pdf', !!q('view'))); res.end(f.body); return true; }
    if ((p = pathname.match(/^\/api\/hr\/me\/cases\/files\/([a-f0-9-]+)$/)) && method === 'GET') { const row = caseFile(store, actor, p[1]); res.writeHead(200, attachment(row.name, row.mime, true)); res.end(row.content); return true; }
    throw new AppError('Not found.', 404);
  }
  if (!pathname.startsWith('/api/bir1601c') && !pathname.startsWith('/api/report-library') && !pathname.startsWith('/api/discipline')) return false;
  if (actor.role === 'employee') throw new AppError('This area is restricted to authorized staff.', 403);

  // ---------- BIR Form 1601-C ----------
  if (pathname === '/api/bir1601c' && method === 'GET') { send(200, month1601c(store, actor, q('month'))); return true; }
  if (pathname === '/api/bir1601c/year' && method === 'GET') { send(200, year1601c(store, actor, q('year'))); return true; }
  if (pathname === '/api/bir1601c/row' && method === 'POST') { send(200, saveRow(store, actor, await readBody(req))); return true; }
  if (pathname === '/api/bir1601c/return' && method === 'POST') { send(200, saveReturn(store, actor, await readBody(req))); return true; }
  if (pathname === '/api/bir1601c/file' && method === 'POST') { send(200, fileReturn(store, actor, await readBody(req))); return true; }
  if (pathname === '/api/bir1601c/reopen' && method === 'POST') { send(200, reopenReturn(store, actor, await readBody(req))); return true; }
  if ((p = pathname.match(/^\/api\/bir1601c\/(\d{4}-\d{2})\.xlsx$/)) && method === 'GET') { const f = export1601c(store, actor, p[1]); res.writeHead(200, attachment(f.filename, f.type)); res.end(f.body); return true; }

  // ---------- Report library ----------
  if (pathname === '/api/report-library' && method === 'GET') { send(200, listLibrary(store, actor)); return true; }
  if (pathname === '/api/report-library' && method === 'POST') { send(201, uploadReport(store, actor, await readBody(req, 8_000_000))); return true; }
  if ((p = pathname.match(/^\/api\/report-library\/([a-f0-9-]+)\/versions$/)) && method === 'POST') { send(201, uploadVersion(store, actor, p[1], await readBody(req, 8_000_000))); return true; }
  if ((p = pathname.match(/^\/api\/report-library\/([a-f0-9-]+)$/)) && method === 'POST') { send(200, updateReportInfo(store, actor, p[1], await readBody(req))); return true; }
  if ((p = pathname.match(/^\/api\/report-library\/([a-f0-9-]+)\/download$/)) && method === 'GET') { const f = downloadReport(store, actor, p[1], q('version')); res.writeHead(200, attachment(f.name, f.type)); res.end(f.body); return true; }

  // ---------- Due process ----------
  if (pathname === '/api/discipline/options' && method === 'GET') { send(200, dpOptions(store, actor)); return true; }
  if (pathname === '/api/discipline/settings' && method === 'GET') { permit(actor, ['admin']); send(200, readDpSettings(store)); return true; }
  if (pathname === '/api/discipline/settings' && method === 'POST') { send(200, saveDpSettings(store, actor, await readBody(req, 512000))); return true; }
  if (pathname === '/api/discipline/cases' && method === 'GET') { send(200, listCases(store, actor, { status: q('status'), employeeId: q('employeeId'), q: q('q') })); return true; }
  if (pathname === '/api/discipline/cases' && method === 'POST') { send(201, createCase(store, actor, await readBody(req))); return true; }
  if (pathname === '/api/discipline/records' && method === 'GET') { send(200, listRecords(store, actor, q('employeeId'))); return true; }
  if (pathname === '/api/discipline/records' && method === 'POST') { send(201, recordPriorAction(store, actor, await readBody(req))); return true; }
  if ((p = pathname.match(/^\/api\/discipline\/cases\/([a-f0-9-]+)$/)) && method === 'GET') { send(200, caseDetail(store, actor, p[1])); return true; }
  if ((p = pathname.match(/^\/api\/discipline\/cases\/([a-f0-9-]+)\/([a-z-]+)$/)) && method === 'POST' && CASE_ACTIONS[p[2]]) { CASE_ACTIONS[p[2]](store, actor, p[1], await readBody(req, p[2] === 'files' ? BIG : 256000)); send(200, caseDetail(store, actor, p[1])); return true; }
  if ((p = pathname.match(/^\/api\/discipline\/cases\/([a-f0-9-]+)\/(incident|nte|hearing|decision|explanation)\.pdf$/)) && method === 'GET') { const f = casePdf(store, actor, p[1], p[2]); res.writeHead(200, attachment(f.filename, 'application/pdf', !!q('view'))); res.end(f.body); return true; }
  if ((p = pathname.match(/^\/api\/discipline\/files\/([a-f0-9-]+)$/)) && method === 'GET') { const row = caseFile(store, actor, p[1]); res.writeHead(200, attachment(row.name, row.mime, true)); res.end(row.content); return true; }
  throw new AppError('Not found.', 404);
}
