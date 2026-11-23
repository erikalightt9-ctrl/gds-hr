// Report library: Excel / CSV reports that staff maintain outside the generated reports (e.g. a downloaded report
// edited in Excel, or the company's own accounting template). Each file keeps every uploaded version; only the roles
// of its access level can list or download it; uploads are checked as readable spreadsheets; every action is audited.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { readSpreadsheet, MAX_UPLOAD_BYTES } from './xlsx-read.mjs';

export const CATEGORIES = ['Administrative', 'HR', 'Accounting', 'Operational'];
// Access levels: who may see and download the file (sensitive pay data → 'pay' or 'admin').
export const ACCESS = { hr: ['admin', 'hr', 'hr_staff'], pay: ['admin', 'hr', 'payroll'], management: ['admin', 'hr', 'payroll', 'viewer'], admin: ['admin'] };
export const ACCESS_LABELS = { hr: 'HR team', pay: 'HR managers & payroll (pay data)', management: 'HR, payroll & management', admin: 'Administrators only' };
const UPLOADERS = ['admin', 'hr', 'hr_staff', 'payroll'];
const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv' };

const ensure = store => store.db.exec('CREATE TABLE IF NOT EXISTS report_files (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS report_file_versions (id TEXT NOT NULL, version INTEGER NOT NULL, content BLOB NOT NULL, PRIMARY KEY(id, version));');
const read = (store, id) => { ensure(store); const row = store.db.prepare('SELECT data FROM report_files WHERE id=?').get(id); if (!row) throw new AppError('Report not found.', 404); return JSON.parse(row.data); };
const write = (store, f) => store.db.prepare('INSERT INTO report_files VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(f.id, JSON.stringify(f));
const canSee = (actor, f) => (ACCESS[f.access] || ACCESS.admin).includes(actor.role);
// An uploader may only give a file an access level they belong to (so nobody hides a file from themselves by mistake
// or shares pay data with the HR team).
const allowedLevels = actor => Object.keys(ACCESS).filter(k => ACCESS[k].includes(actor.role));

const uploadSchema = z.object({
  title: z.string().trim().min(3, 'Give the report a title.').max(150), category: z.enum(CATEGORIES), access: z.enum(Object.keys(ACCESS)), description: z.string().trim().max(1000).default(''),
  fileName: z.string().trim().min(1).max(180).regex(/\.(xlsx|csv)$/i, 'Upload an Excel workbook (.xlsx) or a CSV file.').refine(x => !/[\x00-\x1f\\/]/.test(x), 'Invalid file name.'),
  data: z.string().min(1).max(Math.ceil(MAX_UPLOAD_BYTES * 1.4)).regex(/^[A-Za-z0-9+/]*={0,2}$/), note: z.string().trim().max(500).default(''),
}).strict();
function inspect(fileName, bytes) {
  const sheets = readSpreadsheet(fileName, bytes);   // throws a readable message for damaged / unsupported files
  return sheets.map(s => ({ name: String(s.name).slice(0, 60), rows: s.rows.length, columns: Math.max(0, ...s.rows.map(r => r.length)) }));
}
function addVersion(store, actor, file, v) {
  const bytes = Buffer.from(v.data, 'base64'), sheets = inspect(v.fileName, bytes), version = (file.versions.at(-1)?.version || 0) + 1;
  store.db.prepare('INSERT INTO report_file_versions VALUES(?,?,?)').run(file.id, version, bytes);
  return { version, fileName: v.fileName, format: /\.csv$/i.test(v.fileName) ? 'csv' : 'xlsx', size: bytes.length, sheets, note: v.note, by: actor.username, at: new Date().toISOString() };
}
export function uploadReport(store, actor, input) {
  permit(actor, UPLOADERS);
  const v = uploadSchema.parse(input);
  if (!allowedLevels(actor).includes(v.access)) throw new AppError('Choose an access level that includes your own role.');
  ensure(store);
  return store.transaction(() => {
    const file = { id: randomUUID(), title: v.title, category: v.category, access: v.access, description: v.description, archived: false, createdBy: actor.username, createdAt: new Date().toISOString(), versions: [] };
    const saved = { ...file, versions: [addVersion(store, actor, file, v)] };
    write(store, saved);
    store.log(actor, 'upload', 'report-library', saved.id, null, { title: v.title, category: v.category, access: v.access, version: 1 });
    return saved;
  });
}
export function uploadVersion(store, actor, id, input) {
  permit(actor, UPLOADERS);
  const v = z.object({ fileName: uploadSchema.shape.fileName, data: uploadSchema.shape.data, note: z.string().trim().min(3, 'Say what changed in this version.').max(500) }).strict().parse(input);
  return store.transaction(() => {
    const file = read(store, id);
    if (!canSee(actor, file)) throw new AppError('Report not found.', 404);
    if (file.archived) throw new AppError('Restore the report before adding a version.');
    const saved = { ...file, versions: [...file.versions, addVersion(store, actor, file, v)] };
    write(store, saved);
    store.log(actor, 'upload-version', 'report-library', id, { version: file.versions.at(-1).version }, { title: file.title, version: saved.versions.at(-1).version, note: v.note });
    return saved;
  });
}
export function updateReportInfo(store, actor, id, input) {
  permit(actor, ['admin', 'hr', 'payroll']);
  const v = z.object({ title: uploadSchema.shape.title, category: uploadSchema.shape.category, access: uploadSchema.shape.access, description: uploadSchema.shape.description, archived: z.boolean().default(false) }).strict().parse(input);
  if (!allowedLevels(actor).includes(v.access)) throw new AppError('Choose an access level that includes your own role.');
  return store.transaction(() => {
    const file = read(store, id);
    if (!canSee(actor, file)) throw new AppError('Report not found.', 404);
    const saved = { ...file, ...v, updatedBy: actor.username, updatedAt: new Date().toISOString() };
    write(store, saved);
    store.log(actor, v.archived && !file.archived ? 'archive' : 'update', 'report-library', id, { title: file.title, category: file.category, access: file.access, archived: file.archived }, { title: v.title, category: v.category, access: v.access, archived: v.archived });
    return saved;
  });
}
export function listLibrary(store, actor) {
  permit(actor, [...new Set(Object.values(ACCESS).flat())]);
  ensure(store);
  return { files: store.db.prepare('SELECT data FROM report_files').all().map(r => JSON.parse(r.data)).filter(f => canSee(actor, f)).sort((a, b) => (b.versions.at(-1)?.at || '').localeCompare(a.versions.at(-1)?.at || '')),
    categories: CATEGORIES, access: Object.fromEntries(allowedLevels(actor).map(k => [k, ACCESS_LABELS[k]])), accessLabels: ACCESS_LABELS, canUpload: UPLOADERS.includes(actor.role) };
}
export function downloadReport(store, actor, id, versionInput) {
  const file = read(store, id);
  permit(actor, [...new Set(Object.values(ACCESS).flat())]);
  if (!canSee(actor, file)) throw new AppError('Report not found.', 404);
  const meta = versionInput ? file.versions.find(v => v.version === Number(versionInput)) : file.versions.at(-1);
  if (!meta) throw new AppError('Version not found.', 404);
  const row = store.db.prepare('SELECT content FROM report_file_versions WHERE id=? AND version=?').get(id, meta.version);
  store.log(actor, 'download', 'report-library', id, null, { title: file.title, version: meta.version });
  return { name: meta.fileName, type: MIME[meta.format], body: Buffer.from(row.content) };
}
