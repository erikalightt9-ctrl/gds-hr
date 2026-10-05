// Trainings: sessions with schedule and venue, assigned participants, and three separate facts per participant:
// registration (assigned / confirmed / declined), attendance (pending / attended / absent) and completion
// (not started / completed / incomplete), plus an optional certificate filed in the employee's 201 documents.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday } from './profiles.mjs';
import { scopeEmployees } from './hr201.mjs';
import { HR_TEAM } from './roles.mjs';

const time = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]).default('');
const trainingSchema = z.object({
  title: z.string().trim().min(3, 'Give the training a title.').max(200), description: z.string().trim().max(5000).default(''), facilitator: z.string().trim().max(200).default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the training date.'), endDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''),
  startTime: time, endTime: time, venue: z.string().trim().max(300).default(''), meetingLink: z.union([z.string().trim().url().max(500).refine(v => /^https:\/\//.test(v), 'Use an https:// meeting link.'), z.literal('')]).default(''),
  required: z.boolean().default(false), audience: z.string().trim().max(300).default(''), status: z.enum(['scheduled', 'completed', 'cancelled']).default('scheduled'),
}).strict().refine(v => !v.endDate || v.endDate >= v.date, 'End date is before the start date.').refine(v => !v.startTime || !v.endTime || v.endDate > v.date || v.endTime > v.startTime, 'End time must be after the start time.');
const participantSchema = z.object({ registration: z.enum(['assigned', 'confirmed', 'declined']).optional(), attendance: z.enum(['pending', 'attended', 'absent']).optional(), completion: z.enum(['not-started', 'completed', 'incomplete']).optional(), certificateDocId: z.string().max(60).optional(), note: z.string().trim().max(500).optional() }).strict();
const read = (store, id) => { const row = store.db.prepare('SELECT data FROM trainings WHERE id=?').get(id); if (!row) throw new AppError('Training not found.', 404); return JSON.parse(row.data); };
const participants = (store, id) => store.db.prepare('SELECT employee_id, data FROM training_participants WHERE training_id=?').all(id).map(r => ({ employeeId: r.employee_id, ...JSON.parse(r.data) }));

export function saveTraining(store, actor, id, input) {
  permit(actor, HR_TEAM);
  const v = trainingSchema.parse(input);
  return store.transaction(() => {
    const existing = id ? read(store, id) : null;
    const training = { ...(existing || { id: randomUUID(), createdBy: actor.username, createdAt: new Date().toISOString() }), ...v, updatedBy: actor.username, updatedAt: new Date().toISOString() };
    store.db.prepare('INSERT INTO trainings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(training.id, JSON.stringify(training));
    store.log(actor, existing ? 'update' : 'create', 'trainings', training.id, existing, training);
    return training;
  });
}
export function deleteTraining(store, actor, id) {
  permit(actor, HR_TEAM);
  return store.transaction(() => {
    const t = read(store, id);
    if (participants(store, id).some(p => p.attendance === 'attended' || p.completion === 'completed')) throw new AppError('This training has attendance or completion records. Mark it cancelled instead.');
    store.db.prepare('DELETE FROM training_participants WHERE training_id=?').run(id); store.db.prepare('DELETE FROM trainings WHERE id=?').run(id);
    store.log(actor, 'delete', 'trainings', id, t, null); return { ok: true };
  });
}
export function assignParticipants(store, actor, id, input) {
  permit(actor, HR_TEAM);
  const { employeeIds, remove } = z.object({ employeeIds: z.array(z.string().max(80)).max(1000), remove: z.boolean().default(false) }).strict().parse(input);
  return store.transaction(() => {
    const t = read(store, id), known = new Set(store.read().employees.map(e => e.id)), now = new Date().toISOString();
    for (const employeeId of employeeIds) {
      if (!known.has(employeeId)) throw new AppError(`Unknown employee ${employeeId}.`);
      if (remove) {
        const p = participants(store, id).find(x => x.employeeId === employeeId);
        if (p && (p.attendance === 'attended' || p.completion === 'completed')) throw new AppError('Participants with attendance or completion records stay on the list.');
        store.db.prepare('DELETE FROM training_participants WHERE training_id=? AND employee_id=?').run(id, employeeId);
      } else if (!store.db.prepare('SELECT 1 FROM training_participants WHERE training_id=? AND employee_id=?').get(id, employeeId)) {
        store.db.prepare('INSERT INTO training_participants(training_id,employee_id,data) VALUES(?,?,?)').run(id, employeeId, JSON.stringify({ registration: 'assigned', attendance: 'pending', completion: 'not-started', assignedAt: now, assignedBy: actor.username, certificateDocId: '', note: '' }));
        store.notify(employeeId, `Training assigned: ${t.title} on ${t.date}${t.startTime ? ` ${t.startTime}` : ''}${t.required ? ' (required)' : ''}.`);
      }
    }
    store.log(actor, remove ? 'unassign' : 'assign', 'trainings', id, null, { employeeIds });
    return participants(store, id);
  });
}
export function updateParticipant(store, actor, id, employeeId, input) {
  const v = participantSchema.parse(input);
  const self = actor.role === 'employee';
  if (self) {
    if (actor.employeeId !== employeeId) throw new AppError('You can only respond for yourself.', 403);
    if (Object.keys(v).some(k => k !== 'registration') || v.registration === 'assigned') throw new AppError('You can confirm or decline your registration only.', 403);
  } else permit(actor, HR_TEAM);
  return store.transaction(() => {
    const t = read(store, id), row = store.db.prepare('SELECT data FROM training_participants WHERE training_id=? AND employee_id=?').get(id, employeeId);
    if (!row) throw new AppError('This employee is not assigned to the training.', 404);
    const before = JSON.parse(row.data), after = { ...before, ...v, updatedBy: actor.username, updatedAt: new Date().toISOString() };
    if (after.completion === 'completed' && after.attendance !== 'attended') throw new AppError('Mark attendance before recording completion.');
    if (after.attendance !== 'pending' && t.date > localToday()) throw new AppError('Attendance can be recorded on or after the training date.');
    if (v.certificateDocId) {
      const doc = store.db.prepare('SELECT metadata FROM employee_documents WHERE id=? AND employee_id=?').get(v.certificateDocId, employeeId);
      if (!doc) throw new AppError('Certificate not found in this employee\'s documents.');
    }
    store.db.prepare('UPDATE training_participants SET data=? WHERE training_id=? AND employee_id=?').run(JSON.stringify(after), id, employeeId);
    store.log(actor, 'participant-update', 'trainings', id, before, { employeeId, ...after });
    return after;
  });
}

// ---------- Views ----------
export function listTrainings(store, actor) {
  permit(actor, [...HR_TEAM, 'viewer', 'dept_manager']);
  const team = actor.role === 'dept_manager' ? new Set(scopeEmployees(store, actor).map(e => e.id)) : null;
  return store.db.prepare('SELECT data FROM trainings').all().map(r => JSON.parse(r.data)).map(t => {
    const ps = participants(store, t.id).filter(p => !team || team.has(p.employeeId));
    return { ...t, participants: ps.length, attended: ps.filter(p => p.attendance === 'attended').length, completed: ps.filter(p => p.completion === 'completed').length, confirmed: ps.filter(p => p.registration === 'confirmed').length };
  }).filter(t => !team || t.participants).sort((a, b) => b.date.localeCompare(a.date));
}
export function trainingDetail(store, actor, id) {
  permit(actor, [...HR_TEAM, 'viewer', 'dept_manager']);
  const t = read(store, id), team = actor.role === 'dept_manager' ? new Set(scopeEmployees(store, actor).map(e => e.id)) : null;
  const names = new Map(store.read().employees.map(e => [e.id, e]));
  return { ...t, canEdit: HR_TEAM.includes(actor.role), participants: participants(store, id).filter(p => !team || team.has(p.employeeId)).map(p => ({ ...p, name: names.get(p.employeeId)?.name || p.employeeId, department: names.get(p.employeeId)?.department || '' })) };
}
export function trainingsForEmployee(store, employeeId) {
  return store.db.prepare('SELECT training_id, data FROM training_participants WHERE employee_id=?').all(employeeId).map(r => {
    const t = JSON.parse(store.db.prepare('SELECT data FROM trainings WHERE id=?').get(r.training_id)?.data ?? 'null');
    return t ? { trainingId: t.id, title: t.title, date: t.date, startTime: t.startTime, endTime: t.endTime, venue: t.venue, meetingLink: t.meetingLink, required: t.required, status: t.status, facilitator: t.facilitator, ...JSON.parse(r.data) } : null;
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
}
export function myTrainings(store, actor) { permit(actor, ['employee']); return trainingsForEmployee(store, actor.employeeId); }
export function trainingSummary(store, actor) {
  const today = localToday();
  const upcoming = listTrainings(store, actor).filter(t => t.status === 'scheduled' && (t.endDate || t.date) >= today).sort((a, b) => a.date.localeCompare(b.date));
  return { upcoming: upcoming.length, next: upcoming.slice(0, 5).map(t => ({ id: t.id, title: t.title, date: t.date, startTime: t.startTime, participants: t.participants, required: t.required })) };
}
export function participationRows(store, actor) {
  const team = actor.role === 'dept_manager' ? new Set(scopeEmployees(store, actor).map(e => e.id)) : null;
  const names = new Map(store.read().employees.map(e => [e.id, e]));
  return listTrainings(store, actor).flatMap(t => participants(store, t.id).filter(p => !team || team.has(p.employeeId)).map(p => ({ training: t.title, date: t.date, required: t.required, status: t.status, employeeId: p.employeeId, name: names.get(p.employeeId)?.name || p.employeeId, department: names.get(p.employeeId)?.department || '', registration: p.registration, attendance: p.attendance, completion: p.completion })));
}
