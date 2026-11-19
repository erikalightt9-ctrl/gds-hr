// Formal loan application (one A4 page) in the GDS payslip style, like the leave application: logo, title, employee
// details, the loan requested, HR's decision with the repayment terms, the employee's salary deduction authority and
// signature lines (employee, verified by, approved by).
import { Page, COLOR, W, H, LEFT, RIGHT, WIDTH, amount, longDate, logo, textWidth, assemblePdf } from './payslip-pdf.mjs';

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
const peso = n => `PHP ${amount(Number(n) || 0)}`;

export function renderLoanApplicationPdf(app, { employee, loan = null, designation = '', decidedBy = '', verified = {}, approved = {}, company = 'GDS CAPITAL INC.' } = {}) {
  const p = new Page(), image = logo();
  let y = H - 40;
  p.stroke(LEFT, 40, WIDTH, H - 80, COLOR.gold);
  if (image) { const h = 60, w = Math.min(300, h * image.width / image.height); p.image((W - w) / 2, y - h - 8, w, h); y -= h + 20; }
  else { p.text('GDS CAPITAL', W / 2, y - 40, { size: 22, bold: true, color: COLOR.red, align: 'center' }); y -= 60; }
  p.text('LOAN APPLICATION', W / 2, y - 14, { size: 18, bold: true, align: 'center' }); y -= 24;
  p.line(W / 2 - 80, y, W / 2 + 80, y, COLOR.gold, 1.2); y -= 18;
  p.text('Status:', RIGHT - 190, y, { bold: true }); p.text(STATUS[app.status] || app.status, RIGHT - 12, y, { align: 'right', bold: true, color: app.status === 'approved' ? COLOR.ink : COLOR.redText }); y -= 18;

  const header = (title, yTop) => { p.fill(COLOR.red, LEFT, yTop - 20, WIDTH, 20); p.text(title, LEFT + 10, yTop - 14, { size: 10, bold: true, color: COLOR.white }); return yTop - 20; };
  const KEY = LEFT + 190;
  const rows = list => { for (const [label, value] of list) {
    const lines = wrap(value, RIGHT - KEY - 20, 9.5), h = Math.max(17, 7 + lines.length * 12);
    p.line(LEFT, y - h, RIGHT, y - h); p.line(KEY, y, KEY, y - h);
    p.text(label, LEFT + 10, y - 12.5, { bold: true }); lines.forEach((l, i) => p.text(l, KEY + 10, y - 12.5 - i * 12)); y -= h;
  } y -= 8; };

  y = header('EMPLOYEE INFORMATION', y);
  rows([['Employee name', String(employee?.name || app.employeeId).toUpperCase()], ['Employee ID', app.employeeId], ['Designation', designation || '-'], ['Company / department', employee?.department || '-'], ['Date hired', employee?.startDate ? longDate(employee.startDate) : '-']]);
  y = header('LOAN REQUESTED', y);
  rows([['Type of loan', app.type], ['Amount requested', peso(app.amount)], ['Repayment period', `${app.months} month${app.months === 1 ? '' : 's'}`], ['Purpose', app.purpose || '-'], ['Date applied', app.appliedAt ? longDate(app.appliedAt) : '-']]);
  y = header('HR DECISION', y);
  const decided = [['Decision', STATUS[app.status] || app.status], ['Decided by', decidedBy || '-'], ['Date decided', app.decidedAt ? longDate(app.decidedAt) : '-']];
  if (app.status === 'approved') {
    const interest = Number(app.interest) || 0;
    decided.push(['Approved amount', peso(app.approvedAmount)], ['Interest / fees', peso(interest)], ['Total to repay', peso((Number(app.approvedAmount) || 0) + interest)],
      ['Monthly amortization', peso(loan?.monthlyAmortization)], ['Per payroll deduction', `${peso(loan?.perPayroll)}${loan?.terms ? ` x ${loan.terms} payroll cutoffs` : ''}`],
      ...(loan?.payoff ? [['Paid off (renewal)', `${peso(loan.payoff)} - ${(loan.renewalOf || []).map(r => `${r.reference} ${peso(r.amount)}`).join(', ')}`], ['Net amount released', peso(app.netRelease ?? ((Number(app.approvedAmount) || 0) - loan.payoff))]] : []),
      ['First deduction from', app.startDate ? longDate(app.startDate) : '-'], ['Planned last deduction', loan?.endDate ? longDate(loan.endDate) : '-'], ['Loan reference', loan?.reference || '-']);
  }
  if (app.remarks) decided.push(['HR remarks', app.remarks]);
  rows(decided);

  // Salary deduction authority, then signatures: the employee, Verified by (HR) and Approved by.
  if (app.status === 'approved') {
    const text = `I authorize ${company} to deduct ${peso(loan?.perPayroll)} from my salary every payroll cutoff until the loan is fully paid, and to deduct any remaining balance from my final pay if I leave the company.`;
    const lines = wrap(text, WIDTH - 24, 8.5);
    lines.forEach((l, i) => p.text(l, LEFT + 12, y - 2 - i * 11, { size: 8.5, italic: true }));
    y -= lines.length * 11 + 8;
  }
  // Signature blocks sit under the last line written (their headings are 46 pt above the signature line).
  const sign = Math.max(70, Math.min(150, y - 58));
  const colW = (WIDTH - 40) / 3;
  const block = (i, heading, name, title) => {
    const x = LEFT + 20 + i * colW, mid = x + colW / 2 - 6;
    p.text(heading, x, sign + 46, { size: 8.5, bold: true, color: COLOR.muted });
    p.line(x, sign + 20, x + colW - 12, sign + 20, COLOR.ink);
    if (name) p.text(name, mid, sign + 24, { size: 9.5, bold: true, align: 'center' });
    p.text(title || 'Signature over printed name', mid, sign + 9, { size: 7.5, color: COLOR.muted, align: 'center' });
    p.text('Date: ____________', x, sign - 6, { size: 7.5, color: COLOR.muted });
  };
  const [last, first] = String(employee?.name || '').split(',').map(x => x.trim());
  block(0, 'Filed by:', first ? `${first} ${last}` : String(employee?.name || ''), 'Employee');
  block(1, 'Verified by:', verified.name || '', verified.title || 'HR');
  block(2, 'Approved by:', approved.name || decidedBy, approved.title || '');
  p.text(`Loan application ${String(app.id || '').slice(0, 8)} | ${company} Human Resources`, W / 2, 50, { size: 7, color: COLOR.muted, align: 'center' });
  return assemblePdf(p, image);
}
