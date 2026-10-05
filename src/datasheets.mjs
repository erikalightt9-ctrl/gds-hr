// Employee data sheets: employees fill in their own information (draft → submitted), HR reviews it, and only an
// approval writes it into the employee record. Returned sheets go back to the employee with the reason.
// Nothing an employee types overwrites approved HR records until HR approves it.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { saveProfile, localToday } from './profiles.mjs';
import { HR_MANAGERS, HR_TEAM } from './roles.mjs';

const f = (max = 200) => z.string().trim().max(max).default('');
const date = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default('');
export const sheetSchema = z.object({
  personal: z.object({ firstName: f(120), middleName: f(120), lastName: f(120), suffix: f(20), preferredName: f(120), sex: z.enum(['', 'Female', 'Male', 'Other']).default(''), birthDate: date, birthPlace: f(200), civilStatus: f(40), nationality: f(80) }).strict(),
  contact: z.object({ personalEmail: f(200), mobile: f(40), currentAddress: f(500), permanentAddress: f(500) }).strict(),
  emergency: z.object({ name: f(200), relationship: f(80), contact: f(40) }).strict(),
  government: z.object({ tin: f(30), sss: f(30), philHealth: f(30), pagIbig: f(30) }).strict(),
}).strict();
const OPEN = ['draft', 'submitted', 'under-review', 'returned'];
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const all = (store, where = '', ...args) => store.db.prepare(`SELECT data FROM datasheets ${where}`).all(...args).map(r => JSON.parse(r.data));
const write = (store, s) => store.db.prepare('INSERT INTO datasheets(id,employee_id,status,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(s.id, s.employeeId, s.status, JSON.stringify(s));
const event = (actor, action, note = '') => ({ at: new Date().toISOString(), by: actor.username, action, note });

function currentValues(store, employeeId) {
  const p = profileOf(store, employeeId, 'personal'), m = profileOf(store, employeeId, 'emergency');
  return {
    personal: { firstName: p.firstName || '', middleName: p.middleName || '', lastName: p.lastName || '', suffix: p.suffix || '', preferredName: p.preferredName || '', sex: p.sex || '', birthDate: p.birthDate || '', birthPlace: p.birthPlace || '', civilStatus: p.civilStatus || '', nationality: p.nationality || '' },
    contact: { personalEmail: p.personalEmail || '', mobile: p.mobile || '', currentAddress: p.address || '', permanentAddress: p.permanentAddress || '' },
    emergency: { name: m.name || '', relationship: m.relationship || '', contact: m.contact || '' },
    government: { tin: '', sss: '', philHealth: '', pagIbig: '' },   // never prefilled back to the employee
  };
}
// Employee: their open sheet (or a new one prefilled from the record) and their history.
export function mySheet(store, actor) {
  permit(actor, ['employee']);
  const sheets = all(store, 'WHERE employee_id=? ORDER BY rowid DESC', actor.employeeId);
  const open = sheets.find(s => OPEN.includes(s.status));
  return { current: open || { id: null, status: 'new', fields: currentValues(store, actor.employeeId), history: [] }, past: sheets.filter(s => s !== open).map(s => ({ id: s.id, status: s.status, submittedAt: s.submittedAt, reviewedBy: s.reviewedBy, reviewNote: s.reviewNote })) };
}
export function saveMySheet(store, actor, input, submit = false) {
  permit(actor, ['employee']);
  const fields = sheetSchema.parse(input);
  if (submit) {
    const missing = [!fields.personal.firstName && 'first name', !fields.personal.lastName && 'last name', !fields.contact.mobile && 'mobile number', !fields.emergency.name && 'emergency contact'].filter(Boolean);
    if (missing.length) throw new AppError(`Please complete: ${missing.join(', ')}.`);
    if (fields.personal.birthDate && fields.personal.birthDate > localToday()) throw new AppError('Date of birth cannot be in the future.');
    if (fields.contact.personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.contact.personalEmail)) throw new AppError('Enter a valid email address.');
  }
  return store.transaction(() => {
    const open = all(store, 'WHERE employee_id=?', actor.employeeId).find(s => OPEN.includes(s.status));
    if (open && ['submitted', 'under-review'].includes(open.status)) throw new AppError('Your data sheet is with HR for review. You can edit it again if HR returns it.');
    const sheet = { ...(open || { id: randomUUID(), employeeId: actor.employeeId, createdAt: new Date().toISOString(), history: [] }), fields, status: submit ? 'submitted' : 'draft', ...(submit ? { submittedAt: new Date().toISOString() } : {}) };
    sheet.history = [...sheet.history, event(actor, submit ? 'submitted' : 'saved draft')];
    write(store, sheet);
    if (submit) store.log(actor, 'submit', 'datasheets', sheet.id, null, { employeeId: actor.employeeId });
    return sheet;
  });
}

