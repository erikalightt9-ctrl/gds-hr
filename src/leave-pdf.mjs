// Formal leave application (one A4 page) in the GDS payslip style: logo, title, employee details, the leave requested,
// HR's decision, and signature lines for the employee and the approver.
import { Page, COLOR, W, H, LEFT, RIGHT, WIDTH, longDate, logo, textWidth, assemblePdf } from './payslip-pdf.mjs';

function wrap(text, width, size) {
  const lines = []; let line = '';
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}
const STATUS = { pending: 'Pending HR approval', approved: 'Approved', rejected: 'Not approved', cancelled: 'Cancelled' };

export function renderLeavePdf(leave, { employee, typeName = '', designation = '', available = '', decidedBy = '' }) {
  const p = new Page(), image = logo();
  let y = H - 40;
  p.stroke(LEFT, 40, WIDTH, H - 80, COLOR.gold);
  if (image) { const h = 60, w = Math.min(300, h * image.width / image.height); p.image((W - w) / 2, y - h - 8, w, h); y -= h + 20; }
  else { p.text('GDS CAPITAL', W / 2, y - 40, { size: 22, bold: true, color: COLOR.red, align: 'center' }); y -= 60; }
  p.text('LEAVE APPLICATION', W / 2, y - 14, { size: 18, bold: true, align: 'center' }); y -= 24;
  p.line(W / 2 - 80, y, W / 2 + 80, y, COLOR.gold, 1.2); y -= 18;
  p.text('Status:', RIGHT - 190, y, { bold: true }); p.text(STATUS[leave.status] || leave.status, RIGHT - 12, y, { align: 'right', bold: true, color: leave.status === 'approved' ? COLOR.ink : COLOR.redText }); y -= 18;

  const header = (title, yTop) => { p.fill(COLOR.red, LEFT, yTop - 20, WIDTH, 20); p.text(title, LEFT + 10, yTop - 14, { size: 10, bold: true, color: COLOR.white }); return yTop - 20; };
  const KEY = LEFT + 190;
  const rows = list => { for (const [label, value] of list) {
    const lines = wrap(value, RIGHT - KEY - 20, 9.5), h = Math.max(18, 8 + lines.length * 12);
    p.line(LEFT, y - h, RIGHT, y - h); p.line(KEY, y, KEY, y - h);
    p.text(label, LEFT + 10, y - 12.5, { bold: true }); lines.forEach((l, i) => p.text(l, KEY + 10, y - 12.5 - i * 12)); y -= h;
  } y -= 14; };

  y = header('EMPLOYEE INFORMATION', y);
  rows([['Employee name', String(employee?.name || leave.employeeId).toUpperCase()], ['Employee ID', leave.employeeId], ['Designation', designation || '-'], ['Department', employee?.department || '-']]);
  y = header('LEAVE REQUESTED', y);
  const dates = leave.startDate === leave.endDate ? longDate(leave.startDate) : `${longDate(leave.startDate)} to ${longDate(leave.endDate)}`;
  rows([['Type of leave', typeName || leave.typeId], ['Date(s)', dates], ['Number of days', String(leave.days ?? (leave.countedDates || []).length)], ['Reason', leave.reason || '-'], ...(available !== '' ? [['Available credits', String(available)]] : []), ...(leave.documentReference ? [['Supporting document', leave.documentReference]] : [])]);
  y = header('HR DECISION', y);
  rows([['Decision', STATUS[leave.status] || leave.status], ['Decided by', decidedBy || '-'], ['Date decided', leave.decidedAt ? longDate(leave.decidedAt) : '-'], ['HR remarks', leave.hrRemarks || '-']]);

  const sign = Math.min(150, y - 40);
  const line = (x, label, name) => { p.line(x, sign + 20, x + 200, sign + 20, COLOR.ink); if (name) p.text(name, x + 100, sign + 24, { size: 9, align: 'center' }); p.text(label, x + 100, sign + 9, { size: 7.5, color: COLOR.muted, align: 'center' }); };
  line(LEFT + 20, 'Employee signature / date', employee?.name || '');
  line(RIGHT - 220, 'Approved by / date', decidedBy);
  p.text(`Leave ${String(leave.id || '').slice(0, 8)} | GDS CAPITAL INC. Human Resources`, W / 2, 50, { size: 7, color: COLOR.muted, align: 'center' });
  return assemblePdf(p, image);
}
