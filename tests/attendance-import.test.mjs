import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { Store } from '../src/store.mjs';
import { workbook } from '../src/export.mjs';
import { readSpreadsheet } from '../src/xlsx-read.mjs';
import { inspectImport, previewImport, commitImport, parseDate, parseTime, guessMapping } from '../src/attendance-import.mjs';
import { preview } from '../src/service.mjs';
import { completeState } from './helpers.mjs';

const hr = { username: 'hr1', role: 'hr' }, viewer = { username: 'v', role: 'viewer' };
function fixture() {
  const store = new Store(':memory:'), state = completeState();
  state.employees.push({ ...state.employees[0], id: 'EMP-002', name: 'Dela Cruz, Maria Santos' });
  store.write(state); return store;
}
const upload = (fileName, buffer, extra = {}) => ({ fileName, content: buffer.toString('base64'), ...extra });

test('values from real-world sheets: dates, times and headings are recognised without a template', () => {
  assert.equal(parseDate(46281), '2026-09-16');
  assert.equal(parseDate('9/16/2026'), '2026-09-16');
  assert.equal(parseDate('16/09/2026', 'dmy'), '2026-09-16');
  assert.equal(parseDate('Sep 16, 2026'), '2026-09-16');
  assert.equal(parseDate('Wednesday, September 16, 2026'), '2026-09-16');
  assert.equal(parseDate('16-Sep-26'), '2026-09-16');
  assert.equal(parseDate('2/30/2026'), null);
  assert.equal(parseTime(0.375), '09:00');
  assert.equal(parseTime('8:05 AM'), '08:05');
  assert.equal(parseTime('6:30pm'), '18:30');
  assert.equal(parseTime('12:15 AM'), '00:15');
  assert.equal(parseTime('2026-09-16 18:39:12'), '18:39');
  assert.equal(parseTime('5 PM'), '17:00');
  assert.equal(parseTime('25:00'), null);
  assert.deepEqual(guessMapping(['No.', 'Employee Name', 'Date', 'Time-In', 'Time-Out', 'Remarks']), { employeeId: null, employeeName: 1, date: 2, timeIn: 3, timeOut: 4, punch: null, status: 5 });
  assert.equal(guessMapping(['AC-No.', 'Name', 'Date/Time']).punch, null, '"Date/Time" is not a plain punch heading');
  assert.equal(guessMapping(['AC-No.', 'Name', 'Date Time']).punch, 2);
});

test('an Excel sheet is previewed with missing data, unmatched names and duplicates flagged, then imported for payroll', () => {
  const store = fixture();
  try {
    const file = workbook({ 'Sept 16-30': [
      ['GDS CAPITAL INC. biometric summary'], [],
      ['Employee Name', 'Date', 'Time In', 'Time Out', 'Remarks'],
      ['Sample Employee', '09/16/2026', '8:02 AM', '5:10 PM', ''],
      ['Maria Dela Cruz', '09/16/2026', '7:55 AM', '5:00 PM', ''],
      ['Maria Dela Cruz', '09/16/2026', '7:55 AM', '5:00 PM', ''],
      ['Sample Employee', '09/17/2026', '8:00 AM', '', ''],
      ['Juan Unknown', '09/17/2026', '8:00 AM', '5:00 PM', ''],
      ['Maria Dela Cruz', '09/17/2026', '', '', 'Absent'],
      ['Sample Employee', '09/15/2026', '8:00 AM', '5:00 PM', ''],
    ] });
    const inspected = inspectImport(store, hr, upload('sept.xlsx', file));
    assert.equal(inspected.sheets[0].headerRow, 2);
    assert.equal(inspected.sheets[0].mapping.timeOut, 3);
    const p = previewImport(store, hr, upload('sept.xlsx', file));
    assert.deepEqual(p.counts, { ready: 3, replace: 0, review: 2, duplicate: 1, existing: 1 });
    assert.deepEqual(p.unmatched, ['Juan Unknown']);
    assert.match(p.rows.find(r => r.line === 7).issues[0], /Missing time out/);
    assert.match(p.rows.find(r => r.line === 6).issues[0], /Duplicate of row 5/);
    assert.match(p.rows.find(r => r.line === 10).issues[0], /Already recorded/);
    assert.equal(store.read().attendance.filter(a => a.date >= '2026-09-16').length, 0, 'a preview saves nothing');

    // HR assigns the unmatched name, then imports.
    const done = commitImport(store, hr, upload('sept.xlsx', file, { assignments: { 'Juan Unknown': 'EMP-001' } }));
    assert.equal(done.saved, 4);
    const sept16 = store.read().attendance.find(a => a.employeeId === 'EMP-001' && a.date === '2026-09-16');
    assert.equal(sept16.timeIn, '08:02'); assert.equal(sept16.timeOut, '17:10'); assert.equal(sept16.approved, true);
    assert.deepEqual(sept16.breaks, [{ start: '2026-09-16T12:00', end: '2026-09-16T13:00' }]);
    assert.equal(store.read().attendance.find(a => a.employeeId === 'EMP-002' && a.date === '2026-09-17').status, 'absent');
    const run = preview(store, '2026-09-16', '2026-09-30', false, ['EMP-001']);
    assert.ok(run.rows[0].daysPresent >= 1, 'imported days reach payroll');
    assert.throws(() => commitImport(store, viewer, upload('sept.xlsx', file)), /permission/i);
  } finally { store.close(); }
});

test('biometric punch logs (one row per punch) become one day with first in and last out; CSV and replace work', () => {
  const store = fixture();
  try {
    const csv = Buffer.from('AC-No.,Name,Date Time\nEMP-001,Sample Employee,2026-09-21 08:47\nEMP-001,Sample Employee,2026-09-21 12:01\nEMP-001,Sample Employee,2026-09-21 18:39\nEMP-001,Sample Employee,2026-09-22 09:07\n');
    const p = previewImport(store, hr, upload('logs.csv', csv));
    assert.equal(p.punchMode, true);
    const day = p.rows.find(r => r.date === '2026-09-21');
    assert.equal(day.timeIn, '08:47'); assert.equal(day.timeOut, '18:39'); assert.equal(day.result, 'ready');
    assert.match(p.rows.find(r => r.date === '2026-09-22').issues[0], /one punch/i);
    commitImport(store, hr, upload('logs.csv', csv));
    const again = Buffer.from('Emp ID,Date,In,Out\nEMP-001,9/21/2026,08:30,17:30\n');
    assert.equal(previewImport(store, hr, upload('fix.csv', again)).counts.existing, 1);
    const replaced = commitImport(store, hr, upload('fix.csv', again, { replaceExisting: true }));
    assert.equal(replaced.counts.replace, 1);
    assert.equal(store.read().attendance.find(a => a.date === '2026-09-21').timeIn, '08:30');
  } finally { store.close(); }
});

test('real Excel files (deflate-compressed, shared strings, serial dates) are read; old .xls is refused clearly', () => {
  const entries = {
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Logs" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Date</t></si><si><r><t>Sample </t></r><r><t>Employee</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>46281.375</v></c></row></sheetData></worksheet>',
  };
  const local = [], central = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflateRawSync(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(c, n); offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  const [sheet] = readSpreadsheet('book.xlsx', Buffer.concat([...local, dir, end]));
  assert.equal(sheet.name, 'Logs');
  assert.deepEqual(sheet.rows[1], ['Sample Employee', '', 46281.375]);
  assert.throws(() => readSpreadsheet('old.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])), /Save As/);
});
