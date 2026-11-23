// Due Process & Discipline: case list by status, disciplinary records, new case, prior records from paper files and
// (System Administrator) the due process settings and notice templates. The case itself opens in discipline-case.js.
import { fmtDate, fmtDateTime, readFile, who } from './hr-common.js';
import { createCaseView } from './discipline-case.js';

export function createDisciplinePage(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading, today } = ctx;
  let view = 'open', options = null, cases = [], search = '', employeeFilter = '';
  const caseView = createCaseView({ ...ctx, back: () => render(), options: () => options, fmtDate, fmtDateTime, readFile, who });
  const KIND = { pending: 'neutral', investigation: 'pending', awaiting: 'pending', evaluation: 'pending', resolved: '', closed: 'neutral' };
  const TABS = [['open', 'Open cases'], ['pending', 'Pending'], ['investigation', 'Under Investigation'], ['awaiting', 'Awaiting Explanation'], ['evaluation', 'For Evaluation'], ['resolved', 'Resolved'], ['closed', 'Closed'], ['records', 'Disciplinary records']];

  async function render(openId = null, filter = {}) {
    if (filter.employeeId !== undefined) { employeeFilter = filter.employeeId; view = filter.employeeId ? 'records' : view; }
    shell(heading('Due Process & Discipline', 'Loading…') + '<div class="loading">Loading…</div>');
    try { [options, cases] = await Promise.all([api('/discipline/options'), api('/discipline/cases')]); } catch (error) { shell(heading('Due Process & Discipline', '') + `<div class="notice">${esc(error.message)}</div>`); return; }
    if (openId) return caseView.open(openId);
    return draw();
  }
  const people = () => (ctx.employees() || []).filter(e => !e.archived).sort((a, b) => a.name.localeCompare(b.name));
  async function draw() {
    const count = id => (id === 'open' ? cases.filter(c => c.status !== 'closed').length : cases.filter(c => c.status === id).length);
    const tabs = [...TABS, ...(options.canSettings ? [['settings', 'Settings']] : [])];
    const actions = options.canManage ? '<button class="primary" data-dp-new>＋ New case</button>' : '';
    let body;
    if (view === 'records') body = await recordsView();
    else if (view === 'settings') body = settingsView(await api('/discipline/settings'));
    else {
      const q = search.toLowerCase(), list = cases.filter(c => (view === 'open' ? c.status !== 'closed' : c.status === view) && (!q || JSON.stringify(c).toLowerCase().includes(q)));
      body = `<section class="panel"><div class="toolbar"><label class="search">Search cases<input type="search" data-dp-search value="${esc(search)}" placeholder="Reference, employee, offense…"></label><span class="download-links"><a class="small download-link" href="/api/reports/discipline-cases.xlsx${view !== 'open' ? `?caseStatus=${view}` : ''}" download>Excel</a></span></div>
        ${table(['Reference', 'Employee', 'Incident', 'Offense', 'Status', 'Explanation due', 'Decision', ''], list.map(c => [esc(c.reference), `<span class="name">${esc(c.employeeName)}</span><small>${esc(c.position || '')}${c.department ? ` · ${esc(c.department)}` : ''}</small>`, fmtDate(c.incidentDate), `${esc(c.offense)}${c.severity ? `<br><small>${esc(c.severity)}</small>` : ''}`, badge(c.statusLabel, KIND[c.status]), c.deadline ? fmtDate(c.deadline) : '—', c.sanction ? `${esc(c.sanction)}<br><small>${esc({ draft: 'Draft', 'for-approval': 'For approval', approved: 'Approved', returned: 'Returned', issued: 'Issued' }[c.decisionStatus] || '')}</small>` : '—', `<button class="small" data-dp-open="${c.id}">Open</button>`]), 'No cases in this list.')}</section>`;
    }
    shell(heading('Due Process & Discipline', 'Incident reports, Notices to Explain, hearings, decisions and disciplinary records. Confidential: authorized HR personnel and management only.', actions) +
      `<div class="tabs rect-tabs dp-tabs">${tabs.map(([id, label]) => `<button data-dp-view="${id}" class="${id === view ? 'active' : ''}" aria-pressed="${id === view}">${esc(label)}${id !== 'records' && id !== 'settings' ? ` <span class="rect-count">${count(id)}</span>` : ''}</button>`).join('')}</div>${body}`);
    bind();
  }
  async function recordsView() {
    const rows = await api(`/discipline/records${employeeFilter ? `?employeeId=${encodeURIComponent(employeeFilter)}` : ''}`);
    return `<section class="panel"><div class="toolbar"><label class="field">Employee<select data-dp-employee><option value="">All employees</option>${people().map(e => `<option value="${esc(e.id)}" ${e.id === employeeFilter ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>${options.canManage ? '<button class="small" data-dp-prior>＋ Record earlier action (paper files)</button>' : ''}<span class="download-links"><a class="small download-link" href="/api/reports/discipline-records.xlsx" download>Excel</a></span></div>
      ${table(['Employee', 'Action', 'Date', 'Offense', 'Reference', 'Suspension', 'Source', 'Remarks'], rows.map(r => [esc(r.employeeName), badge(r.type, ['Dismissal', 'Suspension', 'Final written warning'].includes(r.type) ? 'rejected' : 'pending'), fmtDate(r.date), esc(r.offense), r.caseId ? `<button class="link-button" data-dp-open="${r.caseId}">${esc(r.reference)}</button>` : esc(r.reference || '—'), r.suspensionDays ? `${r.suspensionDays} day(s)${r.effectiveFrom ? `<br><small>${fmtDate(r.effectiveFrom)} – ${fmtDate(r.effectiveTo)}</small>` : ''}` : '—', r.source === 'case' ? 'Due process case' : 'Encoded from paper files', esc(r.remarks || '')]), 'No disciplinary actions on record.')}</section>`;
  }
  function settingsView(s) {
    const roles = [['admin', 'System Administrator'], ['hr', 'HR Manager'], ['viewer', 'Management']];
    return `<form id="dp-settings" class="panel"><div class="panel-head"><h2>Due process settings</h2><span class="legend">Defaults follow the twin-notice rule (Labor Code Art. 292(b); DOLE D.O. 147-15)</span></div><div class="panel-body"><div id="dp-settings-error" class="form-error hidden" role="alert"></div><div class="form-grid">
      <label class="field">Minimum days to answer a Notice to Explain<input type="number" name="minResponseDays" min="5" max="30" value="${s.minResponseDays}"><small>At least five (5) calendar days from receipt.</small></label>
      <fieldset class="field"><legend>Roles that approve decisions</legend>${roles.map(([id, label]) => `<label class="check"><input type="checkbox" name="approverRoles" value="${id}" ${s.approverRoles.includes(id) ? 'checked' : ''}> ${label}</label>`).join('')}</fieldset>
      <label class="field check"><input type="checkbox" name="separateApprover" ${s.separateApprover ? 'checked' : ''}> The approver must be someone other than the person who prepared the decision</label>
      <label class="field check"><input type="checkbox" name="hearingForDismissal" ${s.hearingForDismissal ? 'checked' : ''}> A dismissal needs a hearing or conference on record (held, waived or not attended)</label>
      <label class="field full">Offenses (one per line: code | name | Minor / Less serious / Serious / Grave)<textarea name="offenses" rows="9">${esc(s.offenses.map(o => `${o.id} | ${o.name} | ${o.severity}`).join('\n'))}</textarea></label>
      ${Object.entries(s.templates).map(([k, v]) => `<label class="field full">${esc(options.templateTitles[k])} template<textarea name="tpl-${k}" rows="8">${esc(v)}</textarea></label>`).join('')}
      <p class="legend full">Placeholders: {{employeeName}}, {{position}}, {{department}}, {{incidentDate}}, {{offense}}, {{allegations}}, {{rules}}, {{possibleSanction}}, {{responseDays}}, {{deadline}}, {{nteDate}}, {{hearingDate}}, {{hearingPlace}}, {{findings}}, {{sanction}}, {{sanctionDetail}}, {{reference}}, {{issuingOfficer}}.</p>
    </div></div><div class="dialog-foot"><button class="primary">Save settings</button></div></form>`;
  }
  function bind() {
    const content = document.querySelector('.content');
    content.onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.dataset.dpView) { view = b.dataset.dpView; draw(); }
      if (b.dataset.dpOpen) caseView.open(b.dataset.dpOpen);
      if (b.hasAttribute('data-dp-new')) newCase();
      if (b.hasAttribute('data-dp-prior')) priorAction();
    };
    const s = content.querySelector('[data-dp-search]');
    if (s) s.onchange = () => { search = s.value; draw(); };
    const e = content.querySelector('[data-dp-employee]');
    if (e) e.onchange = () => { employeeFilter = e.value; draw(); };
    const form = content.querySelector('#dp-settings');
    if (form) form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements, err = form.querySelector('#dp-settings-error');
      try {
        const offenses = f.offenses.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [id, name, severity] = l.split('|').map(x => x.trim()); return { id, name, severity }; });
        await api('/discipline/settings', { minResponseDays: Number(f.minResponseDays.value), approverRoles: [...form.querySelectorAll('[name=approverRoles]:checked')].map(x => x.value), separateApprover: f.separateApprover.checked, hearingForDismissal: f.hearingForDismissal.checked, offenses, templates: Object.fromEntries(Object.keys(options.templateTitles).map(k => [k, f[`tpl-${k}`].value])) });
        toast('Due process settings saved.'); render();
      } catch (error) { err.textContent = error.message; err.classList.remove('hidden'); err.scrollIntoView({ block: 'nearest' }); }
    };
  }
  function newCase() {
    caseView.incidentForm(null, async ({ evidenceFiles = [], ...value }) => { const c = await api('/discipline/cases', value); for (const f of evidenceFiles) await api(`/discipline/cases/${c.id}/files`, f); toast(`Case ${c.reference} opened${evidenceFiles.length ? ` with ${evidenceFiles.length} evidence file${evidenceFiles.length === 1 ? '' : 's'}` : ''}.`); dialog.close(); await render(c.id); });
  }
  function priorAction() {
    openDialog('Record an earlier disciplinary action', `<form id="dp-prior"><div class="dialog-body"><div id="dp-prior-error" class="form-error hidden" role="alert"></div><p class="sub">For actions taken before the system (paper memos in the 201 folder). New actions are recorded by closing a case.</p><div class="form-grid">
      <label class="field full">Employee<select name="employeeId" required><option value="">Choose…</option>${people().map(e => `<option value="${esc(e.id)}">${esc(e.name)} (${esc(e.id)})</option>`).join('')}</select></label>
      <label class="field">Action<select name="type">${options.sanctions.filter(x => x !== 'No disciplinary action').map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
      <label class="field">Date<input type="date" name="date" required max="${today()}"></label>
      <label class="field">Offense<input name="offense" required maxlength="200"></label><label class="field">Memo / reference no.<input name="reference" maxlength="80"></label>
      <label class="field">Suspension days<input type="number" name="suspensionDays" min="0" max="30" value="0"></label>
      <label class="field full">Source and remarks<textarea name="remarks" rows="3" required maxlength="2000" placeholder="e.g. Written warning memo dated … kept in the 201 folder"></textarea></label>
    </div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`);
    const form = dialog.querySelector('#dp-prior');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements;
      try { await api('/discipline/records', { employeeId: f.employeeId.value, type: f.type.value, date: f.date.value, offense: f.offense.value, reference: f.reference.value, suspensionDays: Number(f.suspensionDays.value || 0), remarks: f.remarks.value }); dialog.close(); toast('Recorded.'); view = 'records'; draw(); }
      catch (error) { const err = form.querySelector('#dp-prior-error'); err.textContent = error.message; err.classList.remove('hidden'); }
    };
  }
  return { render };
}
