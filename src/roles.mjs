// Role groups for the HR 201 modules. Every check here is enforced on the server.
//   admin       System Administrator: configuration, accounts, roles, everything below
//   hr          HR Manager: employee records, document requirements, approvals, memos, trainings, reports
//   hr_staff    HR Staff: day-to-day 201 work without settings, sensitive identifiers or restricted documents
//   maker       Maker: encodes, edits and uploads every non-salary employee record; never sees pay (screens, reports,
//               files or audit values)
//   dept_manager Department Manager: read-only view of their own department's team
//   viewer      Management: dashboards and summary reports
//   payroll     Payroll: pay records (existing modules)
//   employee    Employee: own profile, data sheet, memos, trainings
//   service     Service account for an integration (e.g. the AI assistant): reads like Management, never changes or
//               approves anything (every change is refused), so approvals always carry a named person's account
export const ROLE_LABELS = {
  admin: 'System Administrator', hr: 'Company Admin / HR Head', hr_staff: 'HR Staff', maker: 'HR Maker', dept_manager: 'Supervisor / Approver',
  viewer: 'Auditor / Viewer', payroll: 'Payroll Officer', finance: 'Finance / Releasing Officer', service: 'Service account (read-only, AI integration)', employee: 'Employee',
};
export const HR_MANAGERS = ['admin', 'hr'];
export const HR_TEAM = ['admin', 'hr', 'hr_staff', 'maker'];
export const SENSITIVE_IDS = ['admin', 'hr', 'payroll', 'maker'];          // TIN, SSS, PhilHealth, Pag-IBIG in full
export const DIRECTORY = ['admin', 'hr', 'hr_staff', 'maker', 'payroll', 'viewer', 'dept_manager'];
export const DASHBOARD = ['admin', 'hr', 'hr_staff', 'maker', 'payroll', 'viewer', 'dept_manager'];
// Roles that use the original attendance / leave / payroll workspace and its full state feed.
export const LEGACY_WORKSPACE = ['admin', 'hr', 'payroll', 'viewer'];
// Roles that may see pay: salary, rates, payroll, loans, contributions and salary-bearing documents.
export const PAY_VISIBLE = ['admin', 'hr', 'payroll', 'viewer'];
