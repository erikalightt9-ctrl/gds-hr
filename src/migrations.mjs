// One-time data updates applied at start-up. Each runs once per database (recorded in hr_counters) and writes
// every change to the audit trail with its previous value.
import { capitalizeExistingNames } from './names.mjs';

const once = (store, key, run) => {
  if (store.db.prepare('SELECT value FROM hr_counters WHERE key=?').get(key)) return 0;
  return run();
};
// Every employee belongs to GDS Capital HQ (October 2026 instruction); the department list includes it.
export const HEADQUARTERS = 'GDS Capital HQ';
function headquartersDepartment(store) {
  return once(store, 'migration:department-hq', () => store.transaction(() => {
    const system = { username: 'system (department update)' }, state = store.read();
    let changed = 0;
    for (const e of state.employees) {
      if (e.department === HEADQUARTERS) continue;
      store.log(system, 'set-department', 'employees', e.id, { department: e.department }, { department: HEADQUARTERS });
      e.department = HEADQUARTERS; changed++;
    }
    state.version++; store.write(state);
    const row = store.db.prepare('SELECT data FROM hr_settings WHERE id=1').get();
    if (row) {
      const settings = JSON.parse(row.data), before = settings.departments || [];
      if (!before.includes(HEADQUARTERS)) {
        settings.departments = [HEADQUARTERS, ...before];
        store.db.prepare('UPDATE hr_settings SET data=? WHERE id=1').run(JSON.stringify(settings));
        store.log(system, 'update', 'settings', 'departments', { departments: before }, { departments: settings.departments });
      }
    }
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run('migration:department-hq');
    return changed;
  }));
}
export function runMigrations(store) {
  return { names: capitalizeExistingNames(store), departments: headquartersDepartment(store) };
}
