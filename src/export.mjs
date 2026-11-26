// Small dependency-free OOXML writer. Every string is an inline string, never a formula.
import { holidaySplit } from './holiday-pay.mjs';
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
// Cell values: number, string, or an object { v, f, bold, money, pct } (f = formula without '=', v = its cached value).
// Styles: 0 plain, 1 bold, 2 peso amount (#,##0.00), 3 bold peso amount, 4 percent.
export const colName = i => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
function cell(value, ref, rowBold) {
  const c = value !== null && typeof value === 'object' ? value : { v: value };
  const bold = c.bold || rowBold, style = c.pct ? 4 : c.money ? (bold ? 3 : 2) : bold ? 1 : 0, s = style ? ` s="${style}"` : '';
  if (c.f) return `<c r="${ref}"${s}><f>${xml(c.f)}</f>${typeof c.v === 'number' && Number.isFinite(c.v) ? `<v>${c.v}</v>` : ''}</c>`;
  if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
  if (c.v === '' || c.v === null || c.v === undefined) return style ? `<c r="${ref}"${s}/>` : '';
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
}
// A sheet is either rows (first row frozen) or { rows, header (0-based index of the column headings: bold, frozen,
// filter buttons), widths: [characters], boldRows: [indexes], totalRows (rows at the end left out of the filter) }.
function sheet(spec) {
  const o = Array.isArray(spec) ? { rows: spec } : spec, rows = o.rows, header = o.header ?? null, bold = new Set([...(o.boldRows || []), ...(header === null ? [] : [header])]);
  const freeze = header === null ? 1 : header + 1, width = Math.max(1, ...rows.map(r => r.length)), lastData = rows.length - 1 - (o.totalRows || 0);
  const cols = o.widths?.length ? `<cols>${o.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const filter = header !== null && o.filter !== false && lastData > header ? `<autoFilter ref="A${header + 1}:${colName(width - 1)}${lastData + 1}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((v, j) => cell(v, `${colName(j)}${i + 1}`, bold.has(i))).join('')}</row>`).join('')}</sheetData>${filter}</worksheet>`;
}
const STYLES = '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
export function payrollWorkbook(run) {
  const headers = ['Employee ID', 'Employee Name', 'Monthly Salary', 'Working Days (this cutoff)', 'Month Working Days', 'Days Present (regular workdays)', 'Holiday Days', 'Days Credited', 'Late Minutes Not Offset', 'Leave Days / Notes', 'Regular OT', 'Rest Day Pay', 'Rest Day OT', 'NSD', 'Special Holiday Pay', 'Special Holiday OT', 'Regular Holiday Pay', 'Regular Holiday OT', 'Other Holiday Pay', 'Other Holiday OT', 'Basic Salary (regular days)', 'Holiday Pay (holidays credited)', 'Holiday Pay (total incl. holiday-work premium)', 'Additional', 'Allowances', '13th Month Paid', 'Gross Salary', 'Undertime', 'Unpaid Leave / Absence', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding Tax', 'Loan Deductions', 'Other Deductions', 'Total Deductions', 'Net Salary', 'Employer SSS', 'Employer SSS EC', 'Employer PhilHealth', 'Employer Pag-IBIG', 'Employer Total (not deducted)', 'Loan Balance', 'Loan Date', 'Loan Terms', 'Applicable Basic for 13th Month'];
  const payroll = [headers, ...run.rows.map(r => { const h = holidaySplit(r); return [r.employeeId, r.employeeName, r.monthlySalary, r.workingDays, r.monthWorkingDays ?? '', h.regularDays, h.holidayDays, r.creditedDays ?? r.daysPresent, r.lateMinutesUnoffset ?? 0, r.leaveNotes.join('; '), r.earnings.regularOT, r.earnings.restDay, r.earnings.restOT, r.earnings.nsd, r.earnings.specialHoliday, r.earnings.specialOT, r.earnings.regularHoliday, r.earnings.regularHolidayOT, r.earnings.otherHoliday, r.earnings.otherOT, h.regularBasic, h.holidayDayPay, h.holidayPay, r.earnings.additional, r.earnings.allowance, r.earnings.thirteenth, r.gross, r.deductions.undertime, r.deductions.absence, r.deductions.SSS, r.deductions.PhilHealth, r.deductions['Pag-IBIG'], r.deductions.tax, r.deductions.loans, r.deductions.other, r.totalDeductions, r.net, r.employer?.SSS ?? 0, r.employer?.['SSS EC'] ?? 0, r.employer?.PhilHealth ?? 0, r.employer?.['Pag-IBIG'] ?? 0, r.employerTotal ?? 0, r.loanBalance, r.loanDeductions.map(l => l.startDate).join('; '), r.loanDeductions.map(l => `${l.reference}: ${l.remainingTerms}/${l.terms}`).join('; '), r.applicableBasic]; })];
  const audit = [['Employee ID', 'Employee Name', 'Component', 'Side', 'Amount', 'Formula / Basis', 'Date', 'Source Type', 'Source ID'], ...run.rows.flatMap(r => r.trace.map(t => [r.employeeId, r.employeeName, t.component, t.side, t.amount, t.formula, t.date, t.sourceKind, t.sourceId]))];
  const late = [['Employee ID', 'Employee Name', 'Date', 'Scheduled', 'Actual', 'Late Minutes', 'Approved Offset', 'Approved Exception', 'Explanation', 'Minutes Not Offset', 'Days Lost', 'Basic Reduced By'], ...run.rows.flatMap(r => r.late.map(l => [r.employeeId, r.employeeName, l.date, l.scheduledTime, l.actualTime, l.lateMinutes, l.approvedOffset, String(l.validExplanation), l.explanation, l.deductibleMinutes, l.dayFraction ?? '', l.deduction]))];
  const meta = [['Payroll ID', run.id || 'Preview'], ['Start', run.start], ['End', run.end], ['Status', run.status || 'Preview'], ['Rules Version', run.ruleId], ['Employer contributions (not deducted)', run.totals?.employer ?? 0], ['Posted By', run.postedBy || ''], ['Posted At', run.postedAt || ''], ['Fingerprint', run.fingerprint]];
  return workbook({ Payroll: payroll, 'Calculation audit': audit, Lateness: late, Metadata: meta });
}
// Any number of sheets: { 'Sheet name': [[header...], [row...], ...] }. Sheet names are trimmed to Excel's 31-character limit.
export function workbook(sheets) {
  const entries = Object.entries(sheets).map(([name, rows]) => [name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), rows]);
  const files = {
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${entries.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    // fullCalcOnLoad: Excel recalculates every formula (totals, summaries) when the file is opened.
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${entries.map(([name], i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${entries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES,
  };
  entries.forEach(([, rows], i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheet(rows); });
  return zip(files);
}
// A titled table sheet: title, description, a blank row, the headings (bold, frozen, filter buttons), the rows, then a
// TOTAL row with SUM formulas for the `totals` columns (indexes). `money` columns get the peso format; `formulas` maps a
// column index to (excelRowNumber) => formula, so derived columns stay live when figures are edited in Excel.
export function tableSheet({ title, description = '', headers, rows, totals = [], money = totals, formulas = {}, widths = null }) {
  const top = [[{ v: title, bold: true }], [description], []], first = top.length + 2, last = top.length + 1 + rows.length;
  const body = rows.map((r, i) => r.map((v, j) => { const f = formulas[j]?.(first + i); return f ? { f, v: typeof v === 'number' ? v : undefined, money: money.includes(j) } : money.includes(j) && typeof v === 'number' ? { v, money: true } : v; }));
  const out = [...top, headers, ...body], withTotal = totals.length > 0 && rows.length > 0;
  if (withTotal) out.push(headers.map((_, j) => (j === 0 ? { v: 'TOTAL', bold: true } : totals.includes(j) ? { f: `SUM(${colName(j)}${first}:${colName(j)}${last})`, v: Math.round(rows.reduce((s, r) => s + (Number(r[j]) || 0), 0) * 100) / 100, bold: true, money: money.includes(j) } : '')));
  return { rows: out, header: top.length, totalRows: withTotal ? 1 : 0, widths: widths || headers.map((h, j) => Math.min(48, Math.max(10, String(h).length + 2, ...rows.slice(0, 200).map(r => String(r[j] ?? '').length + 2)))) };
}
// Plain values of a tableSheet (formulas replaced by their cached values), e.g. for the PDF of the same report.
export const sheetValues = spec => spec.rows.slice(spec.header + 1).map(r => r.map(c => (c !== null && typeof c === 'object' ? c.v ?? '' : c)));

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

// Approximate Helvetica advance widths (per 1 pt of font size): enough to right-align figures and fit text.
const glyphWidth = c => (/[0-9]/.test(c) ? 0.556 : /[.,:;' ]/.test(c) ? 0.278 : /[-()]/.test(c) ? 0.333 : /[A-Z]/.test(c) ? 0.667 : /[mw]/.test(c) ? 0.833 : /[ijlt]/.test(c) ? 0.25 : 0.52);
const textWidth = (s, size) => [...String(s)].reduce((w, c) => w + glyphWidth(c), 0) * size;
const isFigure = v => typeof v === 'number' || /^-?[\d,]+(\.\d+)?%?$/.test(String(v ?? '').trim());
const fitWidth = (value, width, size) => { let s = String(value ?? ''); if (textWidth(s, size) <= width) return s; while (s.length > 1 && textWidth(`${s}...`, size) > width) s = s.slice(0, -1); return `${s}...`; };
// Options: widths (relative column weights), headings may contain '\n' for two lines, totalRows (last N rows bold
// with a rule above), note (printed under the table on the last page), rightAlign (per column; default: columns of figures),
// groups ([{ label, from, to }]: a heading centred over columns from..to, drawn above their headings),
// emphasis (column indexes printed bold and one point larger, e.g. net salary).
// theme 'navy' (payroll register, Nov 26, 2026 design): white title area with a navy title, a navy band with `band`
// items ([{ label, value }]), `summary` boxes ([{ label, value }]) on the first page, a navy 'details' bar, a light-blue
// header row, a light-blue total row and emphasised columns on navy. Every report PDF uses it (Nov 26, 2026, HR);
// theme 'gds' keeps the earlier red-and-gold layout. Payslips have their own renderer and are not affected.
export function tablePdf({ title, subtitle = '', headers, rows, widths: weights = null, totalRows = 0, note = '', rightAlign = null, groups = [], emphasis = [], theme = 'navy', band = [], summary = [], details = '' }) {
  const navy = theme === 'navy';
  const usable = PAGE.width - PAGE.margin * 2, size = headers.length > 10 ? 6.5 : 7.5, pad = 3;
  const want = weights || headers.map((h, i) => Math.min(40, Math.max(...String(h).split('\n').map(x => x.length), ...rows.slice(0, 400).map(r => String(r[i] ?? '').length), 4)));
  const total = want.reduce((a, b) => a + b, 0), widths = want.map(w => (w / total) * usable);
  const right = rightAlign || headers.map((_, i) => { const vals = rows.map(r => r[i]).filter(v => v !== '' && v !== null && v !== undefined); return vals.length > 0 && vals.every(isFigure); });
  const headLines = Math.max(...headers.map(h => String(h).split('\n').length)) + (groups.length ? 1 : 0);
  const rowHeight = size + (navy ? 7 : 5), headHeight = rowHeight * headLines, bottom = 44 + (note ? 14 : 0);
  // navy: title 0-70, band 78-112, summary 122-170 (first page), details bar, then the table
  const bandH = band.length ? 42 : 0, summaryH = summary.length ? 58 : 0;
  const topOf = index => (navy ? PAGE.height - 122 - bandH - (index === 0 ? summaryH : 0) : PAGE.height - 92);
  const capacity = index => Math.max(1, Math.floor((topOf(index) - headHeight - bottom) / rowHeight));
  const pages = []; for (let i = 0, p = 0; i < Math.max(rows.length, 1); p++) { const n = capacity(p); pages.push(rows.slice(i, i + n)); i += n; }
  const firstIndexOf = index => pages.slice(0, index).reduce((n, pg) => n + pg.length, 0);
  const generated = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  const sizeOf = i => (emphasis.includes(i) ? size + 1 : size);
  const place = (text, i, x) => (navy && right[i] ? x + (widths[i] - textWidth(text, sizeOf(i))) / 2 : right[i] ? x + widths[i] - pad - textWidth(text, sizeOf(i)) : x + pad);
  const cells = (values, y, bold) => {
    let x = PAGE.margin;
    return values.map((v, i) => {
      let room = widths[i];
      if (!right[i]) for (let j = i + 1; j < values.length && (values[j] === '' || values[j] === null || values[j] === undefined); j++) room += widths[j];
      const s = fitWidth(v, room - pad * 2, sizeOf(i)), tx = place(s, i, x);
      x += widths[i];
      return `BT /${bold || emphasis.includes(i) ? 'F2' : 'F1'} ${sizeOf(i)} Tf ${tx.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(s)}) Tj ET`;
    }).join(' ');
  };
  const headerCells = y0 => Array.from({ length: headLines }, (_, line) => {
    let x = PAGE.margin;
    return headers.map((h, i) => {
      const parts = String(h).split('\n'), text = parts[line - (headLines - parts.length)] ?? '';   // bottom-aligned headings
      const s = fitWidth(text, widths[i] - pad * 2, size), tx = place(s, i, x);
      x += widths[i];
      return s ? `BT /F2 ${size} Tf ${tx.toFixed(1)} ${(y0 - line * rowHeight).toFixed(1)} Td (${pdfText(s)}) Tj ET` : '';
    }).join(' ');
  }).join(' ');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const pageIds = [];
  // Navy page (payroll register): returns its page object id after pushing the page and its stream.
  const NAVY = '0.08 0.19 0.43', INK = '0.07 0.15 0.36', TINT = '0.89 0.92 0.98', LINE = '0.82 0.86 0.94';
  const rect = (rgb, x, y, w, h) => `${rgb} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`;
  const text = (rgb, font, sz, x, y, t) => `${rgb} rg BT /${font} ${sz} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(t)}) Tj ET`;
  const dataCount = Math.max(0, rows.length - totalRows);
  function navyPage(page, index, top) {
    const W = PAGE.width, M = PAGE.margin, parts = [];
    parts.push(text(INK, 'F2', 20, M, PAGE.height - 38, title), text('0.24 0.27 0.38', 'F1', 9, M, PAGE.height - 54, `GDS CAPITAL INC.${subtitle ? ` - ${subtitle}` : ''}`));
    parts.push(rect('0.84 0.08 0.10', 0, PAGE.height - 6, W, 6));
    // navy band with period / employees
    const bandY = PAGE.height - 112;
    if (band.length) parts.push(rect(NAVY, M, bandY, usable, 34), rect('0.84 0.08 0.10', M + usable - 60, bandY, 6, 34));
    let bx = M + 16;
    band.forEach(b => { parts.push(text('0.78 0.84 0.95', 'F1', 7.5, bx, bandY + 21, b.label), text('1 1 1', 'F2', 10.5, bx, bandY + 8, b.value)); bx += Math.max(150, textWidth(b.value, 10.5) + 40); });
    if (index === 0 && summary.length) {
      const gap = 8, bw = (usable - gap * (summary.length - 1)) / summary.length, sy = PAGE.height - 128 - bandH;
      summary.forEach((b, i) => { const x = M + i * (bw + gap); parts.push(rect(LINE, x, sy, bw, 48), rect('0.96 0.97 1', x + 0.8, sy + 0.8, bw - 1.6, 46.4), rect(i === 1 ? '0.84 0.08 0.10' : NAVY, x + 0.8, sy + 0.8, 3, 46.4), text(INK, 'F1', 8, x + 12, sy + 31, b.label), text(INK, 'F2', 13, x + 12, sy + 12, b.value)); });
    }
    // details bar
    const barY = top + rowHeight + 1;
    parts.push(rect(NAVY, M, barY, usable, 22), text('1 1 1', 'F2', 10, M + 12, barY + 11 - 3.6, details || title));
    // header row
    parts.push(rect(TINT, M, top - headHeight + rowHeight - 4, usable, headHeight + 2), `${INK} rg ${headerCells(top)}`);
    groups.forEach(g => {
      const x0 = M + widths.slice(0, g.from).reduce((a, b) => a + b, 0), span = widths.slice(g.from, g.to + 1).reduce((a, b) => a + b, 0);
      const tx = x0 + (span - textWidth(g.label, size + 1)) / 2, ruleY = top - 3.5;
      parts.push(`${INK} rg BT /F2 ${size + 1} Tf ${tx.toFixed(1)} ${top.toFixed(1)} Td (${pdfText(g.label)}) Tj ET ${NAVY} RG 0.6 w ${(x0 + pad).toFixed(1)} ${ruleY.toFixed(1)} m ${(x0 + span - pad).toFixed(1)} ${ruleY.toFixed(1)} l S`);
    });
    // emphasised columns: navy background through header and rows
    const first = top - headHeight + rowHeight, rowsBottom = first - page.length * rowHeight - 4;
    emphasis.forEach(i => { const x0 = M + widths.slice(0, i).reduce((a, b) => a + b, 0); parts.push(rect(NAVY, x0, rowsBottom, widths[i], top + rowHeight - 2 - rowsBottom)); });
    page.forEach((row, r) => {
      const y = first - (r + 1) * rowHeight, n = firstIndexOf(index) + r, isTotal = n >= rows.length - totalRows;
      if (isTotal) parts.push(rect(TINT, M, y - 4, usable, rowHeight));
      else if (r % 2) parts.push(rect('0.97 0.98 1', M, y - 4, usable, rowHeight));
      parts.push(`${LINE} RG 0.4 w ${M} ${(y - 4).toFixed(1)} m ${M + usable} ${(y - 4).toFixed(1)} l S`);
      emphasis.forEach(i => { const x0 = M + widths.slice(0, i).reduce((a, b) => a + b, 0); parts.push(rect(NAVY, x0, y - 4, widths[i], rowHeight)); });
      parts.push(`${INK} rg ${cells(row.map((v, i) => (emphasis.includes(i) ? '' : v)), y, isTotal)}`);
      emphasis.forEach(i => { const x0 = M + widths.slice(0, i).reduce((a, b) => a + b, 0), sv = fitWidth(row[i], widths[i] - pad * 2, size + 1); parts.push(text('1 1 1', 'F2', size + 1, place(sv, i, x0), y, sv)); });
    });
    emphasis.forEach(i => { const x0 = M + widths.slice(0, i).reduce((a, b) => a + b, 0), parts2 = String(headers[i]).split('\n'); parts2.forEach((t, k) => { const sv = fitWidth(t, widths[i] - pad * 2, size); parts.push(text('1 1 1', 'F2', size, place(sv, i, x0), top - (headLines - parts2.length + k) * rowHeight, sv)); }); });
    if (!rows.length) parts.push(text('0.35 0.38 0.5', 'F1', 9, M + 3, top - rowHeight - 4, 'No records.'));
    if (note && index === pages.length - 1) parts.push(text('0.35 0.38 0.5', 'F1', 7, M + pad, first - (page.length + 1) * rowHeight - 4, note));
    parts.push(rect(TINT, M, 14, usable, 18), text(INK, 'F1', 7, M + 10, 20, `Showing ${dataCount ? `${Math.min(dataCount, firstIndexOf(index) + 1)}-${Math.min(dataCount, firstIndexOf(index) + page.length)}` : 0} of ${dataCount} record${dataCount === 1 ? '' : 's'} - Confidential - Generated ${generated} (Asia/Manila)`), text(INK, 'F2', 7, W - M - 60, 20, `Page ${index + 1} of ${pages.length}`));
    const stream = parts.join('\n'), pageId = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    return [pageId];
  }
  pages.forEach((page, index) => {
    const top = topOf(index);
    if (navy) { pageIds.push(...navyPage(page, index, top)); return; }
    const parts = [
      `0.66 0.12 0.18 rg 0 ${PAGE.height - 58} ${PAGE.width} 58 re f`,                 // GDS red band
      `0.85 0.72 0.36 rg 0 ${PAGE.height - 61} ${PAGE.width} 3 re f`,                   // gold rule
      `1 1 1 rg BT /F2 15 Tf ${PAGE.margin} ${PAGE.height - 30} Td (${pdfText(title)}) Tj ET`,
      `1 1 1 rg BT /F1 8.5 Tf ${PAGE.margin} ${PAGE.height - 46} Td (${pdfText(`GDS CAPITAL INC.${subtitle ? ` - ${subtitle}` : ''}`)}) Tj ET`,
      `0.97 0.92 0.78 rg ${PAGE.margin} ${top - headHeight + rowHeight - 4} ${usable} ${headHeight + 2} re f`,     // header row
      `0.42 0.30 0.06 rg ${headerCells(top)}`,
      ...groups.map(g => {
        const x0 = PAGE.margin + widths.slice(0, g.from).reduce((a, b) => a + b, 0), span = widths.slice(g.from, g.to + 1).reduce((a, b) => a + b, 0);
        const tx = x0 + (span - textWidth(g.label, size + 1)) / 2, ruleY = top - 3.5;
        return `0.42 0.30 0.06 rg BT /F2 ${size + 1} Tf ${tx.toFixed(1)} ${top.toFixed(1)} Td (${pdfText(g.label)}) Tj ET 0.42 0.30 0.06 RG 0.6 w ${(x0 + pad).toFixed(1)} ${ruleY.toFixed(1)} m ${(x0 + span - pad).toFixed(1)} ${ruleY.toFixed(1)} l S`;
      }),
    ];
    const first = top - headHeight + rowHeight;
    page.forEach((row, r) => {
      const y = first - (r + 1) * rowHeight, n = firstIndexOf(index) + r, isTotal = n >= rows.length - totalRows;
      if (isTotal && n === rows.length - totalRows) parts.push(`0.42 0.30 0.06 RG 0.8 w ${PAGE.margin} ${(y + rowHeight - 3.5).toFixed(1)} m ${PAGE.margin + usable} ${(y + rowHeight - 3.5).toFixed(1)} l S`);
      else if (r % 2) parts.push(`0.99 0.97 0.91 rg ${PAGE.margin} ${y - 4} ${usable} ${rowHeight} re f`);
      parts.push(`0.13 0.11 0.08 rg ${cells(row, y, isTotal)}`);
      if (note && index === pages.length - 1 && r === page.length - 1) parts.push(`0.35 0.30 0.20 rg BT /F1 7 Tf ${PAGE.margin + pad} ${(y - rowHeight - 4).toFixed(1)} Td (${pdfText(note)}) Tj ET`);
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
