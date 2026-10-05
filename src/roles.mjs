// Role groups for the HR 201 modules. Every check here is enforced on the server.
//   admin       System Administrator: configuration, accounts, roles, everything below
//   hr          HR Manager: employee records, document requirements, approvals, memos, trainings, reports
//   hr_staff    HR Staff: day-to-day 201 work without settings, sensitive identifiers or restricted documents
//   dept_manager Department Manager: read-only view of their own department's team
//   viewer      Management: dashboards and summary reports
//   payroll     Payroll: pay records (existing modules)
//   employee    Employee: own profile, data sheet, memos, trainings
export const ROLE_LABELS = {
  admin: 'System Administrator', hr: 'HR Manager', hr_staff: 'HR Staff', dept_manager: 'Department Manager',
  viewer: 'Management', payroll: 'Payroll', employee: 'Employee',
};
export const HR_MANAGERS = ['admin', 'hr'];
export const HR_TEAM = ['admin', 'hr', 'hr_staff'];
export const SENSITIVE_IDS = ['admin', 'hr', 'payroll'];          // TIN, SSS, PhilHealth, Pag-IBIG in full
export const DIRECTORY = ['admin', 'hr', 'hr_staff', 'payroll', 'viewer', 'dept_manager'];
export const DASHBOARD = ['admin', 'hr', 'hr_staff', 'payroll', 'viewer', 'dept_manager'];
// Roles that use the original attendance / leave / payroll workspace and its full state feed.
export const LEGACY_WORKSPACE = ['admin', 'hr', 'payroll', 'viewer'];
