// One-page payslip in the GDS template layout: company name, title and period; employee information; particulars with
// days / hours; gross; deductions; a highlighted net pay; then received-by and prepared-by lines.
// Dependency-free PDF (Helvetica, A4 portrait). The company name heads the page; no logo artwork.
const W = 595, H = 842, LEFT = 40, RIGHT = 555, WIDTH = RIGHT - LEFT;
const COLOR = { ink: '0.13 0.13 0.13', muted: '0.42 0.42 0.42', line: '0.78 0.74 0.68', red: '0.71 0.12 0.17', redText: '0.80 0.18 0.20', gold: '0.85 0.72 0.36', goldTint: '0.99 0.95 0.84', band: '0.97 0.96 0.94', net: '1 0.90 0.45', white: '1 1 1' };

// Helvetica advance widths (per 1000 em) for alignment; unlisted characters use an average.
const WIDTHS = { ' ': 278, ',': 278, '.': 278, '-': 333, ':': 278, '(': 333, ')': 333, '/': 278, '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556, P: 667, H: 722 };
const textWidth = (s, size, bold = false) => [...s].reduce((w, c) => w + (WIDTHS[c] ?? (c === c.toUpperCase() && /[A-Z]/.test(c) ? 690 : 520)), 0) * size / 1000 * (bold ? 1.06 : 1);
const SUBSTITUTE = { '₱': 'PHP ', '–': '-', '—': '-', '−': '-', '×': 'x', '→': '->', '’': "'", '‘': "'", '“': '"', '”': '"', 'ñ': 'n', 'Ñ': 'N' };
const clean = value => [...String(value ?? '')].map(c => SUBSTITUTE[c] ?? c).join('').replace(/[^\x20-\x7e]/g, '?');
const pdfString = s => clean(s).replace(/[\\()]/g, '\\$&');
const amount = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = iso => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const period = (start, end) => start.slice(0, 7) === end.slice(0, 7) ? `${MONTHS[Number(start.slice(5, 7)) - 1]} ${Number(start.slice(8))}-${Number(end.slice(8))}, ${start.slice(0, 4)}` : `${longDate(start)} - ${longDate(end)}`;

class Page {
  constructor() { this.ops = []; }
  fill(color, x, y, w, h) { this.ops.push(`${color} rg ${x} ${y} ${w} ${h} re f`); }
  stroke(x, y, w, h, color = COLOR.line) { this.ops.push(`${color} RG 0.6 w ${x} ${y} ${w} ${h} re S`); }
  line(x1, y1, x2, y2, color = COLOR.line, width = 0.6) { this.ops.push(`${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`); }
  text(s, x, y, { size = 9.5, bold = false, color = COLOR.ink, align = 'left', italic = false } = {}) {
    const str = clean(s), w = textWidth(str, size, bold), at = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT ${color} rg /${italic ? 'F3' : bold ? 'F2' : 'F1'} ${size} Tf ${at.toFixed(2)} ${y.toFixed(2)} Td (${pdfString(str)}) Tj ET`);
  }
}

// Hours for each pay component, from the per-day work breakdown.
function hoursByComponent(rows = []) {
  const out = {};
  for (const r of rows) {
    const c = r.classification, ot = r.overtime;
    const key = c.startsWith('special') ? (ot ? 'specialOT' : 'specialHoliday') : c.startsWith('regular') || c.startsWith('double') ? (ot ? 'regularHolidayOT' : 'regularHoliday') : c.startsWith('other') ? (ot ? 'otherOT' : 'otherHoliday') : c === 'rest' ? (ot ? 'restOT' : 'restDay') : ot ? 'regularOT' : 'basic';
    out[key] = (out[key] || 0) + r.hours;
    if (r.night) out.nsd = (out.nsd || 0) + r.hours;
  }
  return out;
}
const hrs = h => (h ? `${Math.round(h * 100) / 100}` : '');

export function renderPayslipPdf(slip, { draft = slip.draft, designation = '' } = {}) {
  const p = new Page(), e = slip.earnings || {}, d = slip.deductions || {}, hours = hoursByComponent(slip.workBreakdown);
  let y = H - 40;
  // Header: company name, title, period and release date.
  p.stroke(LEFT, 40, WIDTH, H - 80, COLOR.gold);
  // Company name as the heading (no logo artwork on the payslip).
  p.text('GDS CAPITAL INC.', W / 2, y - 30, { size: 20, bold: true, color: COLOR.red, align: 'center' }); y -= 44;
  p.text('PAYSLIP', W / 2, y - 14, { size: 20, bold: true, align: 'center' }); y -= 24;
  p.line(W / 2 - 60, y, W / 2 + 60, y, COLOR.gold, 1.2); y -= 18;
  p.text('Period covered:', RIGHT - 190, y, { size: 9.5, bold: true }); p.text(period(slip.start, slip.end), RIGHT - 12, y, { align: 'right' }); y -= 15;
  p.text('Release date:', RIGHT - 190, y, { size: 9.5, bold: true }); p.text(draft ? 'Not yet released' : slip.postedAt ? longDate(slip.postedAt) : '-', RIGHT - 12, y, { align: 'right' }); y -= 12;
  if (draft) { y -= 6; p.fill(COLOR.red, LEFT, y - 18, WIDTH, 18); p.text('DRAFT - FOR REVIEW ONLY, NOT YET POSTED', W / 2, y - 12.5, { size: 10, bold: true, color: COLOR.white, align: 'center' }); y -= 18; }
  y -= 10;

  // Employee information.
  const header = (title, yTop) => { p.fill(COLOR.red, LEFT, yTop - 20, WIDTH, 20); p.text(title, LEFT + 10, yTop - 14, { size: 10, bold: true, color: COLOR.white }); return yTop - 20; };
  y = header('EMPLOYEE INFORMATION', y);
  const daily = slip.payBasis === 'daily';
  const info = [['Employee name', slip.employeeName.toUpperCase()], ['Employee ID', slip.employeeId], ['Designation', designation || '-'],
    [daily ? 'Daily rate' : 'Monthly salary', amount(daily ? slip.dailyRate : slip.monthlySalary)], ['Working days (scheduled)', String(slip.workingDays ?? '-')], ['Days credited', String(slip.creditedDays ?? slip.daysPresent ?? '-')]];
  const KEY = LEFT + 190;
  for (const [label, value] of info) {
    p.line(LEFT, y - 18, RIGHT, y - 18); p.line(KEY, y, KEY, y - 18);
    p.text(label, LEFT + 10, y - 12.5, { bold: true }); p.text(value, KEY + 10, y - 12.5); y -= 18;
  }
  y -= 12;

  // Particulars.
  const C1 = LEFT + 230, C2 = LEFT + 320, C3 = LEFT + 400;
  p.fill(COLOR.goldTint, LEFT, y - 20, WIDTH, 20); p.stroke(LEFT, y - 20, WIDTH, 20);
  p.text('PARTICULARS', LEFT + 10, y - 14, { size: 9, bold: true }); p.text('DAYS / HOURS', (C1 + C3) / 2, y - 14, { size: 9, bold: true, align: 'center' }); p.text('AMOUNT', RIGHT - 12, y - 14, { size: 9, bold: true, align: 'right' }); y -= 20;
  const rows = [
    ['Days worked (regular)', slip.creditedDays ?? slip.daysPresent, 'DAY', e.basic],
    ['Overtime', hrs(hours.regularOT), 'HRS', e.regularOT],
    ['Rest day / RDOT', hrs((hours.restDay || 0) + (hours.restOT || 0)), 'HRS', (e.restDay || 0) + (e.restOT || 0)],
    ['Night differential', hrs(hours.nsd), 'HRS', e.nsd],
    ['Special holiday', hrs((hours.specialHoliday || 0) + (hours.specialOT || 0)), 'HRS', (e.specialHoliday || 0) + (e.specialOT || 0)],
    ['Regular holiday', hrs((hours.regularHoliday || 0) + (hours.regularHolidayOT || 0)), 'HRS', (e.regularHoliday || 0) + (e.regularHolidayOT || 0)],
    ...[['Other holiday', (e.otherHoliday || 0) + (e.otherOT || 0)], ['Allowance', e.allowance], ['Adjustment', e.additional], ['13th month pay', e.thirteenth]].filter(([, v]) => v).map(([l, v]) => [l, '', '', v]),
  ];
  for (const [label, qty, unit, value] of rows) {
    p.line(LEFT, y - 17, RIGHT, y - 17); [C1, C2, C3].forEach(x => p.line(x, y, x, y - 17));
    p.text(label, LEFT + 10, y - 12); if (qty !== '' && qty !== undefined && value) { p.text(String(qty), (C1 + C2) / 2, y - 12, { align: 'center' }); p.text(unit, (C2 + C3) / 2, y - 12, { align: 'center', color: COLOR.muted, size: 8.5 }); }
    if (value) p.text(amount(value), RIGHT - 12, y - 12, { align: 'right' }); y -= 17;
  }
  p.fill(COLOR.band, C1, y - 21, RIGHT - C1, 21); p.stroke(LEFT, y - 21, WIDTH, 21); p.line(C3, y, C3, y - 21);
  p.text('GROSS SALARY', C3 - 10, y - 14, { bold: true, align: 'right' }); p.text(amount(slip.gross), RIGHT - 12, y - 14, { bold: true, align: 'right' }); y -= 33;

  // Deductions.
  p.text('DEDUCTIONS', W / 2, y - 4, { size: 10, bold: true, color: COLOR.redText, align: 'center' }); y -= 12;
  const loans = Object.fromEntries((slip.loans || []).map(l => [l.type, l.amount]));
  const other = (slip.deductionItems || []).filter(i => !['SSS', 'PhilHealth', 'Pag-IBIG', 'tax', 'late', 'undertime', 'absence', 'Salary Loan', 'SSS Loan', 'Pag-IBIG Loan'].includes(i.label) && !(slip.loans || []).some(l => i.label.startsWith(l.type)) && i.amount);
  const deductionRows = [['SSS', d.SSS], ['PhilHealth', d.PhilHealth], ['Pag-IBIG', d['Pag-IBIG']], ['SSS loan', loans['SSS Loan']], ['Salary loan', loans['Salary Loan']],
    ...[['Withholding tax', d.tax], ['Pag-IBIG loan', loans['Pag-IBIG Loan']], ['Absences / unpaid leave', d.absence], ['Undertime', d.undertime]].filter(([, v]) => v),
    ...Object.entries(loans).filter(([t]) => !['SSS Loan', 'Pag-IBIG Loan', 'Salary Loan'].includes(t)).map(([t, v]) => [t, v]),
    ...other.map(i => [i.label, i.amount])];
  p.line(LEFT, y, RIGHT, y);
  for (const [label, value] of deductionRows) {
    p.line(LEFT, y - 17, RIGHT, y - 17); p.line(C3, y, C3, y - 17);
    p.text(label.length > 60 ? `${label.slice(0, 57)}...` : label, LEFT + 10, y - 12); if (value) p.text(amount(value), RIGHT - 12, y - 12, { align: 'right', color: COLOR.redText }); y -= 17;
  }
  p.fill(COLOR.band, C1, y - 20, RIGHT - C1, 20); p.line(LEFT, y - 20, RIGHT, y - 20); p.line(C3, y, C3, y - 20);
  p.text('TOTAL DEDUCTIONS', C3 - 10, y - 13.5, { bold: true, align: 'right' }); p.text(amount(slip.totalDeductions), RIGHT - 12, y - 13.5, { bold: true, align: 'right', color: COLOR.redText }); y -= 20;
  p.fill(COLOR.net, LEFT, y - 26, WIDTH, 26); p.stroke(LEFT, y - 26, WIDTH, 26, COLOR.gold); p.line(C3, y, C3, y - 26, COLOR.gold);
  p.text('NET PAY', C3 - 10, y - 17, { size: 11, bold: true, align: 'right' }); p.text(`PHP ${amount(slip.net)}`, RIGHT - 12, y - 17, { size: 11.5, bold: true, align: 'right' }); y -= 40;
  // Notes: employer share and any approved contribution basis, in small type.
  const notes = [`Company-paid government contributions this cutoff (not deducted from your pay): PHP ${amount(slip.employerTotal)}.`];
  const basis = slip.contributionBasis;
  if (basis && Object.values(basis).some(v => v !== slip.monthlySalary)) notes.push(`Contribution basis: SSS PHP ${amount(basis.SSS)} | PhilHealth PHP ${amount(basis.PhilHealth)} | Pag-IBIG PHP ${amount(basis['Pag-IBIG'])} (approved adjustment; salary unchanged).`);
  for (const n of notes) { p.text(n, LEFT + 4, y, { size: 7.5, color: COLOR.muted }); y -= 11; }

  // Sign-off.
  const sign = Math.min(118, y - 26);
  p.text('Received by:', LEFT + 12, sign + 22, { italic: true, size: 9.5 }); p.line(LEFT + 80, sign + 20, LEFT + 260, sign + 20, COLOR.ink);
  p.text('Signature over printed name / date', LEFT + 170, sign + 9, { size: 7.5, color: COLOR.muted, align: 'center' });
  p.text('Prepared by: Payroll Department', LEFT + 12, sign - 20, { size: 9.5 });
  p.text(`${slip.employeeId} | ${draft ? 'Draft for review' : `Payroll ${String(slip.id || '').slice(0, 8)}`} | Questions? Message HR through the GDS HR app.`, W / 2, 50, { size: 7, color: COLOR.muted, align: 'center' });

  // Assemble the PDF.
  const stream = p.ops.join('\n'), objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>`);
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets = [];
  let size = parts[0].length;
  const push = buf => { parts.push(buf); size += buf.length; };
  objects.forEach((o, i) => { offsets.push(size); push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')); });
  const xref = size, count = offsets.length + 1;
  push(Buffer.from(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
