// Today's Celebrations: birthdays and work anniversaries worked out from the employee records for the current
// Asia/Manila date — nothing is posted by hand, so greetings appear at midnight and disappear the next midnight.
// Birthdays never reveal age, birth year or the full date.
import { localToday } from './profiles.mjs';
import { readSettings, activity } from './hr201.mjs';
import { AppError } from './service.mjs';

const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
// The month-day an occasion falls on this year (Feb 29 moves to Feb 28 or Mar 1 in common years, per Settings).
function occasionDay(date, year, leapRule) {
  const md = date.slice(5, 10);
  if (md === '02-29' && !isLeap(year)) return leapRule === 'mar1' ? '03-01' : '02-28';
  return md;
}
export function celebrationsOn(store, day = localToday()) {
  const year = Number(day.slice(0, 4)), md = day.slice(5, 10), leapRule = readSettings(store).celebrations?.leapDay || 'feb28';
  const out = [], seen = new Set();
  for (const e of store.read().employees) {
    if (e.archived || e.draft && !e.startDate) continue;
    if (activity(e, profileOf(store, e.id, 'employment')) !== 'Active') continue;
    const name = profileOf(store, e.id, 'personal').preferredName || displayName(e.name);
    const birth = profileOf(store, e.id, 'personal').birthDate;
    if (birth && occasionDay(birth, year, leapRule) === md && !seen.has(`${e.id}:birthday`)) {
      seen.add(`${e.id}:birthday`);
      out.push({ employeeId: e.id, name, occasion: 'birthday', title: `🎂 Happy Birthday, ${name}!`, message: 'Wishing you a wonderful birthday filled with happiness and a fantastic year ahead. From all of us, enjoy your special day!' });
    }
    if (e.startDate && occasionDay(e.startDate, year, leapRule) === md) {
      const years = year - Number(e.startDate.slice(0, 4));
      if (years >= 1 && !seen.has(`${e.id}:anniversary`)) {
        seen.add(`${e.id}:anniversary`);
        out.push({ employeeId: e.id, name, occasion: 'anniversary', years, title: `🎉 Happy ${years}-Year Work Anniversary, ${name}!`, message: `Thank you for your dedication and contributions over the past ${years} year${years === 1 ? '' : 's'}. We are happy to celebrate this milestone with you!` });
      }
    }
  }
  return { date: day, celebrations: out.sort((a, b) => a.name.localeCompare(b.name) || a.occasion.localeCompare(b.occasion)) };
}
// "Last, First Middle" → "First Last" for a friendlier greeting.
function displayName(name) {
  const [last, rest] = String(name).split(',').map(s => s.trim());
  const tc = s => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
  const given = rest ? rest.split(/\s+/) : [], first = given[0]?.endsWith('.') && given[1] ? `${given[0]} ${given[1]}` : given[0];   // "Ma. Rita"
  return rest ? `${tc(first)} ${tc(last)}` : name;
}
// A celebrant's profile photo may be shown to every signed-in user, but only on their celebration day.
export function celebrantPhoto(store, employeeId) {
  if (!celebrationsOn(store).celebrations.some(c => c.employeeId === employeeId)) throw new AppError('No photo.', 404);
  const row = store.db.prepare('SELECT metadata, content FROM employee_documents WHERE employee_id=?').all(employeeId).map(r => ({ meta: JSON.parse(r.metadata), content: r.content })).filter(r => r.meta.type === 'Photo' && r.meta.status === 'Active').sort((a, b) => b.meta.uploadedAt.localeCompare(a.meta.uploadedAt))[0];
  if (!row) throw new AppError('No photo.', 404);
  return row;
}
