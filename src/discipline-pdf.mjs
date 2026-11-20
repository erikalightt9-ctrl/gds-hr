// Due process documents as PDF letters on the GDS memo letterhead, as many A4 pages as the text needs: incident
// report, Notice to Explain, Notice of Administrative Hearing, Notice of Decision and the employee's explanation.
// Unissued texts print with a DRAFT band. A receipt block is printed under notices addressed to the employee.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AppError, permit } from './service.mjs';
import { Page, COLOR, W, H, jpegFile, textWidth } from './payslip-pdf.mjs';
import { MEMO_FOOTER } from './memo-pdf.mjs';
import { readDpSettings, fillTemplate, TEMPLATE_TITLES } from './discipline-settings.mjs';
import { VIEW, readCase, templateVars, longDate } from './discipline.mjs';
import { localToday } from './profiles.mjs';

const LETTERHEAD = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/memo-letterhead.jpg');
const MARGIN = 72, RIGHT = W - 72, WIDTH = RIGHT - MARGIN, BOTTOM = 80;
function wrap(text, size, width) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) { const next = line ? `${line} ${word}` : word; if (line && textWidth(next, size) > width) { lines.push(line); line = word; } else line = next; }
    lines.push(line);
  }
  return lines;
}
export function letterPdf({ title, fields, body, signature = [], receipt = false, draft = false, letterhead = LETTERHEAD, company = '' }) {
  const image = letterhead && typeof letterhead === 'object' ? letterhead : jpegFile(letterhead), pages = [];
  let p, y;
  const newPage = () => {
    p = new Page(); pages.push(p); y = H - 40;
    if (image) { const h = 74, w = h * image.width / image.height; p.image(MARGIN - 12, y - h, w, h); y -= h + 18; } else { p.text(company || 'GDS CAPITAL', MARGIN, y - 30, { size: 22, bold: true, color: COLOR.red }); y -= 50; }
    if (draft) { p.fill(COLOR.red, 0, H - 22, W, 22); p.text('DRAFT - NOT ISSUED', W / 2, H - 15, { size: 10, bold: true, color: COLOR.white, align: 'center' }); }
    p.line(MARGIN, 52, RIGHT, 52, COLOR.gold, 0.8); p.text(MEMO_FOOTER, W / 2, 38, { size: 8.5, color: COLOR.muted, align: 'center' });
  };
  const room = need => { if (y - need < BOTTOM) newPage(); };
  newPage();
  if (company) { p.text(company, MARGIN, y, { size: 11, bold: true }); y -= 18; }
  p.text(title.toUpperCase(), MARGIN, y, { size: 14, bold: true, color: COLOR.red }); y -= 20;
  for (const [label, value] of fields) { room(15); p.text(`${label}:`, MARGIN, y, { size: 10, bold: true }); for (const [i, line] of wrap(value || '-', 10, WIDTH - 80).entries()) { if (i) { y -= 13; room(13); } p.text(line, MARGIN + 80, y, { size: 10, bold: label === 'Subject' }); } y -= 15; }
  y -= 2; p.line(MARGIN, y, RIGHT, y, COLOR.gold, 1); y -= 18;
  for (const line of wrap(body, 10, WIDTH)) { room(14); p.text(line, MARGIN, y, { size: 10 }); y -= 13.5; }
  y -= 18;
  if (signature.length) { room(signature.length * 14 + 30); y -= 18; p.line(MARGIN, y + 12, MARGIN + 200, y + 12); signature.forEach((line, i) => { p.text(line, MARGIN, y, { size: 10, bold: i === 0 }); y -= 13.5; }); }
  if (receipt) { room(80); y -= 22; p.text('RECEIVED BY THE EMPLOYEE', MARGIN, y, { size: 9, bold: true, color: COLOR.red }); y -= 30; p.line(MARGIN, y + 10, MARGIN + 200, y + 10); p.line(MARGIN + 250, y + 10, MARGIN + 380, y + 10); p.text('Signature over printed name', MARGIN, y, { size: 8.5, color: COLOR.muted }); p.text('Date and time received', MARGIN + 250, y, { size: 8.5, color: COLOR.muted }); }
  pages.forEach((page, i) => page.text(`Page ${i + 1} of ${pages.length}`, RIGHT, 24, { size: 8, color: COLOR.muted, align: 'right' }));
  return assemble(pages, image);
}
function assemble(pages, image) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'];
  const imageId = image ? 6 : null; if (image) objects.push(null);
  const kids = [];
  for (const page of pages) {
    const stream = page.ops.join('\n'), id = objects.length + 1; kids.push(id);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>${image ? ` /XObject << /Logo ${imageId} 0 R >>` : ''} >> /Contents ${id + 1} 0 R >>`, `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets = []; let size = parts[0].length;
  const push = b => { parts.push(b); size += b.length; };
  objects.forEach((o, i) => {
    offsets.push(size);
    if (o === null) { push(Buffer.from(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.components === 1 ? 'DeviceGray' : image.components === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n`, 'latin1')); push(image.data); push(Buffer.from('\nendstream\nendobj\n', 'latin1')); }
    else push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
  });
  const xref = size, count = objects.length + 1;
  push(Buffer.from(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

// kind: incident | nte | hearing | decision | explanation. Employees: only notices issued to them and their explanation.
export function casePdf(store, actor, id, kind) {
  const c = readCase(store, id);
  if (actor.role === 'employee') {
    const issued = { nte: c.nte?.issuedAt, hearing: c.hearing?.noticeIssuedAt, decision: c.decision?.issuedAt, review: c.review?.issuedAt, explanation: c.explanation?.submittedAt }[kind];
    if (c.employeeId !== actor.employeeId || !issued) throw new AppError('Document not found.', 404);
  } else permit(actor, VIEW);
  const to = `${c.employee.name} (${c.employee.number})${c.employee.position ? `, ${c.employee.position}` : ''}${c.employee.department ? `, ${c.employee.department}` : ''}`;
  const from = c.incident.issuingOfficer, settings = readDpSettings(store), sign = [from, 'Issuing officer', 'GDS CAPITAL INC.'];
  let doc;
  if (kind === 'incident') doc = { title: TEMPLATE_TITLES.incident, fields: [['Ref. no.', c.reference], ['Date', longDate(c.createdAt)], ['Employee', to], ['Subject', `Incident on ${longDate(c.incident.date)}: ${c.incident.offense}`]], body: fillTemplate(settings.templates.incident, templateVars(c)) + (c.incident.witnesses ? `\n\nWitnesses: ${c.incident.witnesses}` : '') };
  else if (kind === 'nte' && c.nte) doc = { title: TEMPLATE_TITLES.nte, fields: [['Ref. no.', c.nte.reference || `${c.reference}-NTE`], ['Date', longDate(c.nte.issuedAt || localToday())], ['To', to], ['From', from], ['Subject', `Notice to Explain: ${c.incident.offense}`]], body: c.nte.body, signature: sign, receipt: true, draft: !c.nte.issuedAt };
  else if (kind === 'hearing' && c.hearing?.body) doc = { title: TEMPLATE_TITLES.hearing, fields: [['Ref. no.', c.reference], ['Date', longDate(c.hearing.noticeIssuedAt)], ['To', to], ['From', from], ['Subject', `Administrative hearing on ${longDate(c.hearing.scheduledAt)} at ${c.hearing.scheduledAt.slice(11, 16)}`]], body: c.hearing.body, signature: sign, receipt: true };
  else if (kind === 'decision' && c.decision) doc = { title: TEMPLATE_TITLES.decision, fields: [['Ref. no.', c.decision.reference || `${c.reference}-NOD`], ['Date', longDate(c.decision.issuedAt || localToday())], ['To', to], ['From', from], ['Subject', `Decision: ${c.decision.sanction}`]], body: c.decision.body, signature: sign, receipt: true, draft: !c.decision.issuedAt };
  else if (kind === 'review' && c.review?.issuedAt) doc = { title: 'Review / Appeal Outcome', fields: [['Ref. no.', c.review.reference], ['Date', longDate(c.review.issuedAt)], ['To', to], ['From', from], ['Subject', `Review of the decision ${c.decision.reference}: ${c.review.outcome}${c.review.outcome === 'Modified' ? ` (${c.review.sanction})` : ''}`]], body: c.review.body, signature: sign, receipt: true };
  else if (kind === 'explanation' && c.explanation?.text) doc = { title: TEMPLATE_TITLES.explanation, fields: [['Ref. no.', c.reference], ['Date', longDate(c.explanation.submittedAt)], ['From', to], ['To', 'Human Resources'], ['Subject', `Reply to the Notice to Explain dated ${longDate(c.nte.issuedAt)}`]], body: `${c.explanation.text}${c.explanation.hearingRequested ? '\n\nI request an administrative hearing / conference.' : ''}`, signature: [c.employee.name, `Submitted through the HR system on ${new Date(c.explanation.submittedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`] };
  if (!doc) throw new AppError('This document has not been prepared yet.', 404);
  store.log(actor, 'download-document', 'discipline', id, null, { reference: c.reference, document: kind });
  return { filename: `${c.reference}-${kind}.pdf`, body: letterPdf(doc) };
}
