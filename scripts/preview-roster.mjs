// Local-only preview with a durable copy of the saved roster and sample payroll.
// Preview changes remain separate from the live HR database.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';
import { addUser } from '../src/auth.mjs';
const dataPath = name => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const store = new Store(dataPath('roster-preview.sqlite'));
if (!store.read().employees.length) {
  const snapshot = JSON.parse(readFileSync(dataPath('preview-snapshot.json'), 'utf8'));
  store.write(snapshot.state);
  for (const event of snapshot.audit) store.db.prepare('INSERT OR IGNORE INTO audit VALUES(?,?,?,?,?,?,?,?)').run(event.id, event.at, event.actor, event.action, event.kind, event.recordId, JSON.stringify(event.before), JSON.stringify(event.after));
}
const saved = new Store(dataPath('hr.sqlite'));
try {
  store.transaction(() => {
    const state = store.read();
    for (const employee of saved.read().employees) {
      if (state.employees.some(e => e.id === employee.id)) continue;
      state.employees.push(employee);
      store.log({ username: 'local-roster-import' }, 'create', 'employees', employee.id, null, employee);
    }
    state.version++; store.write(state);
  });
} finally { saved.close(); }
if (!store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n) await addUser(store, { username: 'demo.admin', password: 'Demo-preview-only-2026', role: 'admin' });
// Only the fictional sample employee receives a preview login; real roster accounts are created by HR.
if (store.read().employees.some(e => e.id === 'EMP-001' && e.name.includes('(sample)')) && !store.db.prepare('SELECT id FROM users WHERE employee_id=? OR username=?').get('EMP-001', 'demo.employee')) await addUser(store, { username: 'demo.employee', password: 'Demo-employee-only-2026', role: 'employee', employeeId: 'EMP-001' }, { username: 'preview-setup', role: 'admin' });
const app = createApp({ store, origin: 'http://127.0.0.1:3401', setupToken: '', demo: true });
app.listen(3401, '127.0.0.1', () => console.log('GDS roster preview ready at http://127.0.0.1:3401'));
const close = () => { app.closeAllConnections(); app.close(() => { store.close(); process.exit(0); }); };
process.on('SIGINT', close); process.on('SIGTERM', close);
