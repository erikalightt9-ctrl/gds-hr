// 13th month pay payslip (one A4 page) in the GDS payslip layout: logo, title and year covered; employee
// information; the computation (basic salary earned, 13th month pay, approved adjustments); previous payments;
// a highlighted amount payable; received-by and prepared-by lines. Drafts and cancelled payslips carry a red band.
import { Page, COLOR, W, H, LEFT, RIGHT, WIDTH, amount, longDate, logo, textWidth, assemblePdf } from './payslip-pdf.mjs';

function wrap(text, width, size) {
  const lines = []; let line = '';
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
const covered = s => (s.coveredStart.slice(5) === '01-01' && s.coveredEnd.slice(5) === '12-31' ? `January 1 - December 31, ${s.year}` : `${longDate(s.coveredStart)} - ${longDate(s.coveredEnd)}`);

export function renderThirteenthPdf(slip, { preparedBy = '' } = {}) {
  const p = new Page(), image = logo(), draft = slip.status !== 'final' && slip.status !== 'void', voided = slip.status === 'void';
  const payable = draft ? slip.remaining : slip.amountPaid;
  let y = H - 40;
  p.stroke(LEFT, 40, WIDTH, H - 80, COLOR.gold);
  if (image) { const h = 64, w = Math.min(300, h * image.width / image.height); p.image((W - w) / 2, y - h - 8, w, h); y -= h + 22; }
  else { p.text('GDS CAPITAL', W / 2, y - 40, { size: 22, bold: true, color: COLOR.red, align: 'center' }); y -= 60; }
  p.text('13TH MONTH PAY PAYSLIP', W / 2, y - 14, { size: 18, bold: true, align: 'center' }); y -= 24;
  p.line(W / 2 - 100, y, W / 2 + 100, y, COLOR.gold, 1.2); y -= 18;
  p.text('Year covered:', RIGHT - 220, y, { bold: true }); p.text(covered(slip), RIGHT - 12, y, { align: 'right' }); y -= 15;
  p.text('Release date:', RIGHT - 220, y, { bold: true }); p.text(draft ? 'Not yet released' : longDate(slip.finalizedAt), RIGHT - 12, y, { align: 'right' }); y -= 12;
  const band = text => { y -= 6; p.fill(COLOR.red, LEFT, y - 18, WIDTH, 18); p.text(text, W / 2, y - 12.5, { size: 10, bold: true, color: COLOR.white, align: 'center' }); y -= 18; };
  if (draft) band('DRAFT - FOR REVIEW ONLY, NOT YET FINALIZED');
  if (voided) band(`CANCELLED ${longDate(slip.voidedAt)} - NOT VALID FOR PAYMENT`);
  y -= 10;

  const header = title => { p.fill(COLOR.red, LEFT, y - 20, WIDTH, 20); p.text(title, LEFT + 10, y - 14, { size: 10, bold: true, color: COLOR.white }); y -= 20; };
  header('EMPLOYEE INFORMATION');
  const KEY = LEFT + 190;
  for (const [label, value] of [['Employee name', String(slip.employeeName || '').toUpperCase()], ['Employee ID', slip.employeeId], ['Designation', slip.designation || '-'], ['Date hired', slip.dateHired ? longDate(slip.dateHired) : '-'], ['Year covered', covered(slip)]]) {
    p.line(LEFT, y - 18, RIGHT, y - 18); p.line(KEY, y, KEY, y - 18);
    p.text(label, LEFT + 10, y - 12.5, { bold: true }); p.text(value, KEY + 10, y - 12.5); y -= 18;
  }
  y -= 12;

  // Particulars with their basis (wrapped, small) and amount.
  const C1 = LEFT + 190, C3 = RIGHT - 95;
  const head = title => {
    p.fill(COLOR.goldTint, LEFT, y - 20, WIDTH, 20); p.stroke(LEFT, y - 20, WIDTH, 20);
    p.text(title, LEFT + 10, y - 14, { size: 9, bold: true }); p.text('BASIS', C1 + 10, y - 14, { size: 9, bold: true }); p.text('AMOUNT', RIGHT - 12, y - 14, { size: 9, bold: true, align: 'right' }); y -= 20;
  };
  const item = (label, basis, value, { color = COLOR.ink, bold = false } = {}) => {
    const l = wrap(label, C1 - LEFT - 18, 9.5), b = wrap(basis, C3 - C1 - 18, 7.8), h = Math.max(17, 8 + Math.max(l.length * 11, b.length * 9.5));
    p.line(LEFT, y - h, RIGHT, y - h); p.line(C1, y, C1, y - h); p.line(C3, y, C3, y - h);
    l.forEach((t, k) => p.text(t, LEFT + 10, y - 12 - k * 11, { bold }));
    b.forEach((t, k) => p.text(t, C1 + 8, y - 11 - k * 9.5, { size: 7.8, color: COLOR.muted }));
    if (value !== null) p.text(amount(value), RIGHT - 12, y - 12, { align: 'right', color, bold });
    y -= h;
  };
  const total = (label, value, color = COLOR.ink) => {
    p.fill(COLOR.band, C3 - 190, y - 20, RIGHT - C3 + 190, 20); p.line(LEFT, y - 20, RIGHT, y - 20); p.line(C3, y, C3, y - 20);
    p.text(label, C3 - 10, y - 13.5, { bold: true, align: 'right' }); p.text(amount(value), RIGHT - 12, y - 13.5, { bold: true, align: 'right', color }); y -= 30;
  };
  head('COMPUTATION');
  item('Total basic salary earned', slip.basicBasis, slip.totalBasic);
  item('13th month pay (computed)', slip.thirteenthBasis, slip.thirteenth);
  if (!slip.adjustments.length) item('Approved adjustments', 'None', 0);
  for (const a of slip.adjustments) item(`Adjustment (${a.amount < 0 ? 'deduction' : 'addition'})`, a.reason, a.amount, { color: a.amount < 0 ? COLOR.redText : COLOR.ink });
  total('TOTAL 13TH MONTH PAY DUE', slip.totalDue);

  p.text('LESS: PREVIOUS PAYMENTS', W / 2, y - 6, { size: 10, bold: true, color: COLOR.redText, align: 'center' }); y -= 14;
  head('PAYMENT');
  if (!slip.payments.length) item('No previous payment', '', 0);
  for (const pay of slip.payments.slice(0, 12)) item(pay.label, pay.source === 'payroll' || pay.source === 'payslip' ? (pay.date ? `Released ${longDate(pay.date)}` : '') : 'Encoded by HR', pay.amount, { color: COLOR.redText });
  if (slip.payments.length > 12) item(`${slip.payments.length - 12} more payment(s)`, '', r2(slip.payments.slice(12).reduce((s, x) => s + x.amount, 0)), { color: COLOR.redText });
  total('TOTAL PREVIOUS PAYMENTS', slip.previousTotal, COLOR.redText);
  y += 10;
  p.fill(COLOR.net, LEFT, y - 28, WIDTH, 28); p.stroke(LEFT, y - 28, WIDTH, 28, COLOR.gold); p.line(C3, y, C3, y - 28, COLOR.gold);
  p.text(draft ? 'REMAINING AMOUNT PAYABLE' : 'AMOUNT PAID ON THIS PAYSLIP', C3 - 10, y - 18, { size: 11, bold: true, align: 'right' }); p.text(`PHP ${amount(payable)}`, RIGHT - 12, y - 18, { size: 11.5, bold: true, align: 'right' }); y -= 40;
  if (voided && slip.voidReason) { for (const l of wrap(`Cancelled: ${slip.voidReason}`, WIDTH - 8, 8).slice(0, 2)) { p.text(l, LEFT + 4, y, { size: 8, color: COLOR.redText }); y -= 10; } }

  // Sign-off, as on the regular payslip.
  const sign = Math.min(118, y - 26);
  p.text('Received by:', LEFT + 12, sign + 22, { italic: true, size: 9.5 }); p.line(LEFT + 80, sign + 20, LEFT + 260, sign + 20, COLOR.ink);
  p.text('Signature over printed name / date', LEFT + 170, sign + 9, { size: 7.5, color: COLOR.muted, align: 'center' });
  p.text(`Prepared by: ${preparedBy || 'Payroll Department'}`, LEFT + 12, sign - 20, { size: 9.5 });
  p.text(`${slip.employeeId} | ${draft ? 'Draft for review' : `13th month payslip ${String(slip.id || '').slice(0, 8)}`} | PD 851: 13th month pay = basic salary earned in the year / 12.`, W / 2, 50, { size: 7, color: COLOR.muted, align: 'center' });
  return assemblePdf(p, image);
}
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
