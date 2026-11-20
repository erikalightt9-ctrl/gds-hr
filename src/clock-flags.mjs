// Time in / out flags (Nov 20, 2026): an off-site entry whose note or address says the employee is at the office is
// flagged (it should have been an office time in on the office Wi-Fi, or the note is wrong); HR resolves any flag
// with a note (the punch itself never changes); and public addresses seen on office punches that the office GPS area
// accepted but the Wi-Fi check did not are suggested to the admin as office Wi-Fi to add.
import { z } from 'zod';
import { AppError, permit } from './service.mjs';

export const OFFICE_CLAIM = /\b(in|at|inside|nasa|sa)\s+(the\s+)?(office|opisina|head ?office|hq)\b|\bin the office\b/i;
export const officeClaimFlag = (mode, text) => (mode === 'outside' && OFFICE_CLAIM.test(String(text || '')) ? 'Off-site entry says the employee is in the office: check the location or use the office time in' : '');
const ensure = db => db.exec('CREATE TABLE IF NOT EXISTS clock_flag_notes (event_id TEXT PRIMARY KEY, data TEXT NOT NULL)');

// Flags of a stored event, with the office-claim flag added for entries made before it existed, and HR's resolution.
export function withFlagState(store, events) {
  ensure(store.db);
  const notes = new Map(store.db.prepare('SELECT event_id, data FROM clock_flag_notes').all().map(r => [r.event_id, JSON.parse(r.data)]));
  return events.map(e => {
    const claim = officeClaimFlag(e.attendanceType === 'offsite' || e.outOfOffice || e.mode === 'outside' ? 'outside' : 'office', `${e.reason || ''} ${e.purpose || ''}`);
    const flags = claim && !(e.flags || []).includes(claim) ? [...(e.flags || []), claim] : e.flags || [];
    return { ...e, flags, flagResolution: notes.get(e.id) || null };
  });
}
export function resolveClockFlag(store, actor, eventId, input) {
  permit(actor, ['admin', 'hr']);
  const { note } = z.object({ note: z.string().trim().min(5, 'Write how the flag was resolved (at least 5 characters).').max(1000) }).strict().parse(input);
  ensure(store.db);
  const row = store.db.prepare('SELECT data, employee_id FROM clock_events WHERE id=?').get(eventId);
  if (!row) throw new AppError('Time in / out record not found.', 404);
  const [event] = withFlagState(store, [JSON.parse(row.data)]);
  if (!event.flags.length) throw new AppError('This record has no flag to resolve.');
  const resolution = { note, by: actor.username, at: new Date().toISOString(), flags: event.flags };
  store.db.prepare('INSERT INTO clock_flag_notes(event_id,data) VALUES(?,?) ON CONFLICT(event_id) DO UPDATE SET data=excluded.data').run(eventId, JSON.stringify(resolution));
  store.log(actor, 'resolve-clock-flag', 'clock', eventId, event.flagResolution, resolution);
  return resolution;
}
// Public addresses that look like the office: seen on office punches accepted by the office GPS area, not yet saved.
export function suggestedOfficeAddresses(store, actor, days = 30) {
  permit(actor, ['admin']);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10), saved = new Set(store.db.prepare("SELECT ip FROM office_networks").all().map(r => r.ip));
  const seen = new Map();
  for (const r of store.db.prepare('SELECT employee_id, data FROM clock_events WHERE work_date >= ?').all(since)) {
    const e = JSON.parse(r.data), ip = String(e.network?.ip || '');
    if (!ip || saved.has(ip) || e.officeBy !== 'gps' || e.network?.verified) continue;
    const s = seen.get(ip) || { ip, punches: 0, employees: new Set(), last: '' };
    s.punches++; s.employees.add(r.employee_id); s.last = [s.last, e.workDate].sort().at(-1);
    seen.set(ip, s);
  }
  return [...seen.values()].filter(s => s.punches >= 3 && s.employees.size >= 2).map(s => ({ ip: s.ip, punches: s.punches, employees: s.employees.size, last: s.last })).sort((a, b) => b.punches - a.punches);
}
