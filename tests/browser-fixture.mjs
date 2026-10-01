// Disposable browser-test workspace. It never reads or writes the production database.
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';
import { addUser } from '../src/auth.mjs';
import { completeState } from './helpers.mjs';
const store = new Store(':memory:');
const s = completeState();
s.employees[0].name = 'Alex Rivera (sample)';
s.attendance[0].timeOut = '18:00';
s.attendance[1].timeIn = '08:15';
s.attendance[1].timeOut = '16:15';
store.write(s);
await addUser(store, { username: 'demo.admin', password: 'Demo-preview-only-2026', role: 'admin' });
const app = createApp({ store, origin: 'http://127.0.0.1:3401', setupToken: '', demo: true });
app.listen(3401, '127.0.0.1', () => console.log('Disposable HR browser fixture ready at http://127.0.0.1:3401'));
