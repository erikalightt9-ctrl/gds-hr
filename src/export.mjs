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
  const headers = ['Employee ID', 'Employee Name', 'Monthly Salary', 'Working Days', 'Days Present', 'Leave Days / Notes', 'Regular OT', 'Rest Day Pay', 'Rest Day OT', 'NSD', 'Special Holiday Pay', 'Special Holiday OT', 'Regular Holiday Pay', 'Regular Holiday OT', 'Other Holiday Pay', 'Other Holiday OT', 'Basic Salary', 'Additional', 'Allowances', '13th Month Paid', 'Gross Salary', 'Late', 'Undertime', 'Unpaid Leave / Absence', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding Tax', 'Loan Deductions', 'Other Deductions', 'Total Deductions', 'Net Salary', 'Loan Balance', 'Loan Date', 'Loan Terms', 'Applicable Basic for 13th Month'];
  const payroll = [headers, ...run.rows.map(r => [r.employeeId, r.employeeName, r.monthlySalary, r.workingDays, r.daysPresent, r.leaveNotes.join('; '), r.earnings.regularOT, r.earnings.restDay, r.earnings.restOT, r.earnings.nsd, r.earnings.specialHoliday, r.earnings.specialOT, r.earnings.regularHoliday, r.earnings.regularHolidayOT, r.earnings.otherHoliday, r.earnings.otherOT, r.earnings.basic, r.earnings.additional, r.earnings.allowance, r.earnings.thirteenth, r.gross, r.deductions.late, r.deductions.undertime, r.deductions.absence, r.deductions.SSS, r.deductions.PhilHealth, r.deductions['Pag-IBIG'], r.deductions.tax, r.deductions.loans, r.deductions.other, r.totalDeductions, r.net, r.loanBalance, r.loanDeductions.map(l => l.startDate).join('; '), r.loanDeductions.map(l => `${l.reference}: ${l.remainingTerms}/${l.terms}`).join('; '), r.applicableBasic])];
  const audit = [['Employee ID', 'Employee Name', 'Component', 'Side', 'Amount', 'Formula / Basis', 'Date', 'Source Type', 'Source ID'], ...run.rows.flatMap(r => r.trace.map(t => [r.employeeId, r.employeeName, t.component, t.side, t.amount, t.formula, t.date, t.sourceKind, t.sourceId]))];
  const late = [['Employee ID', 'Employee Name', 'Date', 'Scheduled', 'Actual', 'Late Minutes', 'Approved Offset', 'Approved Exception', 'Explanation', 'Deductible Minutes', 'Deduction'], ...run.rows.flatMap(r => r.late.map(l => [r.employeeId, r.employeeName, l.date, l.scheduledTime, l.actualTime, l.lateMinutes, l.approvedOffset, String(l.validExplanation), l.explanation, l.deductibleMinutes, l.deduction]))];
  const meta = [['Payroll ID', run.id || 'Preview'], ['Start', run.start], ['End', run.end], ['Status', run.status || 'Preview'], ['Rules Version', run.ruleId], ['Posted By', run.postedBy || ''], ['Posted At', run.postedAt || ''], ['Fingerprint', run.fingerprint]];
  const sheets = { Payroll: payroll, 'Calculation audit': audit, Lateness: late, Metadata: meta };
  const entries = Object.entries(sheets);
  const files = {
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${entries.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${entries.map(([name], i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  entries.forEach(([, rows], i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheet(rows); });
  return zip(files);
}
