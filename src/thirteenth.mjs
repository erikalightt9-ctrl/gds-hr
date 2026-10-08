// 13th-month pay and final pay (Philippine DOLE rules, as configured), with manually encoded prior earnings.
//  • 13th month (PD 851): total basic salary earned in the calendar year ÷ 12, less what was already paid.
//  • Prior earnings: months worked before this system went live (e.g. January–October) are encoded by HR/Payroll;
//    a month already covered by posted payroll is never counted twice.
//  • Final pay (Labor Advisory 06-2020): unpaid salary, pro-rated 13th month, cash conversion of unused leave that
//    the policy makes convertible (SIL by law), separation pay where an authorised cause applies, less loans and other
//    accountabilities. Release is due within 30 days of separation.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { ruleOn, leaveBalance, dates, isRest, priorBasicFor, fullyPostedMonths } from './engine.mjs';
import { localToday } from './profiles.mjs';
import { payDateFor } from './paydays.mjs';

const PAY = ['admin', 'payroll', 'hr'];
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');

// ---------- Prior earnings ----------
const entrySchema = z.object({ employeeId: z.string().min(1).max(80), month, basic: z.number().min(0).max(10_000_000).nullable(), thirteenthPaid: z.number().min(0).max(10_000_000).default(0), notes: z.string().trim().max(500).default('') }).strict();
export function savePriorEarnings(store, actor, input) {
  permit(actor, PAY);
  const { entries } = z.object({ entries: z.array(entrySchema).min(1).max(2000) }).strict().parse(input);
  return store.transaction(() => {
    const state = store.read(); let saved = 0, removed = 0;
    for (const e of entries) {
      if (!state.employees.some(x => x.id === e.employeeId)) throw new AppError(`Unknown employee ${e.employeeId}.`);
      const posted = fullyPostedMonths(state, e.employeeId).has(e.month);   // part-month payroll: the encoded record holds the other cutoff
      const before = store.db.prepare('SELECT data FROM prior_earnings WHERE employee_id=? AND month=?').get(e.employeeId, e.month);
      if (e.basic === null) {   // blank clears the entry
        if (before) { store.db.prepare('DELETE FROM prior_earnings WHERE employee_id=? AND month=?').run(e.employeeId, e.month); store.log(actor, 'delete', 'prior-earnings', `${e.employeeId}:${e.month}`, JSON.parse(before.data), null); removed++; }
        continue;
      }
      if (posted) throw new AppError(`${e.employeeId} already has posted payroll in ${e.month}; that month is counted from payroll, not from encoded records.`);
      const value = { ...e, enteredBy: actor.username, enteredAt: new Date().toISOString() };
      store.db.prepare('INSERT INTO prior_earnings(employee_id,month,data) VALUES(?,?,?) ON CONFLICT(employee_id,month) DO UPDATE SET data=excluded.data').run(e.employeeId, e.month, JSON.stringify(value));
      store.log(actor, before ? 'update' : 'create', 'prior-earnings', `${e.employeeId}:${e.month}`, before ? JSON.parse(before.data) : null, value);
      saved++;
    }
    return { saved, removed };
  });
}
// ---------- Edited yearly totals ----------
// HR can type an employee's Total earned and/or 13th month pay for a year; blank (or the computed amount) goes back to the computation.
const ensureOverrides = store => store.db.exec('CREATE TABLE IF NOT EXISTS thirteenth_overrides(employee_id TEXT NOT NULL, year TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(employee_id, year))');
const overrideAmount = z.number().min(0).max(100_000_000).nullable().default(null);
const overrideSchema = z.object({ year: z.string().regex(/^\d{4}$/), entries: z.array(z.object({ employeeId: z.string().min(1).max(80), totalBasic: overrideAmount, thirteenth: overrideAmount }).strict()).min(1).max(2000) }).strict();
function overridesFor(store, year) {
  ensureOverrides(store);
  return new Map(store.db.prepare('SELECT employee_id, data FROM thirteenth_overrides WHERE year=?').all(year).map(r => [r.employee_id, JSON.parse(r.data)]));
}
export function saveThirteenthOverrides(store, actor, input) {
  permit(actor, PAY);
  const { year, entries } = overrideSchema.parse(input);
  ensureOverrides(store);
  return store.transaction(() => {
    const state = store.read(); let saved = 0;
    for (const e of entries) {
      if (!state.employees.some(x => x.id === e.employeeId)) throw new AppError(`Unknown employee ${e.employeeId}.`);
      const before = store.db.prepare('SELECT data FROM thirteenth_overrides WHERE employee_id=? AND year=?').get(e.employeeId, year);
      if (e.totalBasic === null && e.thirteenth === null) {
        if (before) { store.db.prepare('DELETE FROM thirteenth_overrides WHERE employee_id=? AND year=?').run(e.employeeId, year); store.log(actor, 'delete', 'thirteenth-overrides', `${e.employeeId}:${year}`, JSON.parse(before.data), null); saved++; }
        continue;
      }
      const value = { totalBasic: e.totalBasic === null ? null : r2(e.totalBasic), thirteenth: e.thirteenth === null ? null : r2(e.thirteenth), enteredBy: actor.username, enteredAt: new Date().toISOString() };
      store.db.prepare('INSERT INTO thirteenth_overrides(employee_id,year,data) VALUES(?,?,?) ON CONFLICT(employee_id,year) DO UPDATE SET data=excluded.data').run(e.employeeId, year, JSON.stringify(value));
      store.log(actor, before ? 'update' : 'create', 'thirteenth-overrides', `${e.employeeId}:${year}`, before ? JSON.parse(before.data) : null, value);
      saved++;
    }
    return { saved };
  });
}
// ---------- 13th month ledger ----------
export function thirteenthLedger(store, actor, year) {
  permit(actor, [...PAY, 'viewer']);
  const state = store.read(), thisMonth = localToday().slice(0, 7), edited = overridesFor(store, String(year));
  // Remittance-only people (e.g. the CEO) are not paid through payroll and have no 13th month here.
  const remittanceOnly = new Set((state.employeeProfiles || []).filter(p => p.section === 'payroll' && p.status === 'Remittance only').map(p => p.employeeId));
  return state.employees.filter(e => (!e.draft || e.startDate) && !remittanceOnly.has(e.id)).map(e => {
    const runs = state.runs.filter(r => r.status === 'posted' && r.start.startsWith(year)).flatMap(r => r.rows.filter(row => row.employeeId === e.id).map(row => ({ run: r, row })));
    const postedBasic = r2(runs.reduce((s, x) => s + x.row.applicableBasic, 0)), postedPaid = r2(runs.reduce((s, x) => s + x.row.earnings.thirteenth, 0));
    const prior = priorBasicFor(state, e.id, year);
    const covered = new Set([...runs.map(x => x.run.start.slice(0, 7)), ...prior.months]);
    const lastMonth = year === thisMonth.slice(0, 4) ? Number(thisMonth.slice(5)) : 12, first = e.startDate && e.startDate.startsWith(year) ? Number(e.startDate.slice(5, 7)) : 1;
    const missing = []; for (let m = first; m <= lastMonth; m++) { const key = `${year}-${String(m).padStart(2, '0')}`; if (!covered.has(key) && (!e.endDate || key <= e.endDate.slice(0, 7))) missing.push(key); }
    const computedTotal = r2(postedBasic + prior.basic), ov = edited.get(e.id) || {};
    const totalBasic = ov.totalBasic ?? computedTotal, computedAccrued = e.covered13th ? r2(totalBasic / 12) : 0, accrued = ov.thirteenth ?? computedAccrued, paid = r2(postedPaid + prior.thirteenthPaid);
    return { employeeId: e.id, name: e.name, endDate: e.endDate || '', covered13th: e.covered13th, postedBasic, priorBasic: prior.basic, priorMonths: prior.months, totalBasic, accrued, computedTotal, computedAccrued, totalEdited: ov.totalBasic != null, thirteenthEdited: ov.thirteenth != null, paid, balance: Math.max(0, r2(accrued - paid)), missingMonths: missing };
  });
}

