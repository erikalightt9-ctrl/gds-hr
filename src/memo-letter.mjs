// A memo as a PDF letter on the GDS memo letterhead (Nov 20, 2026): the 菲龍集團 GDS Capital logo at the top, Ref. no.,
// Date, To, From, Subject, the memo text over as many A4 pages as it needs, and the office address in the footer.
// HR roles open any memo (drafts print with a DRAFT band); employees only a version addressed to them.
// System memos that already carry their own PDF (e.g. the monthly tardiness memo) return that PDF unchanged.
import { AppError, permit } from './service.mjs';
import { HR_TEAM } from './roles.mjs';
import { letterPdf } from './discipline-pdf.mjs';
import { fullNameOf, displayName } from './staff-names.mjs';

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
  const filename = `${safeName(content.reference || content.title)}.pdf`;
  // A system memo issued with its own letterhead PDF: that PDF is the memo.
  const own = memo.kind && (content.attachments || memo.attachments || []).find(a => a.mime === 'application/pdf');
  if (own) {
    const row = store.db.prepare('SELECT content FROM memo_attachments WHERE id=?').get(own.id);
    if (row) return { filename, body: row.content };
  }
  const from = !content.publishedBy || content.publishedBy === 'system' ? 'Human Resources Department' : fullNameOf(store, content.publishedBy);
  const body = letterPdf({
    title: 'Memorandum',
    fields: [['Ref. no.', content.reference || '-'], ['Date', longDate(content.issueDate)], ['To', addressee(store, content.recipients)], ['From', from], ['Subject', content.title]],
    body: String(content.body || '').replace(/\r\n/g, '\n'),
    signature: content.publishedBy && content.publishedBy !== 'system' ? [from, 'Human Resources Department'] : [],
    draft,
  });
  return { filename, body };
}
