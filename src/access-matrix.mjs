// Users, roles and the approval matrix (Nov 20, 2026). The matrix is built from the rules the server enforces, so the
// screen and the system always agree. Two-factor sign-in is required for HR, HR Staff, Payroll and Management
// accounts (the service account and employees are exempt; Admin is strongly recommended).
import { permit } from './service.mjs';
import { ROLE_LABELS } from './roles.mjs';
import { readDpSettings } from './discipline-settings.mjs';

export const MFA_REQUIRED_ROLES = ['hr', 'hr_staff', 'payroll', 'viewer'];
export const ROLE_SCOPE = {
  admin: 'Company setup, accounts, permissions, backups and technical settings; salaries and sensitive files only with that permission', hr: 'Manages their company\'s employees, reviews sensitive changes, approves payroll, oversees HR records', hr_staff: 'Day-to-day 201 work; no settings, sensitive IDs or restricted files',
  maker: 'Creates and updates 201 files, checks documents, reviews attendance, prepares corrections; salary access granted separately', dept_manager: 'Reviews their team\'s leave, overtime, explanations and offsets', viewer: 'Read-only access to authorized records and reports of their company',
  payroll: 'Computes salary, deductions and loans; prepares payslips and remittance reports', finance: 'Receives approved totals, releases salaries and loans, records payment references (read-only until release recording is added)', service: 'Read-only integration (AI assistant); cannot change or approve anything', employee: 'Own records only',
};
export function approvalMatrix(store, actor) {
  permit(actor, ['admin', 'hr', 'viewer', 'payroll']);
  const dp = readDpSettings(store), r = roles => roles.map(x => ROLE_LABELS[x] || x).join(', ');
  return [
    { area: 'Payroll', action: 'Finalize (post) payroll', prepares: r(['admin', 'payroll']), approves: r(['admin', 'payroll']), rule: 'Only rows with every attendance item validated or decided are posted; held employees wait for HR decisions' },
    { area: 'Payroll', action: 'Payroll decision on an attendance review item', prepares: r(['admin', 'hr', 'payroll']), approves: '—', rule: 'Reason required; never an automatic absence' },
    { area: 'Payroll', action: 'Salary or rate change', prepares: r(['admin', 'hr', 'payroll']), approves: r(['admin', 'payroll']), rule: 'Second person (not the requester); reason and effective date required' },
    { area: 'Payroll', action: 'Payroll rules version', prepares: r(['admin']), approves: r(['admin']), rule: 'Approved versions are locked; changes need a new version' },
    { area: 'Attendance', action: 'Attendance correction request (missed time in / out)', prepares: 'Employee', approves: r(['admin', 'hr']), rule: 'Justifiable reason (not forgetfulness alone) and HR verification required' },
    { area: 'Attendance', action: 'Overtime application', prepares: 'Employee or HR', approves: r(['admin', 'hr']), rule: 'Needs approved / validated attendance and payable hours, or an override reason; changing a decision needs a reason; locked once paid' },
    { area: 'Attendance', action: 'Late explanation', prepares: 'Employee', approves: r(['admin', 'hr']), rule: 'Late confirmed (late stands, less offset) or Late excused (no lateness)' },
    { area: 'Leave', action: 'Leave application', prepares: 'Employee', approves: r(['admin', 'hr']), rule: 'Approved leave is final' },
    { area: 'Memos', action: 'Issue a memo or revision', prepares: r(['admin', 'hr', 'hr_staff', 'maker']), approves: r(['admin', 'hr']), rule: 'Approved and issued by someone other than the person who prepared it' },
    { area: 'Discipline', action: 'Notice of Decision', prepares: r(['admin', 'hr']), approves: r(dp.approverRoles), rule: dp.separateApprover ? 'Approver must not be the preparer' : 'Approver may be the preparer' },
    { area: 'Discipline', action: 'Review / Appeal Outcome', prepares: 'Employee asks for review', approves: r(['admin', 'hr']), rule: 'Case cannot close while a review waits' },
    { area: 'Loans', action: 'Loan application', prepares: 'Employee', approves: r(['admin', 'hr', 'payroll']), rule: 'New loan only below 20% of the active loan left' },
    { area: 'Employee movements', action: 'Promotion, transfer, regularization, separation and clearance', prepares: r(['admin', 'hr']), approves: r(['admin', 'hr']), rule: 'Second person approves; pay effects go through a salary change' },
  ];
}
export function usersAndRoles(store, actor) {
  permit(actor, ['admin']);
  const users = store.db.prepare('SELECT role, mfa_secret, disabled, employee_id FROM users').all();
  return Object.keys(ROLE_LABELS).map(role => {
    const mine = users.filter(u => u.role === role && !u.disabled);
    return { role, label: ROLE_LABELS[role], scope: ROLE_SCOPE[role] || '', accounts: mine.length, withMfa: mine.filter(u => u.mfa_secret).length, mfaRequired: MFA_REQUIRED_ROLES.includes(role), unnamed: ['admin', 'hr', 'payroll', 'viewer'].includes(role) ? mine.filter(u => !u.employee_id).length : 0 };
  });
}
