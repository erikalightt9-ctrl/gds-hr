// Full names for login accounts: "Who did it" lines show the person ("Erika Lima Hernando"), not the username.
// A login linked to an employee record uses that record's name ("Last, First Middle" -> "First Middle Last");
// otherwise the username is kept.
export const displayName = name => { const [last, first] = String(name || '').split(',').map(x => x.trim()); return first ? `${first} ${last}` : String(name || ''); };

export function staffNames(store, { staffOnly = false } = {}) {
  const employees = new Map(store.read().employees.map(e => [e.id, e.name]));
  const rows = store.db.prepare(`SELECT username, role, employee_id FROM users WHERE employee_id IS NOT NULL${staffOnly ? " AND role <> 'employee'" : ''}`).all();
  return Object.fromEntries(rows.filter(r => employees.has(r.employee_id)).map(r => [r.username, displayName(employees.get(r.employee_id))]));
}
// "gds.erika" or "gds.erika (note)" -> "Erika Lima Hernando" / "Erika Lima Hernando (note)".
export function fullNameOf(store, who, names = staffNames(store)) {
  const text = String(who || ''), m = text.match(/^(\S+)(.*)$/);
  return m && names[m[1]] ? `${names[m[1]]}${m[2]}` : text;
}
