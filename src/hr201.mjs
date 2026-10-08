// HR 201 core: company settings, employee numbers, the 201 employee form, archiving, the scoped directory and
// the dashboard figures. Builds on the existing employee master (state.employees) and profile sections.
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { saveProfile, localToday } from './profiles.mjs';
import { HR_MANAGERS, HR_TEAM, DIRECTORY, DASHBOARD, SENSITIVE_IDS } from './roles.mjs';
import { personalNames, titleCase } from './names.mjs';
import { leaveBalance } from './engine.mjs';
import { assertMakerCanChange, lockedFields } from './field-locks.mjs';
import { scheduleOf, applyScheduleFromForm } from './work-schedule.mjs';

// ---------- Settings ----------
// Documents the company prepares and files itself; employees are not asked to upload them.
// Satisfied by the number on file in Government IDs; no proof file is required.
export const NUMBER_REQUIREMENTS = { tin: { field: 'tin', name: 'TIN number' }, sss: { field: 'sss', name: 'SSS number' }, philhealth: { field: 'philHealth', name: 'PhilHealth number' }, pagibig: { field: 'pagIbig', name: 'Pag-IBIG MID number' } };
export const COMPANY_DOCUMENTS = ['contract', 'job-description', 'onboarding', 'evaluation', 'training-cert', 'separation'];
export const DEFAULT_REQUIREMENTS = [
  ['resume', 'Résumé / CV', 'Application documents', true, false, false],
  ['contract', 'Employment contract', 'Employment', true, false, false],
  ['job-description', 'Job description', 'Employment', true, false, false],
  ['onboarding', 'Onboarding acknowledgement (handbook and policies)', 'Onboarding', true, false, false],
  ['valid-id', 'Government-issued ID', 'Identification', true, true, false],
  ['tin', 'TIN number', 'Government registration', true, false, false],
  ['sss', 'SSS number', 'Government registration', true, false, false],
  ['philhealth', 'PhilHealth number', 'Government registration', true, false, false],
  ['pagibig', 'Pag-IBIG MID number', 'Government registration', true, false, false],
  ['nbi', 'NBI clearance', 'Pre-employment', true, true, false],
  ['medical', 'Pre-employment medical certificate', 'Medical', false, true, true],
  ['evaluation', 'Performance evaluation', 'Performance', false, false, false],
  ['training-cert', 'Training certificates', 'Training', false, false, false],
  ['separation', 'Separation documents (clearance, COE)', 'Separation', false, false, false],
].map(([id, name, category, required, expires, restricted]) => ({ id, name, category, required, expires, restricted, providedBy: COMPANY_DOCUMENTS.includes(id) ? 'company' : 'employee', departments: [], classifications: [], dueDays: { resume: 0, contract: 7, 'job-description': 7, onboarding: 14, 'valid-id': 14, nbi: 30, tin: 30, sss: 30, philhealth: 30, pagibig: 30 }[id] ?? null }));

const text = (max = 200) => z.string().trim().max(max);
const requirementSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,60}$/), name: text().min(1), category: text(80).min(1), required: z.boolean(), expires: z.boolean(), restricted: z.boolean(), providedBy: z.enum(['employee', 'company']).default('employee'), departments: z.array(text(120)).max(100), classifications: z.array(text(60)).max(30), dueDays: z.number().int().min(0).max(365).nullable().default(null) }).strict();
export const settingsSchema = z.object({
  company: z.object({ name: text(120).min(1), systemTitle: text(120).min(1), theme: z.enum(['forest', 'gds']), sssEmployerNo: text(40).default(''), philhealthEmployerNo: text(40).default(''), pagibigEmployerNo: text(40).default(''), egovFee: z.number().min(0).max(10000).default(15) }).strict(),
  departments: z.array(text(120).min(1)).max(200),
  positions: z.array(text(120).min(1)).max(500),
  classifications: z.array(text(60).min(1)).min(1).max(30),
  idFormat: z.object({ prefix: z.string().regex(/^[A-Z0-9]{0,10}$/), includeYear: z.boolean(), digits: z.number().int().min(3).max(8) }).strict(),
  uploads: z.object({ photoMB: z.number().min(0.5).max(10), documentMB: z.number().min(1).max(20) }).strict(),
  reminders: z.object({ probationDays: z.number().int().min(0).max(180), reviewDays: z.number().int().min(0).max(180), expiryDays: z.number().int().min(0).max(365), memoDays: z.number().int().min(0).max(60) }).strict(),
  optionalFields: z.object({ birthPlace: z.boolean(), civilStatus: z.boolean(), bloodType: z.boolean() }).strict(),
  documentRequirements: z.array(requirementSchema).max(200),
  retention: z.object({ archivedYears: z.number().int().min(1).max(50) }).strict(),
  celebrations: z.object({ leapDay: z.enum(['feb28', 'mar1']) }).strict().default({ leapDay: 'feb28' }),
}).strict();

