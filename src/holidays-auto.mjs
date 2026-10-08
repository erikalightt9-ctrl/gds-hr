// Automatic holiday calendar: the year ahead is filled in from the dates the law fixes or that can be calculated
// (Holy Week from Easter, National Heroes Day = last Monday of August, Chinese New Year from the lunar calendar).
// Eid'l Fitr and Eid'l Adha depend on the Islamic calendar and a proclamation each year, so HR adds them when
// announced. Every auto-added date says so in its basis, to be checked against that year's official proclamation.
import { randomUUID } from 'node:crypto';
import { saveRecord, permit } from './service.mjs';

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Easter Sunday (Anonymous Gregorian algorithm).
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}
const lastMondayOfAugust = y => { const d = new Date(Date.UTC(y, 8, 0)); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
// Chinese New Year (first day of the lunar year).
const CHINESE_NEW_YEAR = { 2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03', 2031: '2031-01-23', 2032: '2032-02-11', 2033: '2033-01-31', 2034: '2034-02-19', 2035: '2035-02-08', 2036: '2036-01-28', 2037: '2037-02-15', 2038: '2038-02-04', 2039: '2039-01-24', 2040: '2040-02-12' };

export function holidaysFor(year) {
  const y = Number(year), e = easter(y);
  const list = [
    [iso(y, 1, 1), "New Year's Day", 'regular'],
    ...(CHINESE_NEW_YEAR[y] ? [[CHINESE_NEW_YEAR[y], 'Chinese New Year', 'special']] : []),
    [iso(y, 2, 25), 'EDSA People Power Revolution Anniversary (special working day)', 'ordinary'],
    [addDays(e, -3), 'Maundy Thursday', 'regular'],
    [addDays(e, -2), 'Good Friday', 'regular'],
    [addDays(e, -1), 'Black Saturday', 'special'],
    [iso(y, 4, 9), 'Araw ng Kagitingan', 'regular'],
    [iso(y, 5, 1), 'Labor Day', 'regular'],
    [iso(y, 6, 2), 'Makati City Founding Anniversary (local)', 'special'],
    [iso(y, 6, 12), 'Independence Day', 'regular'],
    [iso(y, 8, 21), 'Ninoy Aquino Day', 'special'],
    [lastMondayOfAugust(y), 'National Heroes Day', 'regular'],
    [iso(y, 11, 1), "All Saints' Day", 'special'],
    [iso(y, 11, 2), "All Souls' Day", 'special'],
    [iso(y, 11, 30), 'Bonifacio Day', 'regular'],
    [iso(y, 12, 8), 'Feast of the Immaculate Conception of Mary', 'special'],
    [iso(y, 12, 24), 'Christmas Eve', 'special'],
    [iso(y, 12, 25), 'Christmas Day', 'regular'],
    [iso(y, 12, 30), 'Rizal Day', 'regular'],
    [iso(y, 12, 31), 'Last Day of the Year', 'special'],
  ];
  return list.map(([date, name, kind]) => ({ date, name, kind, basis: `Added automatically for ${y} (fixed by law / calculated); confirm with the official ${y} proclamation. Eid'l Fitr and Eid'l Adha are added when proclaimed.` }));
}

// Make sure this year and next year have holidays; a year that already has any dates is left as HR set it.
export function ensureHolidayYears(store, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())) {
  const actor = { username: 'system (automatic holiday calendar)', role: 'admin' };
  const added = [];
  for (const year of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
    if (store.read().holidays.some(h => h.date.startsWith(`${year}-`))) continue;
    store.transaction(() => { for (const h of holidaysFor(year)) saveRecord(store, actor, 'holidays', { id: randomUUID(), ...h }); });
    added.push(year);
  }
  return added;
}
// "+ Add year" on the holiday calendar: fills in the year after the latest one already in the calendar.
export function addNextHolidayYear(store, actor) {
  permit(actor, ['admin', 'hr']);
  const years = store.read().holidays.map(h => Number(h.date.slice(0, 4)));
  const year = Math.max(Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).slice(0, 4)), ...years) + 1;
  store.transaction(() => { for (const h of holidaysFor(year)) saveRecord(store, actor, 'holidays', { id: randomUUID(), ...h }); });
  store.log(actor, 'add-holiday-year', 'holidays', String(year), null, { year });
  return { year, added: holidaysFor(year).length };
}
