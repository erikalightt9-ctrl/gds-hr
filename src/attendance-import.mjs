// Bulk attendance from any spreadsheet: no template. Columns are recognised from their headings, HR confirms or
// changes the mapping, every row is checked by the same rules as a manually entered record, and nothing is saved
// until HR confirms the preview.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { scheduleOn } from './engine.mjs';
import { readSpreadsheet, MAX_UPLOAD_BYTES } from './xlsx-read.mjs';

export const FIELDS = {
  employeeId: 'Employee ID / number',
  employeeName: 'Employee name',
  date: 'Attendance date',
  timeIn: 'Time in',
  timeOut: 'Time out',
  punch: 'Date & time punch (one log per row)',
  status: 'Status / remarks (optional)',
};
const HEADING_PATTERNS = {
  employeeId: /^(emp(loyee)?\.?\s*(id|no\.?|number|#|code)|id(\s*(no\.?|number))?|ac[\s.-]*no\.?|badge(\s*no\.?)?|user\s*id|enroll(ment)?\s*(no\.?|id)|person(nel)?\s*(id|no\.?)|staff\s*(id|no\.?))$/,
  employeeName: /^((employee|staff|full|personnel)\s*)?name$|^employee$|^staff$|^personnel$|^name\s*of\s*employee$/,
  date: /^(attendance\s*|work\s*|log\s*|duty\s*)?date$|^day$|^date\s*\(.*\)$/,
  timeIn: /^(time|clock|check|log|punch)[\s-]*in$|^in$|^am\s*in$|^arrival$|^first\s*in$|^in\s*time$|^login$/,
  timeOut: /^(time|clock|check|log|punch)[\s-]*out$|^out$|^pm\s*out$|^departure$|^last\s*out$|^out\s*time$|^logout$/,
  punch: /^(date\s*(and|&)?\s*time|datetime|timestamp|punch(\s*time)?|log\s*time|check\s*time|record(ed)?\s*time|time)$/,
  status: /^(status|remarks?|day\s*status|attendance\s*status|notes?)$/,
};
const norm = value => String(value ?? '').trim().toLowerCase().replace(/[_:]+/g, ' ').replace(/\s+/g, ' ');

const mappingSchema = z.object(Object.fromEntries(Object.keys(FIELDS).map(k => [k, z.number().int().min(0).max(79).nullable().default(null)]))).strict();
const requestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  content: z.string().max(Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 4),
  sheet: z.number().int().min(0).max(50).default(0),
  headerRow: z.number().int().min(0).max(4999).optional(),
  mapping: mappingSchema.optional(),
  dateOrder: z.enum(['auto', 'mdy', 'dmy']).default('auto'),
  assignments: z.record(z.string().max(200), z.string().max(80)).default({}),
  approve: z.boolean().default(true),
  replaceExisting: z.boolean().default(false),
}).strict();

function loadSheets(input) {
  const buffer = Buffer.from(input.content, 'base64');
  if (!buffer.length) throw new AppError('The file is empty.');
  const sheets = readSpreadsheet(input.fileName, buffer).filter(s => s.rows.some(r => r.some(c => c !== '')));
  if (!sheets.length) throw new AppError('No data was found in this file.');
  return { sheets, fingerprint: createHash('sha256').update(buffer).digest('hex').slice(0, 16) };
}
// The heading row is the one (within the first 20) whose cells best match known column names.
export function detectHeader(rows) {
  let best = { row: 0, score: -1 };
  rows.slice(0, 20).forEach((cells, row) => {
    const score = cells.filter(c => Object.values(HEADING_PATTERNS).some(p => p.test(norm(c)))).length;
    if (score > best.score) best = { row, score };
  });
  return best.row;
}
export function guessMapping(headers) {
  const mapping = Object.fromEntries(Object.keys(FIELDS).map(k => [k, null])), used = new Set();
  for (const field of Object.keys(FIELDS)) {
    const col = headers.findIndex((h, i) => !used.has(i) && HEADING_PATTERNS[field].test(norm(h)));
    if (col >= 0) { mapping[field] = col; used.add(col); }
  }
  // Loose fallbacks for headings such as "Employee Name (Last, First)" or "Time-In (AM)".
  const loose = { employeeName: /name/, timeIn: /\bin\b/, timeOut: /\bout\b/, date: /date/ };
  for (const [field, pattern] of Object.entries(loose)) if (mapping[field] === null) {
    const col = headers.findIndex((h, i) => !used.has(i) && pattern.test(norm(h)) && !/id|no\b/.test(norm(h)));
    if (col >= 0) { mapping[field] = col; used.add(col); }
  }
  if (mapping.timeIn !== null || mapping.timeOut !== null) mapping.punch = null;
  return mapping;
}

