// Data sheet review (HR) and Settings (System Administrator).
import { fmtDateTime } from './hr-common.js';

export function createAdmin(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  const SHEET = { submitted: ['Submitted', 'pending'], 'under-review': ['Under review', 'pending'], approved: ['Approved', ''], returned: ['Returned for correction', 'neutral'], rejected: ['Rejected', 'rejected'], draft: ['Draft', 'neutral'] };
  const LABELS = { firstName: 'First name', middleName: 'Middle name', lastName: 'Last name', suffix: 'Suffix', preferredName: 'Preferred name', sex: 'Sex', birthDate: 'Date of birth', birthPlace: 'Place of birth', civilStatus: 'Civil status', nationality: 'Nationality', personalEmail: 'Personal email', mobile: 'Mobile', currentAddress: 'Current address', permanentAddress: 'Permanent address', name: 'Contact person', relationship: 'Relationship', contact: 'Contact number', tin: 'TIN', sss: 'SSS', philHealth: 'PhilHealth', pagIbig: 'Pag-IBIG' };

  // ---------- Data sheet submissions ----------
  async function datasheets() {
    shell(heading('Data Sheet Submissions', 'Loading…') + '<div class="loading">Loading…</div>');
    const list = await api('/hr/datasheets'), open = list.filter(s => ['submitted', 'under-review'].includes(s.status));
    shell(heading('Data Sheet Submissions', 'Employees submit their information from their own account. Nothing changes in the employee record until HR approves it.') +
      `<section class="panel"><div class="panel-head"><h2>Waiting for review (${open.length})</h2></div>${table(['Employee', 'Department', 'Submitted', 'Status', ''], open.map(s => [esc(s.name), esc(s.department || '—'), fmtDateTime(s.submittedAt), badge(...SHEET[s.status]), `<button class="small primary" data-sheet="${s.id}">Review</button>`]), 'No data sheets waiting for review.')}</section>
      <section class="panel"><div class="panel-head"><h2>History</h2></div>${table(['Employee', 'Submitted', 'Decision', 'By', 'When', ''], list.filter(s => !open.includes(s)).map(s => [esc(s.name), fmtDateTime(s.submittedAt), badge(...SHEET[s.status]), esc(s.reviewedBy || '—'), fmtDateTime(s.reviewedAt), `<button class="small" data-sheet="${s.id}">View</button>`]), 'No decisions yet.')}</section>
      <p class="legend">Employees open <strong>My data sheet</strong> in their portal. New hires need an employee login first (Account &amp; access).</p>`);
    document.querySelector('.content').addEventListener('click', event => { const b = event.target.closest('[data-sheet]'); if (b) sheet(b.dataset.sheet); });
  }
  async function sheet(id) {
    try {
      const s = await api(`/hr/datasheets/${id}`), editable = ['submitted', 'under-review'].includes(s.status);
      const rows = Object.entries(s.fields).flatMap(([group, values]) => Object.entries(values).map(([k, v]) => [group, k, v, s.current[group]?.[k] ?? ''])).filter(([, , v, c]) => v || c);
      openDialog(`Data sheet · ${s.employee?.name || s.employeeId}`, `<div class="dialog-body"><p class="sub">${badge(...SHEET[s.status])} Submitted ${fmtDateTime(s.submittedAt)}</p>
        ${table(['Field', 'Submitted by employee', 'Current record', ''], rows.map(([, k, v, c]) => [esc(LABELS[k] || k), esc(v || '—'), esc(c || '—'), v && v !== c ? badge('Changed', 'pending') : '']))}
        <p class="legend">Approving copies only the fields the employee filled in. Blank fields never erase existing information. Employment details stay HR-controlled.</p>
        <h3 class="spaced">History</h3><ul class="plain-list">${s.history.map(h => `<li>${fmtDateTime(h.at)} · ${esc(h.by)} · ${esc(h.action)}${h.note ? ` — ${esc(h.note)}` : ''}</li>`).join('')}</ul></div>`,
        `<div class="dialog-foot">${editable ? `${s.status === 'submitted' ? '<button data-d="under-review">Mark under review</button>' : ''}<button data-d="return">Return for correction</button>${s.canApprove ? '<button class="danger" data-d="reject">Reject</button><button class="primary" data-d="approve">Approve and update record</button>' : '<span class="legend">An HR Manager approves.</span>'}` : ''}<button data-close>Close</button></div>`);
      dialog.querySelector('.dialog-foot').onclick = async event => {
        const d = event.target.closest('[data-d]')?.dataset.d; if (!d) return;
        const note = ['return', 'reject'].includes(d) ? window.prompt(d === 'return' ? 'What should the employee correct?' : 'Reason for rejecting:') : '';
        if (['return', 'reject'].includes(d) && !note) return;
        if (d === 'approve' && !window.confirm('Approve and copy these details into the employee record?')) return;
        try { await api(`/hr/datasheets/${id}/review`, { decision: d, note: note || '' }); toast({ approve: 'Approved. The employee record is updated.', return: 'Returned to the employee.', reject: 'Rejected.', 'under-review': 'Marked under review.' }[d]); dialog.close(); await datasheets(); } catch (error) { toast(error.message); }
      };
    } catch (error) { toast(error.message); }
  }

  // ---------- Settings ----------
  let settings = null;
  async function settingsPage() {
    shell(heading('Settings', 'Loading…') + '<div class="loading">Loading…</div>');
    settings = await api('/hr/settings');
    drawSettings();
  }
  const lines = list => esc(list.join('\n'));
  function reqRow(r, i) {
    return `<tr data-row="${i}"><td><input data-k="name" value="${esc(r.name)}" maxlength="200" aria-label="Requirement name"></td><td><input data-k="category" value="${esc(r.category)}" maxlength="80" aria-label="Category"></td>
      <td><input type="checkbox" data-k="required" ${r.required ? 'checked' : ''} aria-label="Required"></td><td><input type="checkbox" data-k="expires" ${r.expires ? 'checked' : ''} aria-label="Has expiry"></td><td><input type="checkbox" data-k="restricted" ${r.restricted ? 'checked' : ''} aria-label="Restricted"></td>
      <td><input type="number" min="0" max="365" data-k="dueDays" value="${r.dueDays ?? ''}" aria-label="Due days after hire" class="narrow"></td><td><input data-k="departments" value="${esc(r.departments.join(', '))}" placeholder="All" aria-label="Departments"></td><td><input data-k="classifications" value="${esc(r.classifications.join(', '))}" placeholder="All" aria-label="Classifications"></td>
      <td><button type="button" class="small danger" data-del="${i}">Remove</button></td></tr>`;
  }
  function drawSettings() {
    const s = settings, preview = `${[s.idFormat.prefix, s.idFormat.includeYear ? ctx.today().slice(0, 4) : ''].filter(Boolean).join('-')}${s.idFormat.prefix || s.idFormat.includeYear ? '-' : ''}${'1'.padStart(s.idFormat.digits, '0')}`;
    shell(heading('Settings', 'Company branding, lists, numbering, document requirements and reminders. Only System Administrators can change these.') +
      `<form id="settings-form">
      <section class="panel"><div class="panel-head"><h2>Company branding</h2></div><div class="panel-body form-grid">
        <label class="field">Company name<input name="company.name" required maxlength="120" value="${esc(s.company.name)}"></label>
        <label class="field">System title<input name="company.systemTitle" required maxlength="120" value="${esc(s.company.systemTitle)}"></label>
        <label class="field">Theme<select name="company.theme"><option value="gds" ${s.company.theme === 'gds' ? 'selected' : ''}>GDS red and gold</option><option value="forest" ${s.company.theme === 'forest' ? 'selected' : ''}>Forest green</option></select></label>
        <p class="legend">The logo is the GDS Capital logo file (public/gds-logo.png); replace that file to change it.</p></div></section>
      <section class="panel"><div class="panel-head"><h2>Lists</h2><span class="legend">One per line</span></div><div class="panel-body form-grid three">
        <label class="field">Departments<textarea name="departments" rows="8">${lines(s.departments)}</textarea></label>
        <label class="field">Positions<textarea name="positions" rows="8">${lines(s.positions)}</textarea></label>
        <label class="field">Employment classifications<textarea name="classifications" rows="8" required>${lines(s.classifications)}</textarea></label></div></section>
      <section class="panel"><div class="panel-head"><h2>Employee numbers</h2><span class="legend">Next new employee: <strong>${esc(preview)}</strong> (or the next free number)</span></div><div class="panel-body form-grid three">
        <label class="field">Prefix (letters / digits)<input name="idFormat.prefix" maxlength="10" pattern="[A-Z0-9]*" value="${esc(s.idFormat.prefix)}"></label>
        <label class="field">Digits<input type="number" name="idFormat.digits" min="3" max="8" value="${s.idFormat.digits}"></label>
        <label class="field check"><input type="checkbox" name="idFormat.includeYear" ${s.idFormat.includeYear ? 'checked' : ''}> Include year hired</label></div></section>
      <section class="panel"><div class="panel-head"><h2>201 document requirements</h2><button type="button" class="small" data-add-req>＋ Add requirement</button></div>
        <div class="scroll-table"><table class="settings-table"><thead><tr><th>Requirement</th><th>Category</th><th>Required</th><th>Expires</th><th>Restricted</th><th>Due (days after hire)</th><th>Only for departments</th><th>Only for classifications</th><th></th></tr></thead><tbody id="req-rows">${s.documentRequirements.map(reqRow).join('')}</tbody></table></div>
        <p class="panel-body legend">Restricted documents (e.g. medical or disciplinary) are visible only to HR Managers and Administrators. Leave departments / classifications blank to apply to everyone.</p></section>
      <section class="panel"><div class="panel-head"><h2>Uploads, reminders and fields</h2></div><div class="panel-body form-grid three">
        <label class="field">Photo size limit (MB)<input type="number" step="0.5" min="0.5" max="10" name="uploads.photoMB" value="${s.uploads.photoMB}"></label>
        <label class="field">Document size limit (MB)<input type="number" min="1" max="20" name="uploads.documentMB" value="${s.uploads.documentMB}"></label>
        <label class="field">Archived records kept for (years)<input type="number" min="1" max="50" name="retention.archivedYears" value="${s.retention.archivedYears}"><small>Archived records are never deleted automatically.</small></label>
        <label class="field">Probation reminder (days before)<input type="number" min="0" max="180" name="reminders.probationDays" value="${s.reminders.probationDays}"></label>
        <label class="field">Review reminder (days before)<input type="number" min="0" max="180" name="reminders.reviewDays" value="${s.reminders.reviewDays}"></label>
        <label class="field">Document expiry warning (days before)<input type="number" min="0" max="365" name="reminders.expiryDays" value="${s.reminders.expiryDays}"></label>
        <label class="field check"><input type="checkbox" name="optionalFields.birthPlace" ${s.optionalFields.birthPlace ? 'checked' : ''}> Ask for place of birth</label>
        <label class="field check"><input type="checkbox" name="optionalFields.civilStatus" ${s.optionalFields.civilStatus ? 'checked' : ''}> Ask for civil status</label>
        <label class="field check"><input type="checkbox" name="optionalFields.bloodType" ${s.optionalFields.bloodType ? 'checked' : ''}> Ask for blood type <small>Off by default. Turn on only for a defined purpose (e.g. emergency response); visible to HR Managers only.</small></label>
        <input type="hidden" name="reminders.memoDays" value="${s.reminders.memoDays}"></div>
        <p class="panel-body legend">Reminders appear in the dashboard and the 🔔 bell. Email notifications are not sent: no mail service is configured for reminders.</p></section>
      <section class="panel"><div class="panel-head"><h2>User roles</h2><button type="button" class="small" data-accounts>Manage accounts →</button></div><div class="panel-body">${table(['Role', 'Can do'], [['System Administrator', 'Everything, including Settings, accounts and role assignment'], ['HR Manager', 'Employee records, document requirements and reviews, approvals, memos, trainings, reports'], ['HR Staff', 'Add and update employees, upload and review non-restricted documents, draft memos, manage trainings; no settings, government numbers or restricted documents'], ['Department Manager', 'View their own department’s employees, memo acknowledgements and trainings (account linked to their employee record)'], ['Management', 'Dashboards and summary reports'], ['Payroll', 'Payroll, loans, deductions and contributions'], ['Employee', 'Own profile, data sheet, memos and trainings']].map(([r, d]) => [`<strong>${r}</strong>`, d]))}</div></section>
      <div class="sticky-save"><button class="primary">Save settings</button></div></form>`);
    const form = document.querySelector('#settings-form');
    form.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-add-req')) { collectReqs(); settings.documentRequirements.push({ id: '', name: '', category: 'Other', required: true, expires: false, restricted: false, dueDays: null, departments: [], classifications: [] }); drawSettings(); }
      if (b.dataset.del) { collectReqs(); settings.documentRequirements.splice(Number(b.dataset.del), 1); drawSettings(); }
      if (b.hasAttribute('data-accounts')) ctx.openAccounts();
    });
    form.onsubmit = async event => {
      event.preventDefault();
      collectReqs();
      const g = n => form.elements[n], list = n => g(n).value.split('\n').map(x => x.trim()).filter(Boolean);
      const next = { ...settings,
        company: { name: g('company.name').value.trim(), systemTitle: g('company.systemTitle').value.trim(), theme: g('company.theme').value },
        departments: list('departments'), positions: list('positions'), classifications: list('classifications'),
        idFormat: { prefix: g('idFormat.prefix').value.trim().toUpperCase(), includeYear: g('idFormat.includeYear').checked, digits: Number(g('idFormat.digits').value) },
        uploads: { photoMB: Number(g('uploads.photoMB').value), documentMB: Number(g('uploads.documentMB').value) },
        reminders: { probationDays: Number(g('reminders.probationDays').value), reviewDays: Number(g('reminders.reviewDays').value), expiryDays: Number(g('reminders.expiryDays').value), memoDays: Number(g('reminders.memoDays').value) },
        optionalFields: { birthPlace: g('optionalFields.birthPlace').checked, civilStatus: g('optionalFields.civilStatus').checked, bloodType: g('optionalFields.bloodType').checked },
        retention: { archivedYears: Number(g('retention.archivedYears').value) },
      };
      try { settings = await api('/hr/settings', next); toast('Settings saved.'); await ctx.reloadContext(); drawSettings(); } catch (error) { toast(error.message); }
    };
  }
  function collectReqs() {
    const slug = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'requirement';
    const taken = new Set();
    settings.documentRequirements = [...document.querySelectorAll('#req-rows tr')].map((tr, i) => {
      const old = settings.documentRequirements[i] || {}, v = k => tr.querySelector(`[data-k="${k}"]`);
      const name = v('name').value.trim();
      let id = old.id || slug(name); while (taken.has(id)) id = `${id}-2`; taken.add(id);
      const split = s => s.split(',').map(x => x.trim()).filter(Boolean);
      return { id, name, category: v('category').value.trim() || 'Other', required: v('required').checked, expires: v('expires').checked, restricted: v('restricted').checked, dueDays: v('dueDays').value === '' ? null : Number(v('dueDays').value), departments: split(v('departments').value), classifications: split(v('classifications').value) };
    });
  }
  return { datasheets, settingsPage };
}
