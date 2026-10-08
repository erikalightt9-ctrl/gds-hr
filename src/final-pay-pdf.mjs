// Formal final pay computation (one A4 page) in the GDS payslip style: logo, title, employee and separation
// details, earnings with their basis, deductions, a highlighted net final pay, acknowledgement and signature lines.
import { Page, COLOR, W, H, LEFT, RIGHT, WIDTH, amount, longDate, logo, textWidth, assemblePdf } from './payslip-pdf.mjs';

const CAUSE = { none: 'Resignation / end of contract / just cause', redundancy: 'Redundancy / labor-saving devices', retrenchment: 'Retrenchment / closure / disease' };
// Split text into lines that fit a width (Helvetica metrics).
function wrap(text, width, size) {
  const lines = []; let line = '';
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export function renderFinalPayPdf(record, { designation = '', startDate = '', preparedBy = record.computedBy } = {}) {
  const p = new Page(), image = logo();
  let y = H - 40;
  p.stroke(LEFT, 40, WIDTH, H - 80, COLOR.gold);
  if (image) { const h = 60, w = Math.min(300, h * image.width / image.height); p.image((W - w) / 2, y - h - 8, w, h); y -= h + 20; }
  else { p.text('GDS CAPITAL', W / 2, y - 40, { size: 22, bold: true, color: COLOR.red, align: 'center' }); y -= 60; }
  p.text('FINAL PAY COMPUTATION', W / 2, y - 14, { size: 18, bold: true, align: 'center' }); y -= 24;
  p.line(W / 2 - 90, y, W / 2 + 90, y, COLOR.gold, 1.2); y -= 18;
  p.text('Date computed:', RIGHT - 190, y, { bold: true }); p.text(longDate(record.computedAt || new Date().toISOString()), RIGHT - 12, y, { align: 'right' }); y -= 14;
  p.text('Release on or before:', RIGHT - 190, y, { bold: true }); p.text(longDate(record.releaseDue), RIGHT - 12, y, { align: 'right' }); y -= 18;

  const header = (title, yTop) => { p.fill(COLOR.red, LEFT, yTop - 20, WIDTH, 20); p.text(title, LEFT + 10, yTop - 14, { size: 10, bold: true, color: COLOR.white }); return yTop - 20; };
  y = header('EMPLOYEE INFORMATION', y);
  const cause = record.input?.separationCause || 'none';
  const info = [['Employee name', String(record.name || '').toUpperCase()], ['Employee ID', record.employeeId], ['Designation', designation || '-'],
    ['Date hired', startDate ? longDate(startDate) : '-'], ['Last day / separation date', longDate(record.separationDate)], ['Reason for separation', CAUSE[cause] || cause],
    ['Length of service', `${record.yearsOfService} year${record.yearsOfService === 1 ? '' : 's'} (for separation pay)`], ['Monthly salary / daily rate', `${amount(record.monthlySalary)} / ${amount(record.dailyRate)}`]];
  const KEY = LEFT + 190;
  for (const [label, value] of info) {
    p.line(LEFT, y - 17, RIGHT, y - 17); p.line(KEY, y, KEY, y - 17);
    p.text(label, LEFT + 10, y - 12, { bold: true }); p.text(value, KEY + 10, y - 12); y -= 17;
  }
  y -= 12;

  // Earnings and deductions: item, basis (wrapped, small) and amount.
  const C1 = LEFT + 170, C3 = RIGHT - 95;
  const section = (title, items, totalLabel, total, color) => {
    p.fill(COLOR.goldTint, LEFT, y - 20, WIDTH, 20); p.stroke(LEFT, y - 20, WIDTH, 20);
    p.text(title, LEFT + 10, y - 14, { size: 9, bold: true }); p.text('BASIS', C1 + 10, y - 14, { size: 9, bold: true }); p.text('AMOUNT', RIGHT - 12, y - 14, { size: 9, bold: true, align: 'right' }); y -= 20;
    if (!items.length) { p.line(LEFT, y - 17, RIGHT, y - 17); p.text('None', LEFT + 10, y - 12, { color: COLOR.muted }); y -= 17; }
    for (const i of items) {
      const label = wrap(i.label, C1 - LEFT - 18, 9.5), basis = wrap(i.basis, C3 - C1 - 18, 7.8), h = Math.max(17, 8 + Math.max(label.length * 11, basis.length * 9.5));
      p.line(LEFT, y - h, RIGHT, y - h); p.line(C1, y, C1, y - h); p.line(C3, y, C3, y - h);
      label.forEach((l, k) => p.text(l, LEFT + 10, y - 12 - k * 11));
      basis.forEach((l, k) => p.text(l, C1 + 8, y - 11 - k * 9.5, { size: 7.8, color: COLOR.muted }));
      p.text(amount(i.amount), RIGHT - 12, y - 12, { align: 'right', color });
      y -= h;
    }
    p.fill(COLOR.band, C3 - 150, y - 20, RIGHT - C3 + 150, 20); p.line(LEFT, y - 20, RIGHT, y - 20); p.line(C3, y, C3, y - 20);
    p.text(totalLabel, C3 - 10, y - 13.5, { bold: true, align: 'right' }); p.text(amount(total), RIGHT - 12, y - 13.5, { bold: true, align: 'right', color }); y -= 30;
  };
  section('EARNINGS', record.items.filter(i => i.side === 'earnings'), 'TOTAL EARNINGS', record.gross, COLOR.ink);
  section('DEDUCTIONS', record.items.filter(i => i.side === 'deductions'), 'TOTAL DEDUCTIONS', record.deductions, COLOR.redText);
  y += 10;
  p.fill(COLOR.net, LEFT, y - 28, WIDTH, 28); p.stroke(LEFT, y - 28, WIDTH, 28, COLOR.gold); p.line(C3, y, C3, y - 28, COLOR.gold);
  p.text('NET FINAL PAY', C3 - 10, y - 18, { size: 11.5, bold: true, align: 'right' }); p.text(`PHP ${amount(record.net)}`, RIGHT - 12, y - 18, { size: 12, bold: true, align: 'right' }); y -= 42;
  if (record.notes) { for (const l of wrap(`Notes: ${record.notes}`, WIDTH - 8, 8).slice(0, 3)) { p.text(l, LEFT + 4, y, { size: 8, color: COLOR.muted }); y -= 10; } y -= 4; }

  // Acknowledgement and signatures.
  const sign = Math.min(150, y - 40);
  for (const l of wrap(`I acknowledge receipt of PHP ${amount(record.net)} from GDS CAPITAL INC. as my final pay, computed as shown above.`, WIDTH - 24, 8.5)) { p.text(l, LEFT + 12, sign + 66, { size: 8.5, italic: true }); }
  const line = (x, label, name) => { p.line(x, sign + 20, x + 150, sign + 20, COLOR.ink); if (name) p.text(name, x + 75, sign + 24, { size: 8.5, align: 'center' }); p.text(label, x + 75, sign + 9, { size: 7.5, color: COLOR.muted, align: 'center' }); };
  line(LEFT + 12, 'Prepared by', preparedBy); line(W / 2 - 75, 'Checked / approved by'); line(RIGHT - 162, 'Received by (employee) / date', String(record.name || ''));
  p.text(`Final pay ${String(record.id || '').slice(0, 8)} | Labor Advisory 06-2020: final pay is released within 30 days from separation.`, W / 2, 50, { size: 7, color: COLOR.muted, align: 'center' });
  return assemblePdf(p, image);
}
