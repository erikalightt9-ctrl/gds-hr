// Capitalizes each word of a person's name as it is encoded: "juan DELA cruz" → "Juan Dela Cruz".
// Hyphenated and apostrophe parts are capitalized too (Anne-Marie, O'Brien); Roman numeral suffixes stay upper case
// (III), and "Jr." / "Sr." keep their usual form.
const ROMAN = /^(i{1,3}|iv|v|vi{0,3}|ix|x)$/i;
const word = w => {
  if (!w) return w;
  if (ROMAN.test(w.replace(/\.$/, ''))) return w.toUpperCase();
  return w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
};
export function titleCase(value) {
  if (typeof value !== 'string') return value;
  return value.trim().split(/\s+/).filter(Boolean).map(word).join(' ');
}
const NAME_KEYS = ['firstName', 'middleName', 'lastName', 'suffix', 'preferredName'];
// Applies titleCase to the name fields of a personal-information object.
export function personalNames(personal) {
  if (!personal) return personal;
  return { ...personal, ...Object.fromEntries(NAME_KEYS.filter(k => typeof personal[k] === 'string').map(k => [k, titleCase(personal[k])])) };
}
// Name fields of each profile section that holds people's names.
export function sectionNames(section, value) {
  if (!value) return value;
  if (section === 'personal') return personalNames(value);
  if (section === 'emergency') return { ...value, name: titleCase(value.name) };
  if (section === 'family') {
    const person = p => (p ? { ...p, name: titleCase(p.name) } : p);
    return { ...value, spouse: person(value.spouse), father: person(value.father), mother: person(value.mother), children: (value.children || []).map(person) };
  }
  return value;
}

// One-time update of names saved before automatic capitalization (e.g. "REYES, PATRICK OLIVER L." →
// "Reyes, Patrick Oliver L."). Runs once per database; every change is in the audit trail with the old value.
const MIGRATION_KEY = 'migration:capitalize-names';
export function capitalizeExistingNames(store) {
  if (store.db.prepare('SELECT value FROM hr_counters WHERE key=?').get(MIGRATION_KEY)) return 0;
  const system = { username: 'system (name capitalization)' };
  let changed = 0;
  store.transaction(() => {
    const state = store.read();
    for (const e of state.employees) {
      for (const section of ['personal', 'emergency', 'family']) {
        const row = store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(e.id, section);
        if (!row) continue;
        const before = JSON.parse(row.data), after = sectionNames(section, before);
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        store.db.prepare('UPDATE employee_profiles SET data=? WHERE employee_id=? AND section=?').run(JSON.stringify(after), e.id, section);
        store.log(system, 'capitalize-names', `profile:${section}`, e.id, before, after); changed++;
      }
      const personal = JSON.parse(store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='personal'").get(e.id)?.data || 'null');
      const name = personal?.lastName ? [personal.lastName, [personal.firstName, personal.middleName, personal.suffix].filter(Boolean).join(' ')].filter(Boolean).join(', ') : titleCase(e.name);
      if (name && name !== e.name) { store.log(system, 'capitalize-names', 'employees', e.id, { name: e.name }, { name }); e.name = name; changed++; }
    }
    state.version++; store.write(state);
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run(MIGRATION_KEY);
  });
  return changed;
}