function defaults(state) {
  return {
    company: { name: 'GDS CAPITAL INC.', systemTitle: 'HR 201 File & Employee Management System', theme: 'gds', sssEmployerNo: '80017223883000', philhealthEmployerNo: '2010012089', pagibigEmployerNo: '209939490004', egovFee: 15 },
    departments: [...new Set(state.employees.map(e => e.department).filter(Boolean))].sort(),
    positions: [],
    classifications: ['Probationary', 'Regular', 'Project-Based', 'Fixed-Term', 'Contractual', 'Seasonal'],
    idFormat: { prefix: 'EMP', includeYear: true, digits: 4 },
    uploads: { photoMB: 2, documentMB: 5 },
    reminders: { probationDays: 14, reviewDays: 14, expiryDays: 30, memoDays: 3 },
    optionalFields: { birthPlace: true, civilStatus: true, bloodType: false },
    documentRequirements: DEFAULT_REQUIREMENTS,
    retention: { archivedYears: 5 },
    celebrations: { leapDay: 'feb28' },
  };
}
export function readSettings(store) {
  const row = store.db.prepare('SELECT data FROM hr_settings WHERE id=1').get();
  const base = defaults(store.read());
  if (!row) {
    const positions = store.db.prepare("SELECT data FROM employee_profiles WHERE section='employment'").all().map(r => JSON.parse(r.data).position).filter(Boolean);
    return { ...base, positions: [...new Set(positions)].sort() };
  }
  const saved = JSON.parse(row.data);
  // Settings saved before "provided by" existed: company-issued documents default to the company.
  // Government registrations need only the number (October 2026): the default proof names become number names.
  const OLD_NAMES = { tin: 'TIN proof of registration', sss: 'SSS number proof (E-1 / ID)', philhealth: 'PhilHealth MDR / ID', pagibig: 'Pag-IBIG MID proof' };
  if (saved.documentRequirements) saved.documentRequirements = saved.documentRequirements.map(r => ({ ...r, name: OLD_NAMES[r.id] === r.name ? NUMBER_REQUIREMENTS[r.id].name : r.name, providedBy: r.providedBy || (COMPANY_DOCUMENTS.includes(r.id) ? 'company' : 'employee') }));
  return { ...base, ...saved, company: { ...base.company, ...saved.company }, reminders: { ...base.reminders, ...saved.reminders } };
}
export function saveSettings(store, actor, input) {
  permit(actor, ['admin']);
  const value = settingsSchema.parse(input);
  if (new Set(value.documentRequirements.map(r => r.id)).size !== value.documentRequirements.length) throw new AppError('Each document requirement needs a unique ID.');
  return store.transaction(() => {
    const before = readSettings(store);
    store.db.prepare('INSERT INTO hr_settings(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(value));
    store.log(actor, 'update', 'settings', 'hr', before, value);
    return value;
  });
}
// Branding is public so the sign-in page can use it.
export const publicBranding = store => { const s = readSettings(store); return { name: s.company.name, systemTitle: s.company.systemTitle, theme: s.company.theme }; };

// ---------- Employee numbers ----------
// Allocated inside a write transaction, so two simultaneous submissions can never receive the same number.
export function nextEmployeeNumber(store, date = localToday()) {
  const { idFormat } = readSettings(store), year = date.slice(0, 4);
  const stem = [idFormat.prefix, idFormat.includeYear ? year : ''].filter(Boolean).join('-');
  const key = `seq:${stem}`, taken = new Set(store.read().employees.flatMap(e => [e.id, e.employeeNumber].filter(Boolean).map(v => v.toUpperCase())));
  let n = store.db.prepare('SELECT value FROM hr_counters WHERE key=?').get(key)?.value || 0, candidate;
  do { n++; candidate = `${stem ? `${stem}-` : ''}${String(n).padStart(idFormat.digits, '0')}`; } while (taken.has(candidate.toUpperCase()));
  store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, n);
  return candidate;
}

