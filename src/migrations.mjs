// One-time data updates applied at start-up. Each runs once per database (recorded in hr_counters) and writes
// every change to the audit trail with its previous value.
import { capitalizeExistingNames } from './names.mjs';
import { explanationsDue } from './late-explanations.mjs';

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
// Company leave policy (October 2026): Vacation Leave 7 days and SIL 5 days a year, each after 12 months of
// service. Erika, Albert, Marien and Edwin receive both; everyone else receives SIL (after their first year).
export const VACATION_AND_SIL = ['2017-0420', '2024-0930', '2010-1024', '2024-0507'];
function leavePolicy(store) {
  return once(store, 'migration:leave-policy-2026-10', () => store.transaction(() => {
    const system = { username: 'system (leave policy)' }, state = store.read();
    let changed = 0;
    const vacation = state.leaveTypes.find(t => t.id === 'vacation'), sil = state.leaveTypes.find(t => t.id === 'sil');
    for (const [type, days] of [[vacation, 7], [sil, 5]]) {
      if (!type || (type.entitledDays === days && type.minServiceMonths === 12 && type.paid)) continue;
      const before = structuredClone(type);
      Object.assign(type, { entitledDays: days, minServiceMonths: 12, paid: true });
      store.log(system, 'update', 'leaveTypes', type.id, before, type); changed++;
    }
    for (const e of state.employees) {
      const want = new Set(e.leaveEligibility || []);
      want.add('sil');
      if (vacation && VACATION_AND_SIL.includes(e.id)) want.add('vacation');
      const after = [...want];
      if (after.length === (e.leaveEligibility || []).length) continue;
      store.log(system, 'update-leave-eligibility', 'employees', e.id, { leaveEligibility: e.leaveEligibility }, { leaveEligibility: after });
      e.leaveEligibility = after; changed++;
    }
    state.version++; store.write(state);
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run('migration:leave-policy-2026-10');
    return changed;
  }));
}
// October 2026 instructions: no employee has withholding tax (each payroll profile is set to Exempt and can be
// switched back per employee), and government contributions are deducted half on each cutoff again.
function noWithholdingTax(store) {
  return once(store, 'migration:withholding-exempt-2026-10', () => store.transaction(() => {
    const system = { username: 'system (withholding tax)' }, state = store.read();
    let changed = 0;
    for (const e of state.employees) {
      const row = store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='payroll'").get(e.id);
      const before = row ? JSON.parse(row.data) : null;
      if (before?.withholdingTax === 'exempt') continue;
      const after = { ...(before || { basis: '', dailyRate: null, hourlyRate: null, frequency: '', schedule: '', status: 'Active' }), withholdingTax: 'exempt' };
      store.db.prepare("INSERT INTO employee_profiles(employee_id,section,data) VALUES(?,'payroll',?) ON CONFLICT(employee_id,section) DO UPDATE SET data=excluded.data").run(e.id, JSON.stringify(after));
      store.log(system, 'set-withholding-exempt', 'profile:payroll', e.id, before, after); changed++;
    }
    for (const rule of state.rules.filter(r => r.contributionTiming && r.contributionTiming !== 'split')) {
      const before = structuredClone(rule); rule.contributionTiming = 'split';
      store.log(system, 'restore-contribution-timing', 'rules', rule.id, { contributionTiming: before.contributionTiming }, { contributionTiming: 'split' }); changed++;
    }
    state.version++; store.write(state);
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run('migration:withholding-exempt-2026-10');
    return changed;
  }));
}
// October 2026 (later instruction): deductions are taken once a month — contributions in full on the 16th–end cutoff.
function contributionsOnceAMonth(store) {
  return once(store, 'migration:contributions-monthly-2026-10', () => store.transaction(() => {
    const system = { username: 'system (contribution timing)' }, state = store.read();
    let changed = 0;
    for (const rule of state.rules.filter(r => r.contributionTiming !== 'second')) {
      store.log(system, 'set-contribution-timing', 'rules', rule.id, { contributionTiming: rule.contributionTiming || 'split' }, { contributionTiming: 'second' });
      rule.contributionTiming = 'second'; changed++;
    }
    state.version++; store.write(state);
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run('migration:contributions-monthly-2026-10');
    return changed;
  }));
}
// Late arrival explanations (November 2026): every time in 15 minutes or more late needs one, earlier days included.
// Nothing is changed in the records; administrators get one notice listing how many earlier days still need one.
function lateExplanationNotice(store, now = new Date()) {
  return once(store, 'migration:late-explanations-2026-11', () => store.transaction(() => {
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), earlier = explanationsDue(store).filter(d => d.date < today);
    if (earlier.length) {
      const people = new Set(earlier.map(d => d.employeeId)).size;
      store.notify(null, `${earlier.length} earlier late arrival${earlier.length === 1 ? '' : 's'} (15 minutes or more) by ${people} employee${people === 1 ? '' : 's'} still need${earlier.length === 1 ? 's' : ''} a written explanation. See Attendance → Explanations.`);
    }
    store.log({ username: 'system (late explanations)' }, 'notify', 'explanations', 'historical-late', null, { count: earlier.length });
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run('migration:late-explanations-2026-11');
    return earlier.length;
  }));
}
// Leave attachments are optional unless HR asks (November 2026 instruction): open leave requests that were marked
// "proof needed" automatically by their leave type, never by HR, no longer need proof.
function optionalLeaveProof(store) {
  return once(store, 'migration:leave-proof-optional-2026-11', () => store.transaction(() => {
    const system = { username: 'system (leave proof optional)' }, state = store.read();
    let changed = 0;
    for (const l of state.leaves.filter(x => x.proofStatus === 'required' && !x.proofReviewedBy && !x.proofNote && ['pending', 'approved'].includes(x.status))) {
      store.log(system, 'clear-auto-proof', 'leaves', l.id, { proofStatus: 'required' }, { proofStatus: '' });
      l.proofStatus = ''; changed++;
    }
    if (changed) { state.version++; store.write(state); }
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,1)').run('migration:leave-proof-optional-2026-11');
    return changed;
  }));
}
export function runMigrations(store) {
  return { names: capitalizeExistingNames(store), departments: headquartersDepartment(store), leave: leavePolicy(store), withholding: noWithholdingTax(store), contributionsMonthly: contributionsOnceAMonth(store), lateExplanations: lateExplanationNotice(store), leaveProofOptional: optionalLeaveProof(store) };
}