// ---------- Values ----------
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const validDate = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null; };
const serialDate = n => new Date(Math.round((Math.floor(n) - 25569) * 86400000)).toISOString().slice(0, 10);
const serialTime = n => { const minutes = Math.round((n - Math.floor(n)) * 1440) % 1440; return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`; };
export function parseDate(value, order = 'mdy') {
  if (typeof value === 'number') return value > 20000 && value < 80000 ? serialDate(value) : null;
  const s = String(value ?? '').trim().toLowerCase().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s*/, '');
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(s);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return order === 'dmy' ? validDate(y, +m[2], +m[1]) : validDate(y, +m[1], +m[2]); }
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})/.exec(s);
  if (m && MONTHS.includes(m[1])) return validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS.indexOf(m[1]) + 1, +m[2]);
  m = /^(\d{1,2})[\s-]+([a-z]{3})[a-z]*\.?[\s-]+(\d{2,4})/.exec(s);
  if (m && MONTHS.includes(m[2])) return validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
  return null;
}
export function parseTime(value) {
  if (typeof value === 'number') return value >= 0 && value < 80000 ? serialTime(value) : null;
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  const m = /(?:^|\s|t)(\d{1,2})(?:[:.](\d{2}))(?:[:.]\d{2})?\s*([ap])?\.?m?\.?\s*$/.exec(s) || /^(\d{1,2})()\s*([ap])\.?m\.?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0), suffix = m[3];
  if (min > 59 || h > 23 || (suffix && (h < 1 || h > 12))) return null;
  if (suffix === 'p' && h < 12) h += 12;
  if (suffix === 'a' && h === 12) h = 0;
  return `${pad(h)}:${pad(min)}`;
}
const parsePunch = (value, order) => typeof value === 'number' ? (value > 20000 ? { date: serialDate(value), time: serialTime(value) } : null) : { date: parseDate(value, order), time: parseTime(value) };
export function detectDateOrder(values) {
  for (const v of values) { const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(String(v)); if (m && +m[1] > 12) return 'dmy'; if (m && +m[2] > 12) return 'mdy'; }
  return 'mdy';
}
const statusOf = value => {
  const s = norm(value);
  if (!s) return '';
  if (/absent|awol|no show|no work/.test(s)) return 'absent';
  if (/rest|day off|\boff\b|holiday/.test(s)) return 'off';
  if (/official business|\bob\b|field work/.test(s)) return 'official-business';
  return '';
};
export const cellText = value => typeof value === 'number' ? (Number.isInteger(value) && value > 20000 && value < 80000 ? serialDate(value) : value > 0 && value < 1 ? serialTime(value) : value > 20000 && value < 80000 ? `${serialDate(value)} ${serialTime(value)}` : String(value)) : String(value ?? '');

// ---------- Employees ----------
const nameTokens = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\(.*?\)/g, ' ').split(/[^A-Z]+/).filter(t => t.length > 1 && !['JR', 'SR', 'II', 'III', 'IV'].includes(t));
function matchEmployee(employees, idValue, nameValue, assignments) {
  const id = String(idValue ?? '').trim(), name = String(nameValue ?? '').trim(), key = identityKey(idValue, nameValue);
  if (assignments[key]) return { employee: employees.find(e => e.id === assignments[key]) || null, key, assigned: true };
  if (id) { const byId = employees.find(e => e.id.toLowerCase() === id.toLowerCase()); if (byId) return { employee: byId, key }; }
  if (name) {
    const byId = employees.find(e => e.id.toLowerCase() === name.toLowerCase()); if (byId) return { employee: byId, key };
    const tokens = nameTokens(name);
    if (tokens.length >= 2) {
      const candidates = employees.filter(e => { const own = new Set(nameTokens(e.name)); return tokens.every(t => own.has(t)); });
      if (candidates.length === 1) return { employee: candidates[0], key };
      if (candidates.length > 1) return { employee: null, key, ambiguous: candidates.map(c => c.id) };
    }
  }
  return { employee: null, key };
}
const identityKey = (idValue, nameValue) => [String(idValue ?? '').trim(), String(nameValue ?? '').trim()].filter(Boolean).join(' · ');

// ---------- Inspect: sheets, heading row and suggested mapping ----------
export function inspectImport(store, actor, body) {
  permit(actor, ['admin', 'hr']);
  const input = requestSchema.parse(body), { sheets } = loadSheets(input);
  return {
    fields: FIELDS,
    sheets: sheets.map(({ name, rows }, index) => {
      const headerRow = index === input.sheet && input.headerRow !== undefined ? input.headerRow : detectHeader(rows), headers = (rows[headerRow] || []).map(cellText), mapping = guessMapping(headers);
      const width = Math.max(headers.length, ...rows.slice(headerRow + 1, headerRow + 30).map(r => r.length));
      const dateValues = rows.slice(headerRow + 1).map(r => r[mapping.date ?? mapping.punch ?? -1]).filter(v => typeof v === 'string');
      return { name, rowCount: Math.max(0, rows.length - headerRow - 1), headerRow, columns: Array.from({ length: width }, (_, i) => headers[i] || `Column ${i + 1}`), mapping, dateOrder: detectDateOrder(dateValues), sample: rows.slice(headerRow + 1, headerRow + 7).map(r => Array.from({ length: width }, (_, i) => cellText(r[i]))) };
    }),
  };
}

// ---------- Preview / import ----------
function buildRows(state, store, input, sheet) {
  const rows = sheet.rows, headerRow = input.headerRow ?? detectHeader(rows);
  const mapping = input.mapping ?? guessMapping((rows[headerRow] || []).map(cellText));
  if (mapping.employeeId === null && mapping.employeeName === null) throw new AppError('Choose the column that identifies the employee (ID or name).');
  const punchMode = mapping.timeIn === null && mapping.timeOut === null;
  if (punchMode && mapping.punch === null) throw new AppError('Choose the time-in and time-out columns, or a date & time punch column.');
  if (!punchMode && mapping.date === null) throw new AppError('Choose the attendance date column.');
  const order = input.dateOrder === 'auto' ? detectDateOrder(rows.slice(headerRow + 1).map(r => r[mapping.date ?? mapping.punch]).filter(v => typeof v === 'string')) : input.dateOrder;
  const get = (cells, field) => mapping[field] === null ? '' : cells[mapping[field]] ?? '';
  const employees = state.employees, entries = [];
  rows.slice(headerRow + 1).forEach((cells, i) => {
    if (!cells.some(c => c !== '')) return;
    const line = headerRow + i + 2, match = matchEmployee(employees, get(cells, 'employeeId'), get(cells, 'employeeName'), input.assignments);
    const status = statusOf(get(cells, 'status')), issues = [];
    let date, timeIn = null, timeOut = null;
    if (punchMode) {
      const punch = parsePunch(get(cells, 'punch'), order);
      date = (mapping.date !== null ? parseDate(get(cells, 'date'), order) : null) || punch?.date; timeIn = punch?.time || null;
      if (get(cells, 'punch') !== '' && !punch?.time) issues.push('Punch time not recognised');
    } else {
      date = parseDate(get(cells, 'date'), order); timeIn = parseTime(get(cells, 'timeIn')); timeOut = parseTime(get(cells, 'timeOut'));
      if (get(cells, 'timeIn') !== '' && !timeIn) issues.push('Time in not recognised');
      if (get(cells, 'timeOut') !== '' && !timeOut) issues.push('Time out not recognised');
    }
    if (!match.key) issues.push('Missing employee');
    else if (match.ambiguous) issues.push(`Name matches more than one employee (${match.ambiguous.join(', ')})`);
    else if (!match.employee) issues.push('Employee not found');
    if (!date) issues.push(get(cells, mapping.date !== null ? 'date' : 'punch') === '' ? 'Missing date' : 'Date not recognised');
    entries.push({ line, key: match.key, assigned: !!match.assigned, employeeId: match.employee?.id || null, date, timeIn, timeOut, status, issues, source: Object.fromEntries(Object.keys(FIELDS).filter(f => mapping[f] !== null).map(f => [f, cellText(get(cells, f))])) });
  });
  if (!punchMode) return { entries, punchMode, mapping, headerRow, order };
  // Punch logs: the first and last punch of each employee's day become time in and time out.
  const days = new Map(), loose = [];
  for (const e of entries) {
    if (!e.employeeId || !e.date || !e.timeIn) { loose.push(e); continue; }
    const k = `${e.employeeId}|${e.date}`, day = days.get(k);
    if (!day) days.set(k, { ...e, punches: [e.timeIn], lines: [e.line] });
    else { day.punches.push(e.timeIn); day.lines.push(e.line); day.issues.push(...e.issues); }
  }
  const grouped = [...days.values()].map(d => {
    const sorted = [...new Set(d.punches)].sort();
    return { ...d, line: d.lines[0], lines: d.lines, timeIn: sorted[0], timeOut: sorted.length > 1 ? sorted.at(-1) : null, punchCount: d.punches.length };
  });
  return { entries: [...grouped, ...loose].sort((a, b) => a.line - b.line), punchMode, mapping, headerRow, order };
}

const LUNCH_START = '12:00';
function toRecord(store, state, entry, input) {
  const employee = state.employees.find(e => e.id === entry.employeeId);
  const profile = JSON.parse(store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='attendance'").get(employee.id)?.data ?? '{}');
  const schedule = scheduleOn(employee, profile, entry.date);
  const status = entry.status || 'present', endNextDay = !!(entry.timeIn && entry.timeOut && entry.timeOut < entry.timeIn);
  const lunchEnd = `${pad(12 + Math.floor(schedule.mealBreakMinutes / 60))}:${pad(schedule.mealBreakMinutes % 60)}`;
  const spansLunch = status === 'present' && schedule.mealBreakMinutes > 0 && entry.timeIn <= LUNCH_START && (endNextDay || entry.timeOut >= lunchEnd);
  return {
    id: `xl-${entry.employeeId}-${entry.date}`, employeeId: entry.employeeId, date: entry.date, status,
    scheduledIn: schedule.start || entry.timeIn || employee.scheduleStart || '09:00',
    timeIn: status === 'present' ? entry.timeIn : '', timeOut: status === 'present' ? entry.timeOut : '', endNextDay,
    breaks: spansLunch ? [{ start: `${entry.date}T${LUNCH_START}`, end: `${entry.date}T${lunchEnd}` }] : [],
    approved: input.approve, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true,
  };
}

// Runs every row through saveRecord inside one transaction. A preview always rolls back; an import commits only
// when no row that was going to be saved fails.
function evaluate(store, actor, input, commit) {
  const { sheets, fingerprint } = loadSheets(input), sheet = sheets[input.sheet];
  if (!sheet) throw new AppError('That sheet is not in the file.');
  const ROLLBACK = Symbol('preview');
  let outcome;
  try {
    store.transaction(() => {
      const state = store.read(), built = buildRows(state, store, input, sheet), seen = new Map();
      const rows = built.entries.map(entry => {
        const issues = [...entry.issues], row = { line: entry.line, lines: entry.lines, key: entry.key, assigned: entry.assigned, employeeId: entry.employeeId, employeeName: state.employees.find(e => e.id === entry.employeeId)?.name || '', date: entry.date, timeIn: entry.timeIn, timeOut: entry.timeOut, status: entry.status || 'present', source: entry.source, punchCount: entry.punchCount };
        if (!issues.length && !entry.status && (!entry.timeIn || !entry.timeOut)) issues.push(!entry.timeIn && !entry.timeOut ? 'Missing time in and time out' : !entry.timeIn ? 'Missing time in' : entry.punchCount ? 'Only one punch this day: missing time out' : 'Missing time out');
        if (issues.length) return { ...row, result: 'review', issues };
        const k = `${entry.employeeId}|${entry.date}`;
        if (seen.has(k)) return { ...row, result: 'duplicate', issues: [`Duplicate of row ${seen.get(k)} in this file`] };
        seen.set(k, entry.line);
        const current = store.read(), existing = current.attendance.find(a => a.employeeId === entry.employeeId && a.date === entry.date);
        if (existing && !input.replaceExisting) return { ...row, result: 'existing', issues: [`Already recorded (${existing.status}${existing.timeIn ? ` ${existing.timeIn}–${existing.timeOut}` : ''})`] };
        if (existing?.id.startsWith('clock-')) return { ...row, result: 'existing', issues: ['Already recorded from the employee\'s GPS clock; correct it on the timecard instead'] };
        const record = toRecord(store, current, entry, input);
        try {
          saveRecord(store, actor, 'attendance', existing ? { ...record, id: existing.id, correctionReason: `Replaced by Excel import (${input.fileName}, row ${entry.line}).` } : record);
          return { ...row, result: existing ? 'replace' : 'ready', issues: [], endNextDay: record.endNextDay };
        } catch (error) {
          if (!(error instanceof AppError) && !(error instanceof z.ZodError)) throw error;
          return { ...row, result: 'review', issues: [error instanceof z.ZodError ? error.issues.map(i => i.message).join('; ') : error.message] };
        }
      });
      const counts = Object.fromEntries(['ready', 'replace', 'review', 'duplicate', 'existing'].map(k => [k, rows.filter(r => r.result === k).length]));
      const unmatched = [...new Set(rows.filter(r => !r.employeeId && r.key).map(r => r.key))];
      outcome = { fileName: input.fileName, fingerprint, sheet: sheet.name, headerRow: built.headerRow, mapping: built.mapping, dateOrder: built.order, punchMode: built.punchMode, rows, counts, unmatched, saved: 0 };
      if (!commit) throw ROLLBACK;
      outcome.saved = counts.ready + counts.replace;
      if (!outcome.saved) throw new AppError('There are no rows ready to import.');
      store.log(actor, 'import-attendance', 'attendance', fingerprint, null, { fileName: input.fileName, sheet: sheet.name, saved: counts.ready, replaced: counts.replace, skipped: rows.length - outcome.saved, approved: input.approve });
    });
  } catch (error) { if (error !== ROLLBACK) throw error; }
  return outcome;
}
export const previewImport = (store, actor, body) => { permit(actor, ['admin', 'hr']); return evaluate(store, actor, requestSchema.parse(body), false); };
export const commitImport = (store, actor, body) => { permit(actor, ['admin', 'hr']); return evaluate(store, actor, requestSchema.parse(body), true); };
