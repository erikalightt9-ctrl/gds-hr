import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { saveRecord } from '../src/service.mjs';

// Local operator import; never exposed as an unauthenticated HTTP endpoint.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Usage: node hr/scripts/import-roster.mjs <private names.txt>');
const names = [...new Set(readFileSync(source, 'utf8').split(/\r?\n/).map(v => v.trim()).filter(Boolean))];
if (!names.length || names.length > 500 || names.some(n => n.length > 1000)) throw new Error('Provide 1–500 names, one per line.');
const directory = path.resolve(process.env.HR_DATA_DIR || path.join(root, 'data'));
mkdirSync(directory, { recursive: true });
const store = new Store(path.join(directory, 'hr.sqlite'));
try {
  let added = 0;
  for (const name of names) {
    const state = store.read();
    if (state.employees.some(e => e.name.toUpperCase() === name.toUpperCase())) continue;
    let sequence = 1;
    while (state.employees.some(e => e.id === `GDS-${String(sequence).padStart(3, '0')}`)) sequence++;
    const id = `GDS-${String(sequence).padStart(3, '0')}`;
    saveRecord(store, { username: 'local-roster-import', role: 'admin' }, 'employees', { id, name, draft: true, department: '', monthlySalary: null, startDate: '', endDate: '', active: false, restDays: [], scheduleStart: '', coveredOT: false, coveredNSD: false, coveredHoliday: false, covered13th: false, leaveEligibility: [] });
    added++;
  }
  console.log(`Saved ${added} draft employees. ${names.length - added} existing names skipped.`);
} finally { store.close(); }