// ---------- Scope ----------
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
// Department managers see only their own department; everyone else in DIRECTORY sees all employees.
export function scopeEmployees(store, actor, employees = store.read().employees) {
  permit(actor, DIRECTORY);
  if (actor.role !== 'dept_manager') return employees;
  const own = employees.find(e => e.id === actor.employeeId);
  return own?.department ? employees.filter(e => e.department === own.department) : employees.filter(e => e.id === actor.employeeId);
}
export function assertCanView(store, actor, employeeId) {
  if (actor.role === 'employee') { if (actor.employeeId !== employeeId) throw new AppError('You can only open your own record.', 403); return; }
  if (!scopeEmployees(store, actor).some(e => e.id === employeeId)) throw new AppError('This employee is outside your assigned team.', 403);
}

// ---------- Directory ----------
export const displayNumber = e => e.employeeNumber || e.id;
export function activity(e, employment = {}) {
  if (e.archived) return 'Archived';
  const status = employment.employeeStatus || (e.active ? 'Active' : '');
  return ['Active', 'On Leave'].includes(status) || (!status && !e.endDate) ? 'Active' : 'Inactive';
}
export function directory(store, actor) {
  const people = scopeEmployees(store, actor);
  return people.map(e => {
    const job = profileOf(store, e.id, 'employment'), personal = profileOf(store, e.id, 'personal');
    return { id: e.id, schedule: scheduleOf(store, e).text, number: displayNumber(e), name: e.name, department: e.department, position: job.position || '', classification: job.employmentStatus || '', status: activity(e, job), employeeStatus: job.employeeStatus || '', dateHired: e.startDate, workEmail: job.businessEmail || '', supervisor: job.supervisor || '', probationEnd: job.probationEnd || '', reviewDate: job.reviewDate || '', archived: !!e.archived, draft: !!e.draft, ...(HR_TEAM.includes(actor.role) ? { personalEmail: personal.personalEmail || '' } : {}) };
  });
}

