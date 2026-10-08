// Employee-provided details. When HR approves an employee's data sheet, every detail the employee filled in is
// marked as the employee's own; a Maker can no longer change it (HR Managers and Admins still can). Details that
// are still empty can be filled in by the Maker. Employees are told which details are missing.
import { AppError } from './service.mjs';

const ensure = store => store.db.exec('CREATE TABLE IF NOT EXISTS employee_field_locks(employee_id TEXT NOT NULL, path TEXT NOT NULL, locked_at TEXT NOT NULL, locked_by TEXT NOT NULL, PRIMARY KEY(employee_id, path))');
export const FIELD_LABELS = {
  'personal.firstName': 'First name', 'personal.middleName': 'Middle name', 'personal.lastName': 'Last name', 'personal.suffix': 'Suffix', 'personal.preferredName': 'Preferred name',
  'personal.sex': 'Sex', 'personal.birthDate': 'Date of birth', 'personal.birthPlace': 'Place of birth', 'personal.civilStatus': 'Civil status', 'personal.nationality': 'Nationality',
  'contact.personalEmail': 'Personal email', 'contact.mobile': 'Mobile number', 'contact.currentAddress': 'Current address', 'contact.permanentAddress': 'Permanent address',
  'emergency.name': 'Emergency contact person', 'emergency.relationship': 'Emergency contact relationship', 'emergency.contact': 'Emergency contact number',
  'government.tin': 'TIN', 'government.sss': 'SSS number', 'government.philHealth': 'PhilHealth number', 'government.pagIbig': 'Pag-IBIG number',
};
// Details every employee is asked to complete (government numbers are asked for by the 201 requirements list).
const EXPECTED = ['personal.sex', 'personal.birthDate', 'personal.birthPlace', 'personal.civilStatus', 'personal.nationality', 'contact.mobile', 'contact.currentAddress', 'emergency.name', 'emergency.relationship', 'emergency.contact'];

export function lockedFields(store, employeeId) { ensure(store); return store.db.prepare('SELECT path FROM employee_field_locks WHERE employee_id=?').all(employeeId).map(r => r.path); }
export function lockFields(store, actor, employeeId, paths) {
  ensure(store);
  const now = new Date().toISOString();
  for (const p of paths.filter(x => FIELD_LABELS[x])) store.db.prepare('INSERT INTO employee_field_locks VALUES(?,?,?,?) ON CONFLICT(employee_id, path) DO UPDATE SET locked_at=excluded.locked_at, locked_by=excluded.locked_by').run(employeeId, p, now, actor.username);
}
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
// Current value of a form path, as stored in the employee's profile.
export function currentValue(store, employeeId, path) {
  const [group, key] = path.split('.'), p = profileOf(store, employeeId, 'personal');
  if (group === 'personal') return p[key] ?? '';
  if (group === 'contact') return ({ personalEmail: p.personalEmail, mobile: p.mobile, currentAddress: p.address, permanentAddress: p.permanentAddress })[key] ?? '';
  return profileOf(store, employeeId, group)[key] ?? '';
}
// Maker edits: refuse changes to details the employee provided (approved by HR).
export function assertMakerCanChange(store, actor, employeeId, form) {
  if (actor.role !== 'maker') return;
  const changed = lockedFields(store, employeeId).filter(path => {
    const [group, key] = path.split('.'), next = form?.[group]?.[key];
    if (next === undefined || String(next).includes('•')) return false;
    return String(next ?? '').trim() !== String(currentValue(store, employeeId, path) ?? '').trim();
  });
  if (changed.length) throw new AppError(`These details were provided by the employee and approved by HR, so only HR can change them: ${changed.map(p => FIELD_LABELS[p]).join(', ')}.`, 403);
}
// Details the employee still has to fill in (shown in their account).
export function missingDetails(store, employeeId) {
  return EXPECTED.filter(path => !String(currentValue(store, employeeId, path) || '').trim()).map(path => FIELD_LABELS[path]);
}
