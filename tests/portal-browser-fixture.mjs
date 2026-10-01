// Disposable employee-portal UI fixture. Contains fictional data only.
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';
import { addUser } from '../src/auth.mjs';
import { completeState } from './helpers.mjs';
import { preview, postPayroll } from '../src/service.mjs';
import { saveProfile } from '../src/profiles.mjs';
const store = new Store(':memory:');
const state = completeState(); state.employees[0].name = 'Alex Rivera (sample)'; store.write(state);
const admin = await addUser(store, { username: 'demo.admin', password: 'Demo-preview-only-2026', role: 'admin' });
await addUser(store, { username: 'demo.employee', password: 'Demo-employee-only-2026', role: 'employee', employeeId: 'EMP-001' }, admin);
saveProfile(store, admin, 'EMP-001', 'employment', { position: 'Operations Associate', employmentStatus: 'Regular', employeeStatus: 'Active' });
saveProfile(store, admin, 'EMP-001', 'leave', { entitlements: [{ typeId: 'vacation', annualDays: 7, effectiveYear: 2026 }], remarks: 'Fictional test policy' });
const computed = preview(store, '2026-09-01', '2026-09-15');
postPayroll(store, admin, { start: computed.start, end: computed.end, fingerprint: computed.fingerprint, pay13th: false });
const app = createApp({ store, origin: 'http://127.0.0.1:3402', setupToken: '', demo: true });
app.listen(3402, '127.0.0.1', () => console.log('Disposable employee portal fixture: http://127.0.0.1:3402'));
const close = () => { app.closeAllConnections(); app.close(() => { store.close(); process.exit(0); }); };
process.on('SIGINT', close); process.on('SIGTERM', close);