// ---------- Final pay ----------
const finalSchema = z.object({
  employeeId: z.string().min(1).max(80), separationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unpaidDays: z.number().min(0).max(366).nullable().default(null),
  separationCause: z.enum(['none', 'redundancy', 'retrenchment']).default('none'),
  convertLeave: z.array(z.string().max(80)).max(50).default([]),
  deductLoans: z.boolean().default(true),
  otherEarnings: z.number().min(0).max(10_000_000).default(0), otherEarningsNote: z.string().trim().max(500).default(''),
  otherDeductions: z.number().min(0).max(10_000_000).default(0), otherDeductionsNote: z.string().trim().max(500).default(''),
  taxAdjustment: z.number().min(-10_000_000).max(10_000_000).default(0), taxNote: z.string().trim().max(500).default(''),
  save: z.boolean().default(false), notes: z.string().trim().max(2000).default(''),
}).strict();
export function computeFinalPay(store, actor, input) {
  permit(actor, PAY);
  const parsed = finalSchema.parse(input), state = store.read(), e = state.employees.find(x => x.id === parsed.employeeId);
  if (!e) throw new AppError('Employee not found.', 404);
  // Nothing is computed past the resignation / separation date on the employee's record.
  const v = e.endDate && parsed.separationDate > e.endDate ? { ...parsed, separationDate: e.endDate } : parsed;
  if (!e.startDate || v.separationDate < e.startDate) throw new AppError('The separation date is before the employee\'s start date.');
  const rule = ruleOn(state, v.separationDate) || state.rules[0];
  if (!rule) throw new AppError('Configure and approve Rules & rates first.');
  const pay = profileOf(store, e.id, 'payroll'), daily = r2(pay.dailyRate ?? (e.monthlySalary || 0) / rule.dailyDivisor), monthly = e.monthlySalary || r2(daily * rule.dailyDivisor);
  const year = v.separationDate.slice(0, 4), items = [], add = (side, label, amount, basis) => { if (amount) items.push({ side, label, amount: r2(amount), basis }); };

  // 1. Salary for days worked after the last posted payroll (or the last encoded month).
  const lastPosted = state.runs.filter(r => r.status === 'posted' && r.rows.some(row => row.employeeId === e.id)).map(r => r.end).sort().at(-1) || '';
  const prior = priorBasicFor(state, e.id, year), lastPriorMonth = prior.months.sort().at(-1);
  const lastPriorEnd = lastPriorMonth ? new Date(Date.UTC(Number(lastPriorMonth.slice(0, 4)), Number(lastPriorMonth.slice(5)), 0)).toISOString().slice(0, 10) : '';
  const paidThrough = [lastPosted, lastPriorEnd].sort().at(-1) || '';
  const from = paidThrough ? new Date(Date.parse(paidThrough) + 86400000).toISOString().slice(0, 10) : e.startDate;
  const workdays = from <= v.separationDate ? dates(from, v.separationDate).filter(d => !isRest(e, d)).length : 0;
  const days = v.unpaidDays ?? workdays, unpaidSalary = r2(days * daily);
  // Finalized payroll whose salary day falls after the last day was not received before leaving: it is paid with the final pay (net, as on the payslip).
  for (const r of state.runs.filter(r => r.status === 'posted' && payDateFor(r.start, r.end) > v.separationDate).sort((a, b) => a.start.localeCompare(b.start))) {
    const row = r.rows.find(x => x.employeeId === e.id);
    if (row) add('earnings', `Unpaid salary ${r.start} to ${r.end}`, row.net, `Finalized payroll (net pay on the payslip), salary day ${payDateFor(r.start, r.end)} is after the last day; pay it with the final pay, not separately`);
  }
  add('earnings', 'Unpaid salary', unpaidSalary, `${days} day${days === 1 ? '' : 's'} × ${daily} daily rate (${from} to ${v.separationDate}${v.unpaidDays !== null ? ', days entered by HR' : `, ${workdays} scheduled workdays`}; paid through ${paidThrough || 'none recorded'})`);

  // 2. Pro-rated 13th month: basic earned this year (payroll + encoded months + unpaid salary) ÷ 12, less paid.
  const ledger = thirteenthLedger(store, { role: 'admin' }, year).find(x => x.employeeId === e.id);
  const basicYear = r2((ledger?.totalBasic || 0) + unpaidSalary), paid13 = ledger?.paid || 0;
  const accrued = !e.covered13th ? 0 : ledger?.thirteenthEdited && !unpaidSalary ? ledger.accrued : r2(basicYear / 12);   // a 13th month typed on the 13th month page is used as is
  add('earnings', 'Pro-rated 13th month pay', Math.max(0, r2(accrued - paid13)), e.covered13th ? `${basicYear} basic earned in ${year} ÷ 12 = ${accrued}, less ${paid13} already paid` : 'Not covered (per employee record)');

  // 3. Cash conversion of unused leave (SIL is convertible by law; other types per company policy, chosen by HR).
  for (const typeId of v.convertLeave) {
    const type = state.leaveTypes.find(t => t.id === typeId); if (!type) continue;
    const b = leaveBalance(state, e, type, v.separationDate);
    add('earnings', `Unused ${type.name} converted to cash`, Math.max(0, b.available) * daily, `${b.available} unused day${b.available === 1 ? '' : 's'} × ${daily} daily rate`);
  }
  // 4. Separation pay for authorised causes (Labor Code Art. 298–299); a fraction of 6 months or more counts as a year.
  const months = (Number(v.separationDate.slice(0, 4)) - Number(e.startDate.slice(0, 4))) * 12 + Number(v.separationDate.slice(5, 7)) - Number(e.startDate.slice(5, 7)) - (Number(v.separationDate.slice(8)) < Number(e.startDate.slice(8)) ? 1 : 0);
  const years = Math.floor(months / 12) + (months % 12 >= 6 ? 1 : 0);
  if (v.separationCause !== 'none') {
    const factor = v.separationCause === 'redundancy' ? 1 : 0.5, amount = Math.max(monthly, r2(monthly * factor * years));
    add('earnings', 'Separation pay', amount, `${v.separationCause === 'redundancy' ? 'Redundancy / labor-saving devices: one month' : 'Retrenchment / closure / disease: half a month'} per year of service × ${years} year${years === 1 ? '' : 's'} (${months} months), at least one month's pay of ${monthly}`);
  }
  add('earnings', 'Other earnings', v.otherEarnings, v.otherEarningsNote || 'Entered by HR');
  // Less accountabilities.
  if (v.deductLoans) for (const l of state.loans.filter(l => l.employeeId === e.id && l.authorized)) { const due = r2(l.balance + (l.interestBalance || 0)); add('deductions', `${l.type} ${l.reference} (outstanding)`, due, `Principal ${l.balance}${l.interestBalance ? ` + interest ${l.interestBalance}` : ''}`); }
  add('deductions', 'Other deductions / accountabilities', v.otherDeductions, v.otherDeductionsNote || 'Entered by HR');
  if (v.taxAdjustment > 0) add('deductions', 'Withholding tax adjustment', v.taxAdjustment, v.taxNote || 'Year-end annualization (entered by HR)');
  if (v.taxAdjustment < 0) add('earnings', 'Tax refund', -v.taxAdjustment, v.taxNote || 'Year-end annualization (entered by HR)');

  const gross = r2(items.filter(i => i.side === 'earnings').reduce((s, i) => s + i.amount, 0)), less = r2(items.filter(i => i.side === 'deductions').reduce((s, i) => s + i.amount, 0));
  const result = { employeeId: e.id, name: e.name, separationDate: v.separationDate, releaseDue: new Date(Date.parse(v.separationDate) + 30 * 86400000).toISOString().slice(0, 10), dailyRate: daily, monthlySalary: monthly, yearsOfService: years, ruleId: rule.id, items, gross, deductions: less, net: r2(gross - less), notes: v.notes };
  if (v.save) {
    const record = { id: randomUUID(), ...result, input: v, computedBy: actor.username, computedAt: new Date().toISOString() };
    store.transaction(() => { store.db.prepare('INSERT INTO final_pay(id,employee_id,data) VALUES(?,?,?)').run(record.id, e.id, JSON.stringify(record)); store.log(actor, 'compute-final-pay', 'final-pay', record.id, null, { employeeId: e.id, net: record.net, separationDate: v.separationDate }); });
    return record;
  }
  return result;
}
export function finalPayRecords(store, actor) {
  permit(actor, PAY);
  return store.db.prepare('SELECT data FROM final_pay ORDER BY rowid DESC').all().map(r => JSON.parse(r.data));
}
// Years added ahead on the 13th Month page ("+ Add year"): the latest one is kept in hr_counters.
const YEAR_KEY = 'thirteenth:last-year';
export const lastAddedYear = store => store.db.prepare('SELECT value FROM hr_counters WHERE key=?').get(YEAR_KEY)?.value || 0;
export function addThirteenthYear(store, actor) {
  permit(actor, PAY);
  return store.transaction(() => {
    const next = Math.max(Number(localToday().slice(0, 4)), lastAddedYear(store)) + 1;
    store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(YEAR_KEY, next);
    store.log(actor, 'add-year', 'thirteenth', String(next), null, { year: next });
    return { lastYear: next };
  });
}
// Everything the 13th Month page needs in one call.
export function thirteenthOverview(store, actor, year) {
  permit(actor, [...PAY, 'viewer']);
  if (!/^\d{4}$/.test(String(year))) throw new AppError('Choose a calendar year.');
  const state = store.read(), postedMonths = {};
  for (const e of state.employees) { const full = [...fullyPostedMonths(state, e.id)].filter(m => m.startsWith(year)); if (full.length) postedMonths[e.id] = full; }
  // Basic pay counted from finalized payroll, by month: shown on the page as soon as a payroll is final.
  const postedBasic = {}, postedCutoffs = {};
  for (const run of state.runs.filter(r => r.status === 'posted' && r.start.startsWith(year))) for (const row of run.rows) {
    const byMonth = (postedBasic[row.employeeId] ||= {}), m = run.start.slice(0, 7);
    byMonth[m] = r2((byMonth[m] || 0) + (row.applicableBasic || 0));
    ((postedCutoffs[row.employeeId] ||= {})[m] ||= []).push({ start: run.start, end: run.end, basic: r2(row.applicableBasic || 0) });
  }
  return {
    year, lastYear: lastAddedYear(store), ledger: thirteenthLedger(store, actor, year), postedMonths, postedBasic, postedCutoffs, canEncode: PAY.includes(actor.role),
    prior: state.priorEarnings.filter(p => p.month.startsWith(`${year}-`)),
    years: [...new Set([...state.runs.map(r => r.start.slice(0, 4)), ...state.priorEarnings.map(p => p.month.slice(0, 4))])],
  };
}
export function finalPayOverview(store, actor) {
  permit(actor, PAY);
  return { records: finalPayRecords(store, actor), leaveTypes: store.read().leaveTypes.map(t => ({ id: t.id, name: t.name })) };
}
