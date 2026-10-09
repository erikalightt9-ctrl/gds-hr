// Full names for login accounts: "Who did it" lines show the person ("Erika Lima Hernando"), not the username.
// A login linked to an employee record uses that record's name ("Last, First Middle" -> "First Middle Last");
// otherwise the username is kept.
export const displayName = name => { const [last, first] = String(name || '').split(',').map(x => x.trim()); return first ? `${first} ${last}` : String(name || ''); };

export function staffNames(store, { staffOnly = false } = {}) {
  const employees = new Map(store.read().employees.map(e => [e.id, e.name]));
  // A login's own display name (e.g. the admin login shown as "GDS Capital Inc") comes first, then the linked employee's name.
  const rows = store.db.prepare(`SELECT username, role, employee_id, display_name FROM users WHERE (employee_id IS NOT NULL OR display_name IS NOT NULL)${staffOnly ? " AND role <> 'employee'" : ''}`).all();
  return Object.fromEntries(rows.map(r => [r.username, r.display_name || (employees.has(r.employee_id) ? displayName(employees.get(r.employee_id)) : null)]).filter(([, name]) => name));
}
// "gds.erika" or "gds.erika (note)" -> "Erika Lima Hernando" / "Erika Lima Hernando (note)".
export function fullNameOf(store, who, names = staffNames(store)) {
  const text = String(who || ''), m = text.match(/^(\S+)(.*)$/);
  return m && names[m[1]] ? `${names[m[1]]}${m[2]}` : text;
}
