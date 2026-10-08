// Work schedule per employee: time in, time out, regular hours, meal break, rest days and arrangement.
// The start time and rest days live on the employee record (payroll uses them); the rest on the attendance profile.
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { saveProfile } from './profiles.mjs';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const minutes = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

export function scheduleOf(store, employee) {
  const a = profileOf(store, employee.id, 'attendance'), rest = employee.restDays || [];
  const s = { start: employee.scheduleStart || '', end: a.scheduleEnd || '', hoursPerDay: a.hoursPerDay ?? null, mealBreakMinutes: a.mealBreakMinutes ?? null, restDays: rest, arrangement: a.arrangement || 'Office' };
  const text = s.start ? `${s.start}–${s.end || '?'}${s.hoursPerDay ? ` · ${s.hoursPerDay} h` : ''}${rest.length ? ` · ${rest.map(d => DAYS[d]).join(', ')} off` : ''}` : 'Not set';
  return { ...s, text };
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00.');
const scheduleSchema = z.object({
  start: time, end: time,
  hoursPerDay: z.coerce.number().min(1).max(16),
  mealBreakMinutes: z.coerce.number().int().min(0).max(240),
  restDays: z.array(z.coerce.number().int().min(0).max(6)).max(6),
  arrangement: z.enum(['Office', 'WFH', 'Hybrid']).default('Office'),
}).strict();

// Called from the 201 Edit record form (inside its save): only when a time in is given; HR Staff cannot change schedules.
export function applyScheduleFromForm(store, actor, id, input) {
  if (!input || !input.start || !['admin', 'hr', 'maker'].includes(actor.role)) return null;
  const blank = x => x === '' || x === null || x === undefined;
  const v = scheduleSchema.parse({ start: input.start, end: input.end || input.start, hoursPerDay: blank(input.hoursPerDay) ? 8 : input.hoursPerDay, mealBreakMinutes: blank(input.mealBreakMinutes) ? 60 : input.mealBreakMinutes, restDays: input.restDays || [], arrangement: input.arrangement || 'Office' });
  checkFits(v);
  const e = store.read().employees.find(x => x.id === id);
  saveRecord(store, actor, 'employees', { ...e, scheduleStart: v.start, restDays: [...new Set(v.restDays)].sort() }, { trusted: true });
  saveProfile(store, actor, id, 'attendance', { ...profileOf(store, id, 'attendance'), scheduleEnd: v.end, hoursPerDay: v.hoursPerDay, mealBreakMinutes: v.mealBreakMinutes, arrangement: v.arrangement });
  return v;
}
function checkFits(v) {
  let span = minutes(v.end) - minutes(v.start); if (span <= 0) span += 1440;   // overnight shifts end the next day
  if (v.hoursPerDay * 60 + v.mealBreakMinutes > span + 1) throw new AppError(`Work schedule: ${v.hoursPerDay} h of work plus a ${v.mealBreakMinutes}-minute meal break does not fit between ${v.start} and ${v.end}.`);
}
export function saveSchedule(store, actor, id, input) {
  permit(actor, ['admin', 'hr', 'maker']);
  const v = scheduleSchema.parse(input);
  let span = minutes(v.end) - minutes(v.start); if (span <= 0) span += 1440;   // overnight shifts end the next day
  if (v.hoursPerDay * 60 + v.mealBreakMinutes > span + 1) throw new AppError(`${v.hoursPerDay} h of work plus a ${v.mealBreakMinutes}-minute meal break does not fit between ${v.start} and ${v.end}.`);
  return store.transaction(() => {
    const e = store.read().employees.find(x => x.id === id);
    if (!e) throw new AppError('Employee not found.', 404);
    saveRecord(store, actor, 'employees', { ...e, scheduleStart: v.start, restDays: [...new Set(v.restDays)].sort() }, { trusted: true });
    saveProfile(store, actor, id, 'attendance', { ...profileOf(store, id, 'attendance'), scheduleEnd: v.end, hoursPerDay: v.hoursPerDay, mealBreakMinutes: v.mealBreakMinutes, arrangement: v.arrangement });
    return scheduleOf(store, store.read().employees.find(x => x.id === id));
  });
}
