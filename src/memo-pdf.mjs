// A one-page memo on the GDS letterhead (GDS MEMO TEMPLATE.docx): the 菲龍集團 GDS Capital logo at the top, the memo
// text, an optional table, and the office address centred in the footer. Dependency-free PDF (Helvetica, A4).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Page, COLOR, W, H, assemblePdf, jpegFile, textWidth } from './payslip-pdf.mjs';

const LETTERHEAD = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/memo-letterhead.jpg');
export const MEMO_FOOTER = '104 Paseo de Roxas Salustiana D. Ty Tower Legaspi Vil San Lorenzo Makati City   |   (02) 7368-0000';
const MARGIN = 72, RIGHT = W - 72, TEXT_WIDTH = RIGHT - MARGIN;

// Splits text into lines that fit the given width (Helvetica metrics).
function wrap(text, size, width, bold = false) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > width) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

// memo: { reference, date, to, from, subject, paragraphs: [before table], table: { headers, rows, widths }, after: [paragraphs], signature: [lines] }
export function renderMemoPdf(memo) {
  const p = new Page(), image = jpegFile(LETTERHEAD);
  let y = H - 40;
  if (image) { const h = 74, w = h * image.width / image.height; p.image(MARGIN - 12, y - h, w, h); y -= h + 18; }
  else { p.text('GDS CAPITAL', MARGIN, y - 30, { size: 22, bold: true, color: COLOR.red }); y -= 50; }
  p.text('MEMORANDUM', MARGIN, y, { size: 14, bold: true, color: COLOR.red }); y -= 20;
  for (const [label, value] of [['Ref. no.', memo.reference], ['Date', memo.date], ['To', memo.to], ['From', memo.from], ['Subject', memo.subject]]) {
    p.text(`${label}:`, MARGIN, y, { size: 10, bold: true }); p.text(value, MARGIN + 70, y, { size: 10, bold: label === 'Subject' }); y -= 15;
  }
  y -= 2; p.line(MARGIN, y, RIGHT, y, COLOR.gold, 1); y -= 18;
  const paragraph = text => { for (const line of wrap(text, 10, TEXT_WIDTH)) { p.text(line, MARGIN, y, { size: 10 }); y -= 13.5; } y -= 6; };
  (memo.paragraphs || []).forEach(paragraph);
  if (memo.table) {
    const { headers, rows, widths } = memo.table, total = widths.reduce((s, n) => s + n, 0), cols = widths.map(n => n / total * TEXT_WIDTH);
    const xs = cols.map((_, i) => MARGIN + cols.slice(0, i).reduce((s, n) => s + n, 0));
    p.fill(COLOR.goldTint, MARGIN, y - 6, TEXT_WIDTH, 18); p.stroke(MARGIN, y - 6, TEXT_WIDTH, 18);
    headers.forEach((h, i) => p.text(h, xs[i] + 5, y, { size: 8.5, bold: true })); y -= 18;
    for (const row of rows) { row.forEach((c, i) => p.text(String(c), xs[i] + 5, y, { size: 9 })); p.line(MARGIN, y - 5, RIGHT, y - 5); y -= 15; }
    y -= 10;
  }
  (memo.after || []).forEach(paragraph);
  y -= 8;
  (memo.signature || []).forEach((line, i) => { p.text(line, MARGIN, y, { size: 10, bold: i === 0 }); y -= 13.5; });
  // Footer as in the template: the office address, centred.
  p.line(MARGIN, 52, RIGHT, 52, COLOR.gold, 0.8);
  p.text(MEMO_FOOTER, W / 2, 38, { size: 8.5, color: COLOR.muted, align: 'center' });
  return assemblePdf(p, image);
}
