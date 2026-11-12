// 'Remittance only' employees (payroll status, e.g. the CEO): they appear only in the government contributions
// remittance. They do not clock in or out, are not on attendance screens and do not receive memos.
export function remittanceOnlyIds(store) {
  return new Set(store.db.prepare("SELECT employee_id, data FROM employee_profiles WHERE section='payroll'").all().filter(r => JSON.parse(r.data).status === 'Remittance only').map(r => r.employee_id));
}
