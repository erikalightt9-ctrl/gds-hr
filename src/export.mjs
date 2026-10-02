// Small dependency-free OOXML writer. Every string is an inline string, never a formula.
const xml = value => String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function crc32(data) { let crc = -1; for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(content), crc = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(n.length, 26);
    local.push(header, n, data);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(n.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, n); offset += header.length + n.length + data.length;
  }
  const centralBuffer = Buffer.concat(central), footer = Buffer.alloc(22), count = Object.keys(files).length;
  footer.writeUInt32LE(0x06054b50); footer.writeUInt16LE(count, 8); footer.writeUInt16LE(count, 10); footer.writeUInt32LE(centralBuffer.length, 12); footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, footer]);
}
function sheet(rows) {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map(v => typeof v === 'number' ? `<c><v>${v}</v></c>` : `<c t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
export function payrollWorkbook(run) {
  const headers = ['Employee ID', 'Employee Name', 'Monthly Salary', 'Working Days', 'Days Present', 'Days Credited', 'Late Minutes Not Offset', 'Leave Days / Notes', 'Regular OT', 'Rest Day Pay', 'Rest Day OT', 'NSD', 'Special Holiday Pay', 'Special Holiday OT', 'Regular Holiday Pay', 'Regular Holiday OT', 'Other Holiday Pay', 'Other Holiday OT', 'Basic Salary', 'Additional', 'Allowances', '13th Month Paid', 'Gross Salary', 'Undertime', 'Unpaid Leave / Absence', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding Tax', 'Loan Deductions', 'Other Deductions', 'Total Deductions', 'Net Salary', 'Employer SSS', 'Employer SSS EC', 'Employer PhilHealth', 'Employer Pag-IBIG', 'Employer Total (not deducted)', 'Loan Balance', 'Loan Date', 'Loan Terms', 'Applicable Basic for 13th Month'];
  const payroll = [headers, ...run.rows.map(r => [r.employeeId, r.employeeName, r.monthlySalary, r.workingDays, r.daysPresent, r.creditedDays ?? r.daysPresent, r.lateMinutesUnoffset ?? 0, r.leaveNotes.join('; '), r.earnings.regularOT, r.earnings.restDay, r.earnings.restOT, r.earnings.nsd, r.earnings.specialHoliday, r.earnings.specialOT, r.earnings.regularHoliday, r.earnings.regularHolidayOT, r.earnings.otherHoliday, r.earnings.otherOT, r.earnings.basic, r.earnings.additional, r.earnings.allowance, r.earnings.thirteenth, r.gross, r.deductions.undertime, r.deductions.absence, r.deductions.SSS, r.deductions.PhilHealth, r.deductions['Pag-IBIG'], r.deductions.tax, r.deductions.loans, r.deductions.other, r.totalDeductions, r.net, r.employer?.SSS ?? 0, r.employer?.['SSS EC'] ?? 0, r.employer?.PhilHealth ?? 0, r.employer?.['Pag-IBIG'] ?? 0, r.employerTotal ?? 0, r.loanBalance, r.loanDeductions.map(l => l.startDate).join('; '), r.loanDeductions.map(l => `${l.reference}: ${l.remainingTerms}/${l.terms}`).join('; '), r.applicableBasic])];
  const audit = [['Employee ID', 'Employee Name', 'Component', 'Side', 'Amount', 'Formula / Basis', 'Date', 'Source Type', 'Source ID'], ...run.rows.flatMap(r => r.trace.map(t => [r.employeeId, r.employeeName, t.component, t.side, t.amount, t.formula, t.date, t.sourceKind, t.sourceId]))];
  const late = [['Employee ID', 'Employee Name', 'Date', 'Scheduled', 'Actual', 'Late Minutes', 'Approved Offset', 'Approved Exception', 'Explanation', 'Minutes Not Offset', 'Days Lost', 'Basic Reduced By'], ...run.rows.flatMap(r => r.late.map(l => [r.employeeId, r.employeeName, l.date, l.scheduledTime, l.actualTime, l.lateMinutes, l.approvedOffset, String(l.validExplanation), l.explanation, l.deductibleMinutes, l.dayFraction ?? '', l.deduction]))];
  const meta = [['Payroll ID', run.id || 'Preview'], ['Start', run.start], ['End', run.end], ['Status', run.status || 'Preview'], ['Rules Version', run.ruleId], ['Employer contributions (not deducted)', run.totals?.employer ?? 0], ['Posted By', run.postedBy || ''], ['Posted At', run.postedAt || ''], ['Fingerprint', run.fingerprint]];
  return workbook({ Payroll: payroll, 'Calculation audit': audit, Lateness: late, Metadata: meta });
}
// Any number of sheets: { 'Sheet name': [[header...], [row...], ...] }. Sheet names are trimmed to Excel's 31-character limit.
export function workbook(sheets) {
  const entries = Object.entries(sheets).map(([name, rows]) => [name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), rows]);
  const files = {
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${entries.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${entries.map(([name], i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  entries.forEach(([, rows], i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheet(rows); });
  return zip(files);
}

// ---------- PDF tables (dependency-free, Helvetica, landscape A4) ----------
const PAGE = { width: 842, height: 595, margin: 30 };
const SUBSTITUTES = { '₱': 'PHP ', '→': '->', '←': '<-', '×': 'x', '÷': '/', '−': '-', '✓': 'OK', '•': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '—': '-' };
// WinAnsi text: Latin-1 letters such as ñ and é print correctly; anything else becomes a plain substitute or '?'.
function pdfText(value) {
  let out = '';
  for (const ch of String(value ?? '').replace(/[\r\n\t]+/g, ' ')) {
    for (const c of SUBSTITUTES[ch] ?? ch) {
      const code = c.charCodeAt(0);
      if (c === '(' || c === ')' || c === '\\') out += `\\${c}`;
      else if (code >= 0x20 && code <= 0x7e) out += c;
      else if (code >= 0xa0 && code <= 0xff) out += `\\${code.toString(8).padStart(3, '0')}`;
      else out += '?';
    }
  }
  return out;
}
const fit = (value, chars) => { const s = String(value ?? ''); return s.length > chars ? `${s.slice(0, Math.max(1, chars - 3))}...` : s; };

export function tablePdf({ title, subtitle = '', headers, rows }) {
  const usable = PAGE.width - PAGE.margin * 2, size = headers.length > 10 ? 6.5 : 7.5, charWidth = size * 0.5;
  // Column widths follow content length (capped), then scale to the page width.
  const want = headers.map((h, i) => Math.min(40, Math.max(String(h).length, ...rows.slice(0, 400).map(r => String(r[i] ?? '').length), 4)));
  const total = want.reduce((a, b) => a + b, 0), widths = want.map(w => (w / total) * usable);
  const rowHeight = size + 5, top = PAGE.height - 92, bottom = 44, perPage = Math.max(1, Math.floor((top - bottom) / rowHeight) - 1);
  const pages = []; for (let i = 0; i < Math.max(rows.length, 1); i += perPage) pages.push(rows.slice(i, i + perPage));
  const generated = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  const cells = (values, y, bold) => {
    let x = PAGE.margin;
    return values.map((v, i) => {
      const s = `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${(x + 3).toFixed(1)} ${y.toFixed(1)} Td (${pdfText(fit(v, Math.floor((widths[i] - 6) / charWidth)))}) Tj ET`;
      x += widths[i]; return s;
    }).join(' ');
  };
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const pageIds = [];
  pages.forEach((page, index) => {
    const parts = [
      `0.66 0.12 0.18 rg 0 ${PAGE.height - 58} ${PAGE.width} 58 re f`,                 // GDS red band
      `0.85 0.72 0.36 rg 0 ${PAGE.height - 61} ${PAGE.width} 3 re f`,                   // gold rule
      `1 1 1 rg BT /F2 15 Tf ${PAGE.margin} ${PAGE.height - 30} Td (${pdfText(title)}) Tj ET`,
      `1 1 1 rg BT /F1 8.5 Tf ${PAGE.margin} ${PAGE.height - 46} Td (${pdfText(`GDS CAPITAL INC.${subtitle ? ` - ${subtitle}` : ''}`)}) Tj ET`,
      `0.97 0.92 0.78 rg ${PAGE.margin} ${top - 4} ${usable} ${rowHeight + 2} re f`,     // header row
      `0.42 0.30 0.06 rg ${cells(headers, top, true)}`,
    ];
    page.forEach((row, r) => {
      const y = top - (r + 1) * rowHeight;
      if (r % 2) parts.push(`0.99 0.97 0.91 rg ${PAGE.margin} ${y - 4} ${usable} ${rowHeight} re f`);
      parts.push(`0.13 0.11 0.08 rg ${cells(row, y, false)}`);
    });
    if (!rows.length) parts.push(`0.35 0.30 0.20 rg BT /F1 9 Tf ${PAGE.margin + 3} ${top - rowHeight - 4} Td (No records.) Tj ET`);
    parts.push(`0.35 0.30 0.20 rg BT /F1 7 Tf ${PAGE.margin} 22 Td (${pdfText(`Confidential - Generated ${generated} (Asia/Manila) - ${rows.length} record${rows.length === 1 ? '' : 's'}`)}) Tj ET`,
      `BT /F1 7 Tf ${PAGE.width - PAGE.margin - 60} 22 Td (${pdfText(`Page ${index + 1} of ${pages.length}`)}) Tj ET`);
    const stream = parts.join('\n'), pageId = objects.length + 1; pageIds.push(pageId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
