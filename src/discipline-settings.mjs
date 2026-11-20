// Due process settings: who decides, the minimum response period, the hearing rule, the offenses list and the notice
// templates. Configurable by the System Administrator; defaults follow the twin-notice rule of procedural due process
// (Labor Code Art. 292(b), formerly 277(b), and its Implementing Rules; DOLE Department Order No. 147-15): a written notice stating
// the specific grounds with at least five (5) calendar days to answer, an opportunity to be heard (a hearing or
// conference when requested or when the circumstances require it), and a written notice of decision.
import { z } from 'zod';
import { AppError, permit } from './service.mjs';

export const SANCTIONS = ['No disciplinary action', 'Verbal warning', 'Written warning', 'Final written warning', 'Suspension', 'Demotion', 'Dismissal'];
export const SEVERITIES = ['Minor', 'Less serious', 'Serious', 'Grave'];
export const TEMPLATE_KEYS = ['incident', 'nte', 'hearing', 'decision', 'explanation'];
export const TEMPLATE_TITLES = { incident: 'Incident report', nte: 'Notice to Explain', hearing: 'Notice of Administrative Hearing', decision: 'Notice of Decision', explanation: 'Written explanation (employee)' };
export const PLACEHOLDERS = ['employeeName', 'employeeNumber', 'position', 'department', 'reference', 'today', 'incidentDate', 'incidentPlace', 'offense', 'description', 'reportedBy', 'issuingOfficer', 'allegations', 'rules', 'possibleSanction', 'responseDays', 'deadline', 'nteDate', 'hearingDate', 'hearingPlace', 'findings', 'sanction', 'sanctionDetail'];

const DEFAULT_TEMPLATES = {
  incident: `INCIDENT REPORT

Employee concerned: {{employeeName}} ({{employeeNumber}}), {{position}}, {{department}}
Date of incident: {{incidentDate}}
Place: {{incidentPlace}}
Reported by: {{reportedBy}}
Nature of the incident: {{offense}}

Description of what happened:
{{description}}

Prepared by: {{issuingOfficer}}`,
  nte: `This is to notify you that you are being asked to explain in writing why no disciplinary action should be taken against you for the following:

Date of incident: {{incidentDate}}
Alleged offense: {{offense}}
Company rule or policy concerned: {{rules}}

Facts and circumstances:
{{allegations}}

If proven, the offense may be subject to {{possibleSanction}} under the Company's Code of Conduct.

You have {{responseDays}} calendar days from your receipt of this notice, or until {{deadline}}, to submit your written explanation with any supporting documents. You may also ask for an administrative hearing or conference, where you may present your evidence and be assisted by a representative of your choice.

If no explanation is received within this period, the Company will decide on the matter on the basis of the available records.

This notice is not a finding of guilt. No penalty has been decided.`,
  hearing: `In connection with the Notice to Explain dated {{nteDate}} (reference {{reference}}), you are invited to an administrative hearing / conference on {{hearingDate}} at {{hearingPlace}}.

At the hearing you may explain your side, present witnesses and documents, and answer the evidence against you. You may be assisted by a representative or counsel of your choice.

If you cannot attend on this date, please tell HR at once so the hearing can be rescheduled. If you do not attend without a valid reason, the Company may decide on the matter on the basis of the available records.`,
  decision: `This refers to the Notice to Explain dated {{nteDate}} (reference {{reference}}) about the incident on {{incidentDate}} ({{offense}}).

After considering the facts, the evidence, your written explanation and the proceedings of the hearing (where one was held), management has found the following:

{{findings}}

DECISION: {{sanction}}{{sanctionDetail}}

This decision was reviewed and approved by authorized management. Please acknowledge receipt of this notice. A copy will be kept in your 201 file.`,
  explanation: `In reply to the Notice to Explain dated {{nteDate}} (reference {{reference}}), I respectfully explain the following:

`,
};
const DEFAULT_OFFENSES = [
  ['tardiness', 'Habitual tardiness', 'Minor'], ['absence', 'Absence without official leave (AWOL)', 'Less serious'], ['insubordination', 'Insubordination / willful disobedience of lawful orders', 'Serious'],
  ['neglect', 'Gross and habitual neglect of duties', 'Serious'], ['misconduct', 'Serious misconduct', 'Grave'], ['dishonesty', 'Fraud or willful breach of trust', 'Grave'],
  ['policy', 'Violation of company policy', 'Less serious'], ['harassment', 'Harassment / workplace misconduct', 'Grave'], ['property', 'Damage to or loss of company property', 'Serious'],
].map(([id, name, severity]) => ({ id, name, severity }));
export const DEFAULT_SETTINGS = { minResponseDays: 5, approverRoles: ['admin', 'viewer'], separateApprover: true, hearingForDismissal: true, offenses: DEFAULT_OFFENSES, templates: DEFAULT_TEMPLATES };

const settingsSchema = z.object({
  minResponseDays: z.coerce.number().int().min(5, 'The response period cannot be shorter than five (5) calendar days.').max(30),
  approverRoles: z.array(z.enum(['admin', 'hr', 'viewer'])).min(1, 'Choose at least one role that approves decisions.'),
  separateApprover: z.boolean(), hearingForDismissal: z.boolean(),
  offenses: z.array(z.object({ id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/), name: z.string().trim().min(3).max(120), severity: z.enum(SEVERITIES) }).strict()).min(1).max(100),
  templates: z.object(Object.fromEntries(TEMPLATE_KEYS.map(k => [k, z.string().trim().min(10, `The ${TEMPLATE_TITLES[k]} template is empty.`).max(10000)]))).strict(),
}).strict();

const ensure = store => store.db.exec('CREATE TABLE IF NOT EXISTS dp_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
export function readDpSettings(store) {
  ensure(store);
  const saved = JSON.parse(store.db.prepare("SELECT data FROM dp_settings WHERE id='settings'").get()?.data ?? '{}');
  return { ...DEFAULT_SETTINGS, ...saved, templates: { ...DEFAULT_TEMPLATES, ...(saved.templates || {}) } };
}
export function saveDpSettings(store, actor, input) {
  permit(actor, ['admin']);
  const v = settingsSchema.parse(input);
  if (new Set(v.offenses.map(o => o.id)).size !== v.offenses.length) throw new AppError('Two offenses have the same code.');
  ensure(store);
  return store.transaction(() => {
    const before = readDpSettings(store);
    store.db.prepare("INSERT INTO dp_settings VALUES('settings', ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(JSON.stringify(v));
    store.log(actor, 'update-settings', 'discipline', 'settings', { minResponseDays: before.minResponseDays, approverRoles: before.approverRoles, separateApprover: before.separateApprover, hearingForDismissal: before.hearingForDismissal, offenses: before.offenses.length }, { minResponseDays: v.minResponseDays, approverRoles: v.approverRoles, separateApprover: v.separateApprover, hearingForDismissal: v.hearingForDismissal, offenses: v.offenses.length });
    return readDpSettings(store);
  });
}
// {{name}} placeholders: ones not known yet (undefined, e.g. the deadline before the notice is issued) stay visible so a
// missing detail is noticed before issuing; an empty value prints as nothing.
export const fillTemplate = (text, vars) => String(text).replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
