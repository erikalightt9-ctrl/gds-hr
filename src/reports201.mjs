// HR 201 reports. Each respects the same scope as the screens (department managers see their team only) and
// never includes government identifiers or restricted document details.
import { directory, readSettings } from './hr201.mjs';
import { documentSummary, completionReport } from './documents201.mjs';
import { memoSummary } from './memos.mjs';
import { participationRows } from './trainings.mjs';
import { localToday } from './profiles.mjs';

const HR_TEAM = ['admin', 'hr', 'hr_staff'], VIEWERS = ['admin', 'hr', 'hr_staff', 'viewer', 'dept_manager'];
const inRange = (d, f) => (!f.from || (d && d >= f.from)) && (!f.to || (d && d <= f.to));
const byDept = (rows, f) => (f.department ? rows.filter(r => r.department === f.department) : rows);
const people = (store, actor, f) => byDept(directory(store, actor).filter(p => !p.archived || f.status === 'Archived'), f).filter(p => !f.status || p.status === f.status);

export const REPORTS_201 = {
  'employee-master': {
    title: 'Employee master list', roles: VIEWERS, filters: ['department', 'status'],
    headers: ['Employee No.', 'Name', 'Department', 'Position', 'Classification', 'Status', 'Date hired', 'Work email', 'Immediate supervisor'],
    rows: (state, store, actor, f) => people(store, actor, f).sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.number, p.name, p.department, p.position, p.classification, p.status, p.dateHired, p.workEmail, p.supervisor]),
  },
  'department-summary': {
    title: 'Department summary', roles: VIEWERS, filters: [],
    headers: ['Department', 'Active', 'Inactive', 'Total'],
    rows: (state, store, actor) => {
      const groups = directory(store, actor).filter(p => !p.archived).reduce((m, p) => { const d = p.department || 'Unassigned'; m[d] ??= [0, 0]; m[d][p.status === 'Active' ? 0 : 1]++; return m; }, {});
      return Object.entries(groups).sort().map(([d, [a, i]]) => [d, a, i, a + i]);
    },
  },
  'classification-summary': {
    title: 'Employment classification summary', roles: VIEWERS, filters: ['department'],
    headers: ['Classification', 'Active', 'Inactive', 'Total'],
    rows: (state, store, actor, f) => {
      const groups = people(store, actor, { ...f, status: '' }).reduce((m, p) => { const c = p.classification || 'Not set'; m[c] ??= [0, 0]; m[c][p.status === 'Active' ? 0 : 1]++; return m; }, {});
      return Object.entries(groups).sort().map(([c, [a, i]]) => [c, a, i, a + i]);
    },
  },
  'new-hires': {
    title: 'New hires', roles: VIEWERS, filters: ['department', 'from', 'to'],
    headers: ['Employee No.', 'Name', 'Department', 'Position', 'Classification', 'Date hired'],
    rows: (state, store, actor, f) => { const range = f.from || f.to ? f : { from: new Date(Date.parse(localToday()) - 30 * 86400000).toISOString().slice(0, 10), to: localToday() }; return people(store, actor, { ...f, status: '' }).filter(p => inRange(p.dateHired, range)).sort((a, b) => (b.dateHired || '').localeCompare(a.dateHired || '')).map(p => [p.number, p.name, p.department, p.position, p.classification, p.dateHired]); },
  },
  'document-gaps': {
    title: 'Missing, expired and expiring 201 documents', roles: HR_TEAM, filters: ['department'],
    headers: ['Employee No.', 'Name', 'Department', 'Requirement', 'Category', 'Required', 'Status', 'Due', 'Expiry'],
    rows: (state, store, actor, f) => byDept(documentSummary(store, actor).rows, f).map(r => [r.number, r.name, r.department, r.requirement, r.category, r.required ? 'Yes' : 'No', r.overdue ? `${r.status} (overdue)` : r.status, r.due, r.expiry]),
  },
  'document-completion': {
    title: '201 document completion', roles: HR_TEAM, filters: ['department'],
    headers: ['Employee No.', 'Name', 'Department', 'Required documents', 'Verified', 'Completion %'],
    rows: (state, store, actor, f) => completionReport(store, actor).filter(r => !f.department || r.employee.department === f.department).map(r => [r.employee.employeeNumber || r.employee.id, r.employee.name, r.employee.department, r.requiredCount, r.completeCount, `${r.percent}%`]),
  },
  'memo-acknowledgements': {
    title: 'Pending memo acknowledgements', roles: VIEWERS, filters: ['department'],
    headers: ['Memo', 'Reference', 'Version', 'Employee', 'Department', 'Assigned', 'Deadline', 'Overdue'],
    rows: (state, store, actor, f) => byDept(memoSummary(store, actor).rows, f).map(r => [r.title, r.reference, r.version, r.name, r.department, r.assignedAt.slice(0, 10), r.deadline, r.overdue ? 'Yes' : 'No']),
  },
  'training-participation': {
    title: 'Training participation and completion', roles: VIEWERS, filters: ['department', 'from', 'to'],
    headers: ['Training', 'Date', 'Required', 'Employee', 'Department', 'Registration', 'Attendance', 'Completion'],
    rows: (state, store, actor, f) => byDept(participationRows(store, actor), f).filter(r => inRange(r.date, f)).map(r => [r.training, r.date, r.required ? 'Yes' : 'No', r.name, r.department, r.registration, r.attendance, r.completion]),
  },
  'review-schedule': {
    title: 'Upcoming probation and performance reviews', roles: ['admin', 'hr', 'hr_staff', 'viewer'], filters: ['department', 'from', 'to'],
    headers: ['Employee No.', 'Name', 'Department', 'Classification', 'Review type', 'Date'],
    rows: (state, store, actor, f) => {
      const today = localToday(), until = f.to || new Date(Date.parse(today) + 90 * 86400000).toISOString().slice(0, 10);
      return people(store, actor, { ...f, status: 'Active' }).flatMap(p => [['Probation end', p.probationEnd], ['Performance review', p.reviewDate]].filter(([, d]) => d && d >= (f.from || today) && d <= until).map(([kind, d]) => [p.number, p.name, p.department, p.classification, kind, d])).sort((a, b) => a[5].localeCompare(b[5]));
    },
  },
};
export const brandingLine = store => { const s = readSettings(store); return `${s.company.name} · ${s.company.systemTitle}`; };
