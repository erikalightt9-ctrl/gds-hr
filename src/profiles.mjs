import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { date } from './schema.mjs';
import { AppError, permit } from './service.mjs';
import { leaveBalance, ruleOn } from './engine.mjs';

const text = z.string().trim().max(1000).default('');
const optionalDate = z.union([date, z.literal('')]).default('');
const number = (min, max) => z.number().finite().min(min).max(max).nullable().default(null);
const choice = values => z.enum(['', ...values]).default('');
const time = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]).default('');
const arrangements = ['Office', 'WFH', 'Hybrid'];
// A weekday (0 = Sunday) whose blank fields inherit the base attendance schedule.
const daySchedule = z.object({ day: z.number().int().min(0).max(6), scheduleStart: time, scheduleEnd: time, hoursPerDay: number(1, 16), mealBreakMinutes: number(0, 240), arrangement: choice(arrangements) }).strict();
export const profileSchemas = {
  personal: z.object({ lastName: text, firstName: text, middleName: text, suffix: text, sex: choice(['Female', 'Male', 'Other']), birthDate: optionalDate, civilStatus: text, nationality: text, mobile: text, personalEmail: text, address: text }).strict(),
  employment: z.object({ position: z.string({ error: 'Position is required.' }).trim().min(1, 'Position is required.').max(1000), employmentStatus: choice(['Probationary', 'Regular', 'Project-Based', 'Contractual', 'Seasonal', 'Other']), regularizationDate: optionalDate, employmentType: choice(['Full-Time', 'Part-Time', 'Other']), supervisor: text, workLocation: text, businessEmail: text, employeeStatus: choice(['Active', 'On Leave', 'Suspended', 'Resigned', 'Terminated', 'Inactive']) }).strict(),
  government: z.object({ sss: text, philHealth: text, pagIbig: text, tin: text, otherId: text, expiry: optionalDate }).strict(),
  emergency: z.object({ name: text, relationship: text, contact: text, alternateContact: text, address: text }).strict(),
  attendance: z.object({ scheduleEnd: time, hoursPerDay: number(1, 16), mealBreakMinutes: number(0, 240), graceMinutes: number(0, 120), approvedLocation: text, latitude: number(-90, 90), longitude: number(-180, 180), radiusMeters: number(1, 100000), arrangement: choice(arrangements), paidFrom: choice(['actual', 'schedule']), policy: text, daySchedules: z.array(daySchedule).max(7).default([]) }).strict().refine(v => (v.latitude === null) === (v.longitude === null), 'Enter both GPS coordinates.').refine(v => new Set(v.daySchedules.map(s => s.day)).size === v.daySchedules.length, 'Duplicate day schedule.'),
  payroll: z.object({ basis: choice(['monthly', 'daily']), dailyRate: number(0.01, 1e9), hourlyRate: number(0.01, 1e9), frequency: choice(['monthly', 'semi-monthly']), schedule: text, status: z.enum(['Active', 'Hold']).default('Active') }).strict(),
  bank: z.object({ name: text, accountName: text, accountNumber: text }).strict(),
  // Monthly overrides of the calculated government shares for one employee; blank uses the rules table.
  contributions: z.object({ sssEmployee: number(0, 1e6), sssEmployer: number(0, 1e6), sssEc: number(0, 1e6), philHealthEmployee: number(0, 1e6), philHealthEmployer: number(0, 1e6), pagIbigEmployee: number(0, 1e6), pagIbigEmployer: number(0, 1e6), reason: text }).strict().refine(v => Object.entries(v).every(([k, x]) => k === 'reason' || x === null) || v.reason.length >= 3, 'Give a reason for overriding contributions.'),
  leave: z.object({ entitlements: z.array(z.object({ typeId: z.string().min(1).max(80), annualDays: z.number().min(0).max(366), effectiveYear: z.number().int().min(2000).max(2200) }).strict()).max(200), remarks: text }).strict().refine(v => new Set(v.entitlements.map(e => `${e.typeId}:${e.effectiveYear}`)).size === v.entitlements.length, 'Duplicate leave type and year.'),
};
const hr = ['admin', 'hr'], finance = ['admin', 'hr', 'payroll'];
const privateRead = { personal: hr, government: finance, emergency: hr, bank: finance, contributions: finance };
export function canReadSection(actor, section) { return !privateRead[section] || privateRead[section].includes(actor.role); }
export function canWriteSection(actor, section) { return (section === 'contributions' ? finance : ['payroll', 'bank'].includes(section) ? ['admin', 'payroll'] : hr).includes(actor.role); }
function findEmployee(store, id) { const e = store.read().employees.find(e => e.id === id); if (!e) throw new AppError('Employee not found.', 404); return e; }
function personalName(employee) {
  const parts = employee.name.split(',');
  const first = parts.length > 1 ? parts.slice(1).join(',').trim() : employee.name;
  const middle = first.match(/\s([A-Z]\.)$/)?.[1] || '';
  return { firstName: middle ? first.slice(0, -middle.length).trim() : first, lastName: parts.length > 1 ? parts[0].trim() : '', middleName: middle, suffix: '' };
}
export function localToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()); }
function monthsBetween(start, end) {
  if (!start || start > end) return 0;
  const a = new Date(start), b = new Date(end);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0));
}
function anniversary(start, year) {
  const month = Number(start.slice(5, 7)), day = Math.min(Number(start.slice(8)), new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function derivedInformation(e, personal = {}, asOf = localToday()) {
  const serviceMonths = e.startDate ? monthsBetween(e.startDate, e.endDate && e.endDate < asOf ? e.endDate : asOf) : null;
  let nextAnniversary = null;
  if (e.startDate && (!e.endDate || e.endDate >= asOf)) {
    let year = Math.max(Number(asOf.slice(0, 4)), Number(e.startDate.slice(0, 4)) + 1);
    if (anniversary(e.startDate, year) < asOf) year++;
    nextAnniversary = anniversary(e.startDate, year);
  }
  return { age: personal.birthDate ? Math.floor(monthsBetween(personal.birthDate, asOf) / 12) : null, serviceMonths, serviceYears: serviceMonths === null ? null : Math.floor(serviceMonths / 12), nextAnniversary };
}
export function saveProfile(store, actor, id, section, input) {
  if (!Object.hasOwn(profileSchemas, section)) throw new AppError('Unknown profile section.', 404);
  if (!canWriteSection(actor, section)) throw new AppError('You cannot edit this profile section.', 403);
  const value = profileSchemas[section].parse(input);
  return store.transaction(() => {
    const employee = findEmployee(store, id), state = store.read();
    if (section === 'personal' && value.birthDate > localToday()) throw new AppError('Birth date cannot be in the future.');
    if (section === 'employment' && value.regularizationDate && employee.startDate && value.regularizationDate < employee.startDate) throw new AppError('Regularization precedes joining date.');
    if (section === 'leave' && value.entitlements.some(e => !state.leaveTypes.some(t => t.id === e.typeId))) throw new AppError('Unknown leave type.');
    const old = store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section);
    const master = state.employees.find(e => e.id === id), previousMaster = structuredClone(master);
    if (section === 'personal') {
      const given = [value.firstName, value.middleName, value.suffix].filter(Boolean).join(' ');
      const name = [value.lastName, given].filter(Boolean).join(', ');
      if (!name || name.length > 1000) throw new AppError('Enter an employee name (maximum 1,000 characters).');
      master.name = name;
    }
    if (section === 'employment' && value.employeeStatus) master.active = !master.draft && ['Active', 'On Leave'].includes(value.employeeStatus);
    store.db.prepare('INSERT INTO employee_profiles VALUES(?,?,?) ON CONFLICT(employee_id,section) DO UPDATE SET data=excluded.data').run(id, section, JSON.stringify(value));
    if (section === 'leave') {
      const updated = store.read();
      for (const item of value.entitlements) {
        const type = state.leaveTypes.find(t => t.id === item.typeId);
        const balance = leaveBalance(updated, employee, type, `${item.effectiveYear}-12-31`);
        if (type.balanceRequired && balance.used > balance.entitled + balance.carry) throw new AppError('This entitlement is below leave already approved for that year.');
      }
    }
    state.version++; store.write(state);
    if (JSON.stringify(master) !== JSON.stringify(previousMaster)) store.log(actor, 'update', 'employees', id, previousMaster, master);
    store.log(actor, 'update', `profile:${section}`, id, old ? JSON.parse(old.data) : null, value);
    return value;
  });
}
export const documentTypes = ['Photo', 'Employment Contract', 'Government ID', 'Resume/CV', 'Birth Certificate', 'Tax', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Company ID', 'Medical', 'Leave Supporting', 'Disciplinary', 'Other HR'];
function canReadDocument(actor, type) { return type === 'Photo' || (['Medical', 'Disciplinary', 'Leave Supporting', 'Other HR', 'Birth Certificate', 'Resume/CV'].includes(type) ? hr : finance).includes(actor.role); }
const uploadSchema = z.object({ type: z.enum(documentTypes), name: z.string().trim().min(1).max(180).refine(v => !/[\x00-\x1f\\/]/.test(v), 'Invalid filename'), mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']), data: z.string().min(1).max(7000000).regex(/^[A-Za-z0-9+/]*={0,2}$/), expiry: optionalDate, remarks: text }).strict();
export function uploadDocument(store, actor, id, input) {
  if (actor.role === 'employee') { if (id !== actor.employeeId || input.type !== 'Leave Supporting') throw new AppError('You may upload supporting documents only for yourself.', 403); }
  else permit(actor, hr);
  findEmployee(store, id);
  const value = uploadSchema.parse(input), bytes = Buffer.from(value.data, 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new AppError('Choose a file up to 5 MB.');
  const valid = value.mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : value.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid || (value.type === 'Photo' && value.mime === 'application/pdf')) throw new AppError('File content must match its PDF, PNG or JPEG type. Photos must be images.');
  const metadata = { id: randomUUID(), employeeId: id, type: value.type, name: value.name, mime: value.mime, size: bytes.length, uploadedAt: new Date().toISOString(), uploadedBy: actor.username, expiry: value.expiry, status: 'Active', remarks: value.remarks };
  return store.transaction(() => {
    store.db.prepare('INSERT INTO employee_documents VALUES(?,?,?,?)').run(metadata.id, id, JSON.stringify(metadata), bytes);
    store.log(actor, 'upload', `document:${value.type}`, id, null, metadata); return metadata;
  });
}
export function getDocument(store, actor, id) {
  const row = store.db.prepare('SELECT * FROM employee_documents WHERE id=?').get(id);
  if (!row) throw new AppError('Document not found.', 404);
  const metadata = JSON.parse(row.metadata);
  const ownUpload = actor.role === 'employee' && actor.employeeId === metadata.employeeId && actor.username === metadata.uploadedBy && metadata.type === 'Leave Supporting';
  if (actor.role === 'employee' ? !ownUpload : !canReadDocument(actor, metadata.type)) throw new AppError('This document is restricted.', 403);
  return { ...metadata, content: row.content };
}
export function updateDocument(store, actor, id, input) {
  permit(actor, hr);
  const value = z.object({ expiry: optionalDate, remarks: text, status: z.enum(['Active', 'Archived']) }).strict().parse(input);
  return store.transaction(() => {
    const before = getDocument(store, actor, id); delete before.content;
    const after = { ...before, ...value };
    store.db.prepare('UPDATE employee_documents SET metadata=? WHERE id=?').run(JSON.stringify(after), id);
    store.log(actor, 'update', `document:${before.type}`, before.employeeId, before, after); return after;
  });
}
export function visibleAudit(store, actor) {
  return store.audit().filter(a => ['clock', 'explanations', 'attendance-correction'].includes(a.kind) ? hr.includes(actor.role) : a.kind.startsWith('profile:') ? canReadSection(actor, a.kind.slice(8)) : a.kind.startsWith('document:') ? canReadDocument(actor, a.kind.slice(9)) : true);
}
export function getProfile(store, actor, id) {
  const employee = findEmployee(store, id), state = store.read(), sections = {};
  for (const row of store.db.prepare('SELECT section,data FROM employee_profiles WHERE employee_id=?').all(id)) if (canReadSection(actor, row.section)) sections[row.section] = JSON.parse(row.data);
  if (canReadSection(actor, 'personal') && !sections.personal) sections.personal = personalName(employee);
  const documents = store.db.prepare('SELECT metadata FROM employee_documents WHERE employee_id=?').all(id).map(r => JSON.parse(r.metadata)).filter(d => canReadDocument(actor, d.type)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const rule = ruleOn(state, localToday()), dailyRate = sections.payroll?.dailyRate ?? (rule && employee.monthlySalary ? employee.monthlySalary / rule.dailyDivisor : null);
  return { employee, sections, derived: { ...derivedInformation(employee, sections.personal), dailyRate, hourlyRate: sections.payroll?.hourlyRate ?? (dailyRate && rule ? dailyRate / rule.hourlyDivisor : null) }, documents,
    editable: Object.keys(profileSchemas).filter(s => canWriteSection(actor, s)), readable: Object.keys(profileSchemas).filter(s => canReadSection(actor, s)),
    balances: state.leaveTypes.map(t => ({ typeId: t.id, name: t.name, eligible: employee.leaveEligibility.includes(t.id) && !employee.draft && !!employee.startDate && monthsBetween(employee.startDate, localToday()) >= t.minServiceMonths, ...leaveBalance(state, employee, t, localToday()) })),
    attendance: state.attendance.filter(a => a.employeeId === id), leaves: state.leaves.filter(a => a.employeeId === id), loans: state.loans.filter(a => a.employeeId === id), adjustments: state.adjustments.filter(a => a.employeeId === id),
    payroll: state.runs.filter(r => r.rows.some(row => row.employeeId === id)).map(r => ({ id: r.id, start: r.start, end: r.end, row: r.rows.find(row => row.employeeId === id) })),
    audit: visibleAudit(store, actor).filter(a => a.recordId === id || a.after?.employeeId === id || a.before?.employeeId === id) };
}