// ---------- HR ----------
export function listSheets(store, actor) {
  permit(actor, HR_TEAM);
  const names = new Map(store.read().employees.map(e => [e.id, e]));
  return all(store, 'ORDER BY rowid DESC').filter(s => s.status !== 'draft').map(s => ({ id: s.id, employeeId: s.employeeId, name: names.get(s.employeeId)?.name || s.employeeId, department: names.get(s.employeeId)?.department || '', status: s.status, submittedAt: s.submittedAt || '', reviewedBy: s.reviewedBy || '', reviewedAt: s.reviewedAt || '' }));
}
const mask = v => (v ? `•••• ${v.slice(-3)}` : '');
export function sheetDetail(store, actor, id) {
  permit(actor, HR_TEAM);
  const sheet = all(store, 'WHERE id=?', id)[0];
  if (!sheet) throw new AppError('Data sheet not found.', 404);
  const current = currentValues(store, sheet.employeeId), gov = profileOf(store, sheet.employeeId, 'government');
  const showIds = HR_MANAGERS.includes(actor.role);
  current.government = { tin: showIds ? gov.tin || '' : mask(gov.tin), sss: showIds ? gov.sss || '' : mask(gov.sss), philHealth: showIds ? gov.philHealth || '' : mask(gov.philHealth), pagIbig: showIds ? gov.pagIbig || '' : mask(gov.pagIbig) };
  const fields = showIds ? sheet.fields : { ...sheet.fields, government: Object.fromEntries(Object.entries(sheet.fields.government).map(([k, v]) => [k, mask(v)])) };
  return { ...sheet, fields, current, employee: store.read().employees.find(e => e.id === sheet.employeeId) || null, canApprove: HR_MANAGERS.includes(actor.role) };
}
export function reviewSheet(store, actor, id, input) {
  const { decision, note } = z.object({ decision: z.enum(['under-review', 'approve', 'return', 'reject']), note: z.string().trim().max(1000).default('') }).strict().parse(input);
  permit(actor, ['approve', 'reject'].includes(decision) ? HR_MANAGERS : HR_TEAM);
  return store.transaction(() => {
    const sheet = all(store, 'WHERE id=?', id)[0];
    if (!sheet) throw new AppError('Data sheet not found.', 404);
    if (!['submitted', 'under-review'].includes(sheet.status)) throw new AppError('Only submitted data sheets can be reviewed.');
    if (['return', 'reject'].includes(decision) && note.length < 3) throw new AppError('Tell the employee what to correct (or why it was rejected).');
    if (decision === 'approve') {
      // Merge only the fields the employee filled in; blanks never erase what HR already has.
      const v = sheet.fields, filled = o => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== ''));
      const personal = profileOf(store, sheet.employeeId, 'personal');
      saveProfile(store, actor, sheet.employeeId, 'personal', { ...personal, ...filled(v.personal), ...filled({ personalEmail: v.contact.personalEmail, mobile: v.contact.mobile, address: v.contact.currentAddress, permanentAddress: v.contact.permanentAddress }) });
      if (Object.values(v.emergency).some(Boolean)) saveProfile(store, actor, sheet.employeeId, 'emergency', { ...profileOf(store, sheet.employeeId, 'emergency'), ...filled(v.emergency) });
      if (Object.values(v.government).some(Boolean)) saveProfile(store, actor, sheet.employeeId, 'government', { ...profileOf(store, sheet.employeeId, 'government'), ...filled(v.government) });
    }
    const status = { 'under-review': 'under-review', approve: 'approved', return: 'returned', reject: 'rejected' }[decision];
    const updated = { ...sheet, status, reviewedBy: actor.username, reviewedAt: new Date().toISOString(), reviewNote: note, history: [...sheet.history, event(actor, status, note)] };
    write(store, updated);
    store.log(actor, `datasheet-${status}`, 'datasheets', id, { status: sheet.status }, { status, employeeId: sheet.employeeId, note });
    if (status !== 'under-review') store.notify(sheet.employeeId, status === 'approved' ? 'HR approved your data sheet; your record is updated.' : `HR ${status === 'returned' ? 'returned your data sheet for correction' : 'rejected your data sheet'}: ${note}`);
    return updated;
  });
}
export const pendingSheets = store => all(store).filter(s => ['submitted', 'under-review'].includes(s.status)).length;
