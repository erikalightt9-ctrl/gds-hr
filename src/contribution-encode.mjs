// Manually encoded contributions: add a person to the Government Contributions page without putting them in payroll
// (payroll status 'Remittance only', like the CEO). Either a registered employee who is not in payroll (a draft
// profile) or a new person with a name and declared monthly compensation. Premiums are then adjusted with Edit.
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { saveProfile } from './profiles.mjs';
import { nextEmployeeNumber } from './hr201.mjs';
import { titleCase } from './names.mjs';

const name = z.string().trim().max(120).default('');
const encodeSchema = z.object({
  employeeId: z.string().trim().max(40).default(''),           // existing employee, or blank for a new person
  lastName: name, firstName: name, middleName: name,
  employeeNumber: z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/, 'Employee ID: letters, numbers and dashes only.').default(''),
  monthlySalary: z.coerce.number().positive('Enter the declared monthly compensation.').max(10000000),
  startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose the first month of contributions.'),
}).strict();
const PAYROLL_PROFILE = { basis: '', dailyRate: null, hourlyRate: null, frequency: '', schedule: '', status: 'Remittance only', withholdingTax: 'exempt' };
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? 'null');

export function addContributionEmployee(store, actor, input) {
  permit(actor, ['admin', 'hr']);
  const v = encodeSchema.parse(input), startDate = `${v.startMonth}-01`;
  return store.transaction(() => {
    const employees = store.read().employees;
    if (v.employeeId) {
      const e = employees.find(x => x.id === v.employeeId);
      if (!e) throw new AppError('Employee not found.', 404);
      const pay = profileOf(store, e.id, 'payroll');
      // Never takes someone out of payroll: only profiles that are not paid through payroll can be encoded here.
      if (!e.draft && pay?.status !== 'Remittance only') throw new AppError(`${e.name} is already in payroll; their contributions come from payroll.`);
      saveRecord(store, actor, 'employees', { ...e, monthlySalary: v.monthlySalary, startDate: e.startDate || startDate }, { trusted: true });
      saveProfile(store, actor, e.id, 'payroll', { ...PAYROLL_PROFILE, ...(pay || {}), status: 'Remittance only' });
      return { id: e.id, name: e.name };
    }
    const last = titleCase(v.lastName), first = titleCase(v.firstName), middle = titleCase(v.middleName);
    if (!last || !first) throw new AppError('Enter the last name and first name.');
    const id = v.employeeNumber || nextEmployeeNumber(store, startDate);
    if (employees.some(e => [e.id, e.employeeNumber].filter(Boolean).map(x => x.toUpperCase()).includes(id.toUpperCase()))) throw new AppError(`Employee ID ${id} is already used.`);
    const full = `${last}, ${[first, middle].filter(Boolean).join(' ')}`;
    saveRecord(store, actor, 'employees', { id, name: full, draft: true, department: '', monthlySalary: v.monthlySalary, startDate, endDate: '', active: false, restDays: [0], scheduleStart: '', coveredOT: false, coveredNSD: false, coveredHoliday: false, covered13th: false, leaveEligibility: [], employeeNumber: '', archived: false }, { trusted: true });
    saveProfile(store, actor, id, 'personal', { lastName: last, firstName: first, middleName: middle, suffix: '', sex: '', birthDate: '', civilStatus: '', nationality: '', mobile: '', personalEmail: '', address: '', preferredName: '', birthPlace: '', bloodType: '', permanentAddress: '' });
    saveProfile(store, actor, id, 'payroll', PAYROLL_PROFILE);
    return { id, name: full };
  });
}
