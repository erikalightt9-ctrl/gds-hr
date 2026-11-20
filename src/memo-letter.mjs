// A memo as a PDF letter on the issuing company's letterhead (Nov 20, 2026): logo at the top (GDS CAPITAL INC. memo
// letterhead, or the Philippine Dragon Media Network logo), company name, Ref. no., Date, Effective date, Category,
// To, From, Subject, the memo text over as many A4 pages as it needs, the attachments' names, the issuer's signature
// and the office address in the footer. The PDF of an issued version is rendered once and kept (memo_pdfs), so the
// exact published document is what everyone opens later. HR roles open any memo (drafts print with a DRAFT band);
// employees only a version addressed to them. System memos with their own PDF (the monthly tardiness memo) return it.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AppError, permit } from './service.mjs';
import { HR_TEAM } from './roles.mjs';
import { letterPdf } from './discipline-pdf.mjs';
import { fullNameOf, displayName } from './staff-names.mjs';
import { ensureTracking } from './memo-tracking.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
const LOGOS = { 'GDS CAPITAL INC.': path.join(PUBLIC, 'memo-letterhead.jpg'), 'Philippine Dragon Media Network': path.join(PUBLIC, 'payslip-logo-pdmn.jpg') };
const read = (store, id) => { const row = store.db.prepare('SELECT data FROM memos WHERE id=?').get(id); if (!row) throw new AppError('Memo not found.', 404); return JSON.parse(row.data); };
const longDate = d => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '-');
const safeName = s => String(s || 'memo').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'memo';

function addressee(store, recipients) {
  if (!recipients || recipients.mode === 'all') return 'All employees';
  if (recipients.mode === 'departments') return recipients.departments.join(', ') || '-';
  const names = new Map(store.read().employees.map(e => [e.id, e.name]));
  const list = recipients.employees.map(id => (names.has(id) ? displayName(names.get(id)) : id));
  return list.length > 6 ? `${list.length} employees (named in the memo record)` : list.join('; ');
}
function render(store, content, draft) {
  const company = content.company || 'GDS CAPITAL INC.';
  const from = !content.publishedBy || content.publishedBy === 'system' ? 'Human Resources Department' : fullNameOf(store, content.publishedBy);
  const fields = [['Ref. no.', content.reference || (draft ? 'Assigned on issue' : '-')], ['Date', longDate(content.issueDate)], ...(content.effectiveDate ? [['Effective', longDate(content.effectiveDate)]] : []), ['Category', content.category || '-'], ['To', addressee(store, content.recipients)], ['From', draft ? 'Human Resources Department' : from], ['Subject', content.title]];
  const files = (content.attachments || []).map(a => a.name);
  const body = String(content.body || '').replace(/\r\n/g, '\n') + (files.length ? `\n\nAttachments (open them in GDS TimeHub with this memo): ${files.join('; ')}` : '');
  return letterPdf({ title: 'Memorandum', company, letterhead: LOGOS[company] || LOGOS['GDS CAPITAL INC.'], fields, body, signature: !draft && content.publishedBy && content.publishedBy !== 'system' ? [from, 'Human Resources Department'] : [], draft });
}
// The exact published PDF of one issued version (rendered on first use and kept).
export function officialPdf(store, memo, content) {
  ensureTracking(store);
  const kept = store.db.prepare('SELECT content FROM memo_pdfs WHERE memo_id=? AND version=?').get(memo.id, content.version);
  if (kept) return kept.content;
  const own = memo.kind && (content.attachments || memo.attachments || []).find(a => a.mime === 'application/pdf');
  const ownRow = own && store.db.prepare('SELECT content FROM memo_attachments WHERE id=?').get(own.id);
  const pdf = ownRow ? ownRow.content : render(store, content, false);
  store.db.prepare('INSERT OR IGNORE INTO memo_pdfs(memo_id,version,content,created_at) VALUES(?,?,?,?)').run(memo.id, content.version, pdf, new Date().toISOString());
  return pdf;
}

export function memoPdf(store, actor, id, version = null) {
  const memo = read(store, id);
  let content, draft = false;
  if (actor.role === 'employee') {
    const rows = store.db.prepare('SELECT version FROM memo_assignments WHERE memo_id=? AND employee_id=? ORDER BY version').all(id, actor.employeeId).map(r => r.version);
    const wanted = version ?? rows.at(-1);
    if (!rows.includes(wanted)) throw new AppError('This memo is not addressed to you.', 403);
    content = memo.versions.find(v => v.version === wanted);
  } else {
    permit(actor, [...HR_TEAM, 'viewer', 'dept_manager']);
    if (memo.status === 'draft' && !HR_TEAM.includes(actor.role)) throw new AppError('Memo not found.', 404);
    content = version ? memo.versions.find(v => v.version === version) : memo.versions.at(-1);
    if (!content && memo.draft) { content = memo.draft; draft = true; }
  }
  if (!content) throw new AppError('Memo not found.', 404);
  const filename = `${safeName(content.reference || content.title)}${draft ? '-DRAFT' : ''}.pdf`;
  return { filename, body: draft ? render(store, content, true) : officialPdf(store, memo, content) };
}