// ---------- 201 employee form ----------
const optionalDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default('');
const field = (max = 200) => z.string().trim().max(max).default('');
export const employeeFormSchema = z.object({
  personal: z.object({ firstName: field(120).pipe(z.string().min(1, 'First name is required.')), middleName: field(120), lastName: field(120).pipe(z.string().min(1, 'Last name is required.')), suffix: field(20), preferredName: field(120), sex: z.enum(['', 'Female', 'Male', 'Other']).default(''), birthDate: optionalDate, birthPlace: field(200), civilStatus: field(40), bloodType: field(5), nationality: field(80) }).strict(),
  contact: z.object({ workEmail: field(200), personalEmail: field(200), mobile: field(40), currentAddress: field(500), permanentAddress: field(500) }).strict(),
  emergency: z.object({ name: field(200), relationship: field(80), contact: field(40) }).strict(),
  employment: z.object({ dateHired: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date hired is required.'), department: field(120).pipe(z.string().min(1, 'Department is required.')), position: field(120).pipe(z.string().min(1, 'Position is required.')), supervisor: field(200), workLocation: field(200), status: z.enum(['Active', 'Inactive', 'On Leave']).default('Active'), classification: field(60).pipe(z.string().min(1, 'Employment classification is required.')), contractStart: optionalDate, contractEnd: optionalDate, probationEnd: optionalDate, reviewDate: optionalDate, employmentType: z.enum(['', 'Full-Time', 'Part-Time', 'Other']).default(''), jobLevel: field(40) }).strict(),
  government: z.object({ tin: field(30), sss: field(30), philHealth: field(30), pagIbig: field(30) }).strict().default({ tin: '', sss: '', philHealth: '', pagIbig: '' }),
  employeeNumber: field(40),
  schedule: z.object({ start: field(5), end: field(5), hoursPerDay: z.union([z.string(), z.number()]).default(''), mealBreakMinutes: z.union([z.string(), z.number()]).default(''), restDays: z.array(z.coerce.number()).max(6).default([]), arrangement: field(10) }).partial().optional(),
  confirmDuplicate: z.boolean().default(false),
}).strict();
const emailOk = v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
function validateForm(v, settings) {
  const errors = [];
  if (!emailOk(v.contact.workEmail)) errors.push('Work email is not a valid email address.');
  if (!emailOk(v.contact.personalEmail)) errors.push('Personal email is not a valid email address.');
  if (v.personal.birthDate && v.personal.birthDate > localToday()) errors.push('Date of birth cannot be in the future.');
  if (v.contact.mobile && !/^[+\d][\d\s-]{6,19}$/.test(v.contact.mobile)) errors.push('Mobile number should contain digits only (e.g. 09171234567).');
  if (v.employment.contractEnd && v.employment.contractStart && v.employment.contractEnd < v.employment.contractStart) errors.push('Contract end is before contract start.');
  for (const k of ['probationEnd', 'reviewDate']) if (v.employment[k] && v.employment[k] < v.employment.dateHired) errors.push(`${k === 'probationEnd' ? 'Probation end' : 'Review date'} is before the date hired.`);
  if (!settings.classifications.includes(v.employment.classification)) errors.push('Choose an employment classification from Settings.');
  if (errors.length) throw new AppError(errors.join(' '));
}
const fullName = p => [p.lastName, [p.firstName, p.middleName, p.suffix].filter(Boolean).join(' ')].filter(Boolean).join(', ');
// Possible duplicates: same name, same birth date with similar name, or the same email.
export function duplicateCandidates(store, form, exceptId = '') {
  const name = fullName(form.personal).toLowerCase(), emails = [form.contact.workEmail, form.contact.personalEmail].filter(Boolean).map(s => s.toLowerCase());
  return store.read().employees.filter(e => e.id !== exceptId).filter(e => {
    const personal = profileOf(store, e.id, 'personal'), job = profileOf(store, e.id, 'employment');
    return e.name.toLowerCase() === name
      || (form.personal.birthDate && personal.birthDate === form.personal.birthDate && (personal.lastName || '').toLowerCase() === form.personal.lastName.toLowerCase())
      || emails.some(m => [job.businessEmail, personal.personalEmail].filter(Boolean).map(s => s.toLowerCase()).includes(m));
  }).map(e => ({ id: e.id, number: displayNumber(e), name: e.name, department: e.department }));
}
function writeSections(store, actor, id, v, existing = {}) {
  saveProfile(store, actor, id, 'personal', { ...existing.personal, lastName: v.personal.lastName, firstName: v.personal.firstName, middleName: v.personal.middleName, suffix: v.personal.suffix, sex: v.personal.sex, birthDate: v.personal.birthDate, civilStatus: v.personal.civilStatus, nationality: v.personal.nationality, mobile: v.contact.mobile, personalEmail: v.contact.personalEmail, address: v.contact.currentAddress, preferredName: v.personal.preferredName, birthPlace: v.personal.birthPlace, bloodType: v.personal.bloodType, permanentAddress: v.contact.permanentAddress });
  saveProfile(store, actor, id, 'employment', { ...existing.employment, position: v.employment.position, employmentStatus: v.employment.classification, supervisor: v.employment.supervisor, workLocation: v.employment.workLocation, businessEmail: v.contact.workEmail, employeeStatus: v.employment.status, contractStart: v.employment.contractStart, contractEnd: v.employment.contractEnd, probationEnd: v.employment.probationEnd, reviewDate: v.employment.reviewDate, employmentType: v.employment.employmentType, jobLevel: v.employment.jobLevel });
  saveProfile(store, actor, id, 'emergency', { ...existing.emergency, name: v.emergency.name, relationship: v.emergency.relationship, contact: v.emergency.contact });
  // Government numbers: only HR Managers, Admins and Makers write them, and masked values (••••) never overwrite stored ones.
  const ids = Object.fromEntries(Object.entries(v.government).filter(([, x]) => x && !x.includes('•')));
  if ([...HR_MANAGERS, 'maker'].includes(actor.role) && Object.keys(ids).length) saveProfile(store, actor, id, 'government', { ...existing.government, ...ids });
}
export function createEmployee(store, actor, input) {
  permit(actor, HR_TEAM);
  const parsed = employeeFormSchema.parse(input), v = { ...parsed, personal: personalNames(parsed.personal), emergency: { ...parsed.emergency, name: titleCase(parsed.emergency.name) } }, settings = readSettings(store);
  validateForm(v, settings);
  return store.transaction(() => {
    const duplicates = duplicateCandidates(store, v);
    if (duplicates.length && !v.confirmDuplicate) return { duplicates, created: null };
    const id = nextEmployeeNumber(store, v.employment.dateHired);
    saveRecord(store, actor, 'employees', { id, name: fullName(v.personal), draft: true, department: v.employment.department, monthlySalary: null, startDate: v.employment.dateHired, endDate: '', active: false, restDays: [0], scheduleStart: '', coveredOT: false, coveredNSD: false, coveredHoliday: false, covered13th: false, leaveEligibility: [], employeeNumber: v.employeeNumber, archived: false }, { trusted: true });
    writeSections(store, actor, id, v);
    applyScheduleFromForm(store, actor, id, v.schedule);
    return { duplicates: [], created: { id, number: v.employeeNumber || id, name: fullName(v.personal) } };
  });
}
export function updateEmployee(store, actor, id, input) {
  permit(actor, HR_TEAM);
  const parsed = employeeFormSchema.parse(input), v = { ...parsed, personal: personalNames(parsed.personal), emergency: { ...parsed.emergency, name: titleCase(parsed.emergency.name) } }, settings = readSettings(store);
  validateForm(v, settings);
  return store.transaction(() => {
    const state = store.read(), master = state.employees.find(e => e.id === id);
    if (!master) throw new AppError('Employee not found.', 404);
    if (v.employeeNumber && state.employees.some(e => e.id !== id && [e.id, e.employeeNumber].includes(v.employeeNumber))) throw new AppError('That employee number is already used.');
    assertMakerCanChange(store, actor, id, v);
    const existing = Object.fromEntries(['personal', 'employment', 'emergency', 'government'].map(s => [s, profileOf(store, id, s)]));
    if (master.department !== v.employment.department || master.startDate !== v.employment.dateHired || (master.employeeNumber || '') !== v.employeeNumber) {
      saveRecord(store, actor, 'employees', { ...master, department: v.employment.department, startDate: v.employment.dateHired, employeeNumber: v.employeeNumber }, { trusted: true });
    }
    writeSections(store, actor, id, v, existing);
    applyScheduleFromForm(store, actor, id, v.schedule);
    return { id };
  });
}
// The 201 form view of one employee (sensitive identifiers masked unless authorised).
export function employeeForm(store, actor, id) {
  assertCanView(store, actor, id);
  const e = store.read().employees.find(x => x.id === id);
  if (!e) throw new AppError('Employee not found.', 404);
  const p = profileOf(store, id, 'personal'), j = profileOf(store, id, 'employment'), m = profileOf(store, id, 'emergency'), g = profileOf(store, id, 'government');
  // Employees see their own numbers in full; other roles without ID access see them masked.
  const own = actor.role === 'employee' && actor.employeeId === id;
  const showIds = SENSITIVE_IDS.includes(actor.role) || own, mask = v => (v ? (showIds ? v : `•••• ${String(v).slice(-3)}`) : '');
  const hrView = HR_TEAM.includes(actor.role) || (actor.role === 'employee' && actor.employeeId === id);   // employees: their own record only
  return {
    id, schedule: scheduleOf(store, e), locked: actor.role === 'maker' ? lockedFields(store, id) : [], number: displayNumber(e), name: e.name, draft: e.archived ? false : !!e.draft, archived: !!e.archived, activity: activity(e, j), canEdit: HR_TEAM.includes(actor.role), sensitiveIds: showIds,
    form: {
      employeeNumber: e.employeeNumber || '',
      schedule: (({ start, end, hoursPerDay, mealBreakMinutes, restDays, arrangement }) => ({ start, end, hoursPerDay: hoursPerDay ?? '', mealBreakMinutes: mealBreakMinutes ?? '', restDays, arrangement }))(scheduleOf(store, e)),
      personal: { firstName: p.firstName || '', middleName: p.middleName || '', lastName: p.lastName || '', suffix: p.suffix || '', preferredName: p.preferredName || '', sex: hrView ? p.sex || '' : '', birthDate: hrView ? p.birthDate || '' : '', birthPlace: hrView ? p.birthPlace || '' : '', civilStatus: hrView ? p.civilStatus || '' : '', bloodType: HR_MANAGERS.includes(actor.role) ? p.bloodType || '' : '', nationality: hrView ? p.nationality || '' : '' },
      contact: { workEmail: j.businessEmail || '', personalEmail: hrView ? p.personalEmail || '' : '', mobile: hrView ? p.mobile || '' : '', currentAddress: hrView ? p.address || '' : '', permanentAddress: hrView ? p.permanentAddress || '' : '' },
      emergency: hrView ? { name: m.name || '', relationship: m.relationship || '', contact: m.contact || '' } : { name: '', relationship: '', contact: '' },
      employment: { dateHired: e.startDate || '', department: e.department || '', position: j.position || '', supervisor: j.supervisor || '', workLocation: j.workLocation || '', status: ['Active', 'Inactive', 'On Leave'].includes(j.employeeStatus) ? j.employeeStatus : activity(e, j) === 'Active' ? 'Active' : 'Inactive', classification: j.employmentStatus || '', contractStart: j.contractStart || '', contractEnd: j.contractEnd || '', probationEnd: j.probationEnd || '', reviewDate: j.reviewDate || '', employmentType: j.employmentType || '', jobLevel: j.jobLevel || '' },
      government: { tin: mask(g.tin), sss: mask(g.sss), philHealth: mask(g.philHealth), pagIbig: mask(g.pagIbig) },
    },
  };
}
// Extra profile tabs: family, education, previous employment and (for pay roles) compensation.
const PAY_ROLES = ['admin', 'hr', 'payroll'];
export function profileExtras(store, actor, id) {
  assertCanView(store, actor, id);
  const e = store.read().employees.find(x => x.id === id);
  if (!e) throw new AppError('Employee not found.', 404);
  const hrView = HR_TEAM.includes(actor.role), pay = profileOf(store, id, 'payroll');
  return {
    family: hrView ? { spouse: { name: '', occupation: '', contact: '' }, father: { name: '', occupation: '' }, mother: { name: '', occupation: '' }, children: [], ...profileOf(store, id, 'family') } : null,
    education: hrView ? { entries: [], ...profileOf(store, id, 'education') } : null,
    history: hrView ? { entries: [], ...profileOf(store, id, 'history') } : null,
    compensation: PAY_ROLES.includes(actor.role) ? { monthlySalary: e.monthlySalary, basis: pay.basis || 'monthly', dailyRate: pay.dailyRate ?? null, hourlyRate: pay.hourlyRate ?? null, frequency: pay.frequency || '', status: pay.status || 'Active', withholdingTax: pay.withholdingTax === 'exempt' ? 'exempt' : 'withhold', coveredOT: e.coveredOT, coveredNSD: e.coveredNSD, coveredHoliday: e.coveredHoliday, covered13th: e.covered13th, deductions: (store.read().deductions || []).filter(d => d.employeeId === id && d.active).map(d => ({ name: d.name, amount: d.amount, schedule: d.schedule })) } : null,
    canEdit: hrView, canEditPay: ['admin', 'hr'].includes(actor.role),
  };
}
export function saveProfileSection(store, actor, id, section, input) {
  permit(actor, HR_TEAM);
  if (!['family', 'education', 'history'].includes(section)) throw new AppError('Unknown section.', 404);
  assertCanView(store, actor, id);
  return saveProfile(store, actor, id, section, input);
}
export function archiveEmployee(store, actor, id, input) {
  permit(actor, HR_MANAGERS);
  const { reason, endDate } = z.object({ reason: z.string().trim().min(3, 'Give a reason for archiving.').max(500), endDate: optionalDate }).strict().parse(input);
  return store.transaction(() => {
    const master = store.read().employees.find(e => e.id === id);
    if (!master) throw new AppError('Employee not found.', 404);
    const end = master.endDate || endDate || localToday();
    saveRecord(store, actor, 'employees', { ...master, archived: true, active: false, endDate: master.startDate && end < master.startDate ? master.startDate : end }, { trusted: true });
    const job = profileOf(store, id, 'employment');
    if (job.position) saveProfile(store, actor, id, 'employment', { ...job, employeeStatus: 'Inactive' });
    store.log(actor, 'archive', 'employees', id, null, { reason, endDate: end });
    return { id, archived: true };
  });
}
export function restoreEmployee(store, actor, id) {
  permit(actor, HR_MANAGERS);
  return store.transaction(() => {
    const master = store.read().employees.find(e => e.id === id);
    if (!master) throw new AppError('Employee not found.', 404);
    saveRecord(store, actor, 'employees', { ...master, archived: false }, { trusted: true });
    store.log(actor, 'restore', 'employees', id, null, null);
    return { id, archived: false };
  });
}

// ---------- Dashboard ----------
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
export function dashboard(store, actor, extras = {}) {
  permit(actor, DASHBOARD);
  const today = localToday(), settings = readSettings(store), people = directory(store, actor).filter(p => !p.archived);
  // Every department / company set up in Settings (even with no employees yet), plus any in use, with head counts.
  const counted = people.reduce((m, p) => ({ ...m, [p.department || 'Unassigned']: (m[p.department || 'Unassigned'] || 0) + 1 }), {});
  for (const d of settings.departments || []) counted[d] = counted[d] || 0;
  const byDept = Object.entries(counted).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const byClass = Object.entries(people.reduce((m, p) => ({ ...m, [p.classification || 'Not set']: (m[p.classification || 'Not set'] || 0) + 1 }), {}));
  const upcoming = (field, days) => people.filter(p => p.status === 'Active' && p[field] && p[field] >= today && p[field] <= addDays(today, days)).map(p => ({ id: p.id, name: p.name, date: p[field] }));
  return {
    asOf: today,
    totals: { total: people.length, active: people.filter(p => p.status === 'Active').length, inactive: people.filter(p => p.status !== 'Active').length, newHires: people.filter(p => p.dateHired && p.dateHired >= addDays(today, -30) && p.dateHired <= today).length, departments: byDept.filter(([d]) => d !== 'Unassigned').length, archived: directory(store, actor).filter(p => p.archived).length, ...extras.totals },
    departments: byDept.map(([name, count]) => ({ name, count })),
    classifications: byClass.map(([name, count]) => ({ name, count })),
    recent: [...people].sort((a, b) => (b.dateHired || '').localeCompare(a.dateHired || '')).slice(0, 6),
    probationDue: upcoming('probationEnd', settings.reminders.probationDays), reviewsDue: upcoming('reviewDate', settings.reminders.reviewDays),
    ...extras.sections,
  };
}

// ---------- Leave credits (201 file) ----------
// HR types an employee's leave credits for a year and any days already used before the system; the balance shown
// to the employee and used for approvals is computed from these together with leave approved in the system.
const LEAVE_EDITORS = ['admin', 'hr', 'maker'];
export function leaveCredits(store, actor, id, year = Number(localToday().slice(0, 4))) {
  permit(actor, [...LEAVE_EDITORS, 'hr_staff', 'payroll', 'viewer']);
  assertCanView(store, actor, id);
  const state = store.read(), e = state.employees.find(x => x.id === id);
  if (!e) throw new AppError('Employee not found.', 404);
  const asOf = year === Number(localToday().slice(0, 4)) ? localToday() : `${year}-12-31`;
  const entries = profileOf(store, id, 'leave').entitlements || [];
  return {
    year, canEdit: LEAVE_EDITORS.includes(actor.role),
    types: state.leaveTypes.filter(t => t.paid && t.affectsPayroll !== false && t.accrual !== 'none').map(t => {
      const m = entries.find(x => x.typeId === t.id && x.effectiveYear === year), b = leaveBalance({ ...state, employeeProfiles: [{ employeeId: id, section: 'leave', entitlements: entries }] }, e, t, asOf);
      return { typeId: t.id, name: t.name, policyDays: t.entitledDays, eligible: e.leaveEligibility.includes(t.id), manualCredits: m?.manualCredits ?? null, usedBefore: m?.usedBefore || 0, ...b };
    }),
  };
}
const creditsSchema = z.object({ year: z.number().int().min(2000).max(2200), items: z.array(z.object({ typeId: z.string().min(1).max(80), eligible: z.boolean(), manualCredits: z.number().min(0).max(366).nullable(), usedBefore: z.number().min(0).max(366) }).strict()).max(100), remarks: z.string().trim().max(500).default('') }).strict();
export function saveLeaveCredits(store, actor, id, input) {
  permit(actor, LEAVE_EDITORS);
  assertCanView(store, actor, id);
  const v = creditsSchema.parse(input);
  return store.transaction(() => {
    const state = store.read(), e = state.employees.find(x => x.id === id);
    if (!e) throw new AppError('Employee not found.', 404);
    if (v.items.some(i => !state.leaveTypes.some(t => t.id === i.typeId))) throw new AppError('Unknown leave type.');
    const current = profileOf(store, id, 'leave'), others = (current.entitlements || []).filter(x => x.effectiveYear !== v.year || !v.items.some(i => i.typeId === x.typeId));
    const kept = (current.entitlements || []).filter(x => x.effectiveYear === v.year);
    const entries = v.items.filter(i => i.manualCredits !== null || i.usedBefore).map(i => ({ typeId: i.typeId, annualDays: kept.find(k => k.typeId === i.typeId)?.annualDays ?? null, effectiveYear: v.year, manualCredits: i.manualCredits, usedBefore: i.usedBefore }));
    saveProfile(store, actor, id, 'leave', { entitlements: [...others, ...entries], remarks: v.remarks || current.remarks || '' });
    const eligibility = new Set(e.leaveEligibility);
    for (const i of v.items) { if (i.eligible) eligibility.add(i.typeId); else eligibility.delete(i.typeId); }
    const after = [...eligibility];
    if (after.length !== e.leaveEligibility.length || after.some(x => !e.leaveEligibility.includes(x))) saveRecord(store, actor, 'employees', { ...store.read().employees.find(x => x.id === id), leaveEligibility: after }, { trusted: true });
    return leaveCredits(store, actor, id, v.year);
  });
}
