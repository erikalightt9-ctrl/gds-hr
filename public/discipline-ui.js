// Due Process & Discipline: case list by status, disciplinary records, new case, prior records from paper files and
// (System Administrator) the due process settings and notice templates. The case itself opens in discipline-case.js.
import { fmtDate, fmtDateTime, readFile, who } from './hr-common.js';
import { createCaseView } from './discipline-case.js';

export function createDisciplinePage(ctx) {
  const { api, esc, badge, toast, openDialog, dialog, shell, heading, today } = ctx;
  let view = 'open', options = null, cases = [], search = '', employeeFilter = '', recordCount = null;
  const caseView = createCaseView({ ...ctx, back: () => render(), options: () => options, fmtDate, fmtDateTime, readFile, who });
  const KIND = { pending: 'neutral', investigation: 'pending', awaiting: 'pending', evaluation: 'pending', resolved: '', closed: 'neutral' };
  const TABS = [['open', 'Open cases'], ['pending', 'Pending'], ['investigation', 'Under Investigation'], ['awaiting', 'Awaiting Explanation'], ['evaluation', 'For Evaluation'], ['resolved', 'Resolved'], ['closed', 'Closed'], ['records', 'Disciplinary records']];

  async function render(openId = null, filter = {}) {
    if (filter.employeeId !== undefined) { employeeFilter = filter.employeeId; view = filter.employeeId ? 'records' : view; }
    shell(heading('Due Process & Discipline', 'Loading…') + '<div class="loading">Loading…</div>');
    try { let records; [options, cases, records] = await Promise.all([api('/discipline/options'), api('/discipline/cases'), api('/discipline/records').catch(() => null)]); recordCount = Array.isArray(records) ? records.length : null; } catch (error) { shell(heading('Due Process & Discipline', '') + `<div class="notice">${esc(error.message)}</div>`); return; }
    if (openId) return caseView.open(openId);
    return draw();
  }
  const people = () => (ctx.employees() || []).filter(e => !e.archived).sort((a, b) => a.name.localeCompare(b.name));
  // Nov 25, 2026 design: red hero with gavel, status tiles (the lists), search panel, table, empty state.
  const ic = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const TILE = {
    open: ['amber', ic('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path d="M3 10h18l-2 9H5z"/>')],
    pending: ['rose', ic('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6M12 2v3"/>')],
    investigation: ['blue', ic('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/>')],
    awaiting: ['violet', ic('<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>')],
    evaluation: ['orange', ic('<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>')],
    resolved: ['green', ic('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>')],
    closed: ['grey', ic('<rect x="3.5" y="4" width="17" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>')],
    records: ['lilac', ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>')],
    settings: ['grey', ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>')],
  };
  const GAVEL = '<svg viewBox="0 0 140 110" aria-hidden="true"><defs><linearGradient id="dpWood" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#b5683a"/><stop offset="1" stop-color="#5e2c12"/></linearGradient><linearGradient id="dpGold" x1="0" x2="1"><stop offset="0" stop-color="#f6d58a"/><stop offset="1" stop-color="#b98a2c"/></linearGradient></defs><ellipse cx="78" cy="98" rx="46" ry="8" fill="#5e2c12" opacity=".25"/><rect x="40" y="80" width="76" height="14" rx="4" fill="url(#dpWood)"/><rect x="48" y="72" width="60" height="10" rx="3" fill="#8a4720"/><rect x="48" y="76" width="60" height="3" fill="url(#dpGold)"/><g transform="rotate(-32 58 40)"><rect x="54" y="32" width="70" height="9" rx="4" fill="url(#dpWood)"/><rect x="20" y="14" width="40" height="44" rx="8" fill="url(#dpWood)"/><rect x="18" y="20" width="44" height="6" rx="2" fill="url(#dpGold)"/><rect x="18" y="46" width="44" height="6" rx="2" fill="url(#dpGold)"/></g></svg>';
  const EMPTY = '<svg viewBox="0 0 120 100" aria-hidden="true"><path d="M14 30a6 6 0 0 1 6-6h24l8 8h44a6 6 0 0 1 6 6v6H14z" fill="#a9bde8"/><path d="M10 44h92l-8 40a6 6 0 0 1-6 5H22a6 6 0 0 1-6-5z" fill="#c9d7f3"/><circle cx="78" cy="64" r="14" fill="#fff" stroke="#4867b8" stroke-width="5"/><path d="m88 74 14 14" stroke="#4867b8" stroke-width="7" stroke-linecap="round"/></svg>';
  async function draw() {
    const count = id => (id === 'records' ? recordCount : id === 'open' ? cases.filter(c => c.status !== 'closed').length : cases.filter(c => c.status === id).length);
    const tabs = [...TABS, ...(options.canSettings ? [['settings', 'Settings']] : [])];
    let body;
    if (view === 'records') body = await recordsView();
    else if (view === 'settings') body = settingsView(await api('/discipline/settings'));
    else {
      const q = search.toLowerCase(), list = cases.filter(c => (view === 'open' ? c.status !== 'closed' : c.status === view) && (!q || JSON.stringify(c).toLowerCase().includes(q)));
      body = `<section class="dp-panel"><label class="dp-search-label" for="dp-search">Search Cases</label><div class="dp-tools"><span class="dp-search">${ic('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>')}<input id="dp-search" type="search" data-dp-search value="${esc(search)}" placeholder="Reference, employee, offense…"></span><a class="dp-excel" href="/api/reports/discipline-cases.xlsx${view !== 'open' ? `?caseStatus=${view}` : ''}" download>${ic('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>')}Excel</a></div>
        <div class="dp-table"><table><thead><tr><th>Reference</th><th>Employee</th><th>Incident</th><th>Offense</th><th>Status</th><th>Explanation due</th><th>Decision</th><th></th></tr></thead><tbody>
        ${list.length ? list.map(c => `<tr><td><button class="link-button" data-dp-open="${c.id}">${esc(c.reference)}</button></td><td><span class="name">${esc(c.employeeName)}</span><small>${esc(c.position || '')}${c.department ? ` · ${esc(c.department)}` : ''}</small></td><td>${fmtDate(c.incidentDate)}</td><td>${esc(c.offense)}${c.severity ? `<br><small>${esc(c.severity)}</small>` : ''}</td><td>${badge(c.statusLabel, KIND[c.status])}</td><td>${c.deadline ? fmtDate(c.deadline) : '—'}</td><td>${c.sanction ? `${esc(c.sanction)}<br><small>${esc({ draft: 'Draft', 'for-approval': 'For approval', approved: 'Approved', returned: 'Returned', issued: 'Issued' }[c.decisionStatus] || '')}</small>` : '—'}</td><td><button class="small dp-open" data-dp-open="${c.id}">Open</button></td></tr>`).join('') : ''}
        </tbody></table>${list.length ? '' : `<div class="dp-empty">${EMPTY}<strong>Nothing here yet</strong><span>${search ? 'No cases match this search.' : 'No cases in this list.'}</span></div>`}</div></section>`;
    }
    shell(`<div class="dp"><section class="dp-hero"><span class="dp-gavel">${GAVEL}</span><div class="dp-hello"><span>People Operations</span><h1>Due Process &amp; Discipline</h1><p>Incident reports, Notices to Explain, hearings, decisions and disciplinary records.<br>Confidential: authorized HR personnel and management only.</p></div>${options.canManage ? `<button class="dp-new" data-dp-new>${ic('<path d="M12 5v14M5 12h14"/>')}New Case</button>` : ''}</section>
      <div class="dp-tiles" role="tablist">${tabs.map(([id, label]) => { const [tone, icon] = TILE[id] || TILE.closed; const n = id === 'settings' ? null : count(id); return `<button role="tab" class="dp-tile dp-${tone}${id === view ? ' on' : ''}" data-dp-view="${id}" aria-selected="${id === view}"><i>${icon}</i><span>${esc(label === 'Open cases' ? 'Open Cases' : label === 'Disciplinary records' ? 'Disciplinary Records' : label)}</span>${n === null ? '' : `<strong>${n ?? '—'}</strong>`}</button>`; }).join('')}</div>
      ${body}</div>`);
    bind();
  }
  // Disciplinary records (Nov 26, 2026): same panel as the case lists: employee filter in the search row, earlier-action
  // button, Excel, light-blue table header and the folder empty state.
  async function recordsView() {
    const rows = await api(`/discipline/records${employeeFilter ? `?employeeId=${encodeURIComponent(employeeFilter)}` : ''}`);
    return `<section class="dp-panel"><label class="dp-search-label" for="dp-employee">Employee</label><div class="dp-tools"><span class="dp-search dp-select">${ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>')}<select id="dp-employee" data-dp-employee><option value="">All employees</option>${people().map(e => `<option value="${esc(e.id)}" ${e.id === employeeFilter ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></span>${options.canManage ? `<button class="dp-prior" data-dp-prior>${ic('<path d="M12 5v14M5 12h14"/>')}Record earlier action (paper files)</button>` : ''}<a class="dp-excel" href="/api/reports/discipline-records.xlsx" download>${ic('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>')}Excel</a></div>
      <div class="dp-table"><table><thead><tr><th>Employee</th><th>Action</th><th>Date</th><th>Offense</th><th>Reference</th><th>Suspension</th><th>Source</th><th>Remarks</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><span class="name">${esc(r.employeeName)}</span></td><td>${badge(r.type, ['Dismissal', 'Suspension', 'Final written warning'].includes(r.type) ? 'rejected' : 'pending')}</td><td>${fmtDate(r.date)}</td><td>${esc(r.offense)}</td><td>${r.caseId ? `<button class="link-button" data-dp-open="${r.caseId}">${esc(r.reference)}</button>` : esc(r.reference || '—')}</td><td>${r.suspensionDays ? `${r.suspensionDays} day(s)${r.effectiveFrom ? `<br><small>${fmtDate(r.effectiveFrom)} – ${fmtDate(r.effectiveTo)}</small>` : ''}` : '—'}</td><td>${r.source === 'case' ? 'Due process case' : 'Encoded from paper files'}</td><td>${esc(r.remarks || '')}</td></tr>`).join('')}
      </tbody></table>${rows.length ? '' : `<div class="dp-empty">${EMPTY}<strong>Nothing here yet</strong><span>No disciplinary actions on record.</span></div>`}</div></section>`;
  }
  // Settings (Nov 26, 2026 design): two navy-banded panels in one form. 'Document Settings' (minimum days, approver roles,
  // the two rules, offenses, note, Reset / Save Settings) and 'Templates' (one card per notice template with an icon and
  // a short purpose; the text is shown as printed and Edit opens it for typing; Preview highlights the placeholders;
  // placeholder chips insert at the cursor). Both Save buttons send the same request as before; Reset reloads.
  const PLACEHOLDERS = ['employeeName', 'employeeNumber', 'position', 'department', 'reference', 'today', 'incidentDate', 'incidentPlace', 'offense', 'description', 'reportedBy', 'issuingOfficer', 'allegations', 'rules', 'possibleSanction', 'responseDays', 'deadline', 'nteDate', 'hearingDate', 'hearingPlace', 'findings', 'sanction', 'sanctionDetail'];
  const TPL_INFO = { incident: ['Use this template to document employee incidents, including the date, place and nature of the incident.', 'alert'], nte: ['Notify the employee to explain the circumstances of the incident.', 'search'], hearing: ['Invite the employee to an administrative hearing.', 'gavel'], decision: ['Inform the employee of the decision after the facts and the explanation are considered.', 'scale'], explanation: ['The employee\'s written reply to the Notice to Explain.', 'pen'] };
  function settingsView(s) {
    const roles = [['admin', 'System Administrator'], ['hr', 'HR Manager'], ['viewer', 'Management']];
    const g = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const I = { eye: g('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'), info: g('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'), save: g('<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'), reset: g('<path d="M4 4v6h6"/><path d="M5 10a8 8 0 1 1 1.6 6.4"/>'), edit: g('<path d="M4 20h4L19 9l-4-4L4 16Z"/>'), shield: g('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>'), list: g('<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>'), cal: g('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'),
      alert: g('<circle cx="9" cy="7" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6 1.2 0 2.3.3 3.2.8"/><path d="M17.5 12 13 20h9Z"/><path d="M17.5 15.5v1.8M17.5 18.7v.01"/>'), search: g('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M14 3v5h5M8 9h3M8 13h4"/><circle cx="16.5" cy="16.5" r="3.5"/><path d="m19 19 2.5 2.5"/>'), gavel: g('<path d="m14 4 6 6M11 7l6 6M12.5 5.5l-4 4 6 6 4-4ZM9.5 12.5 3 19M4 21h9"/>'), scale: g('<path d="M12 3v18M6 21h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0ZM19 7l-3 7a3 3 0 0 0 6 0Z"/>'), pen: g('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="M13 7l4 4"/>') };
    const head = (icon, title, sub) => `<header class="dps-band"><span class="dps-band-ico">${icon}</span><div><h2>${title}</h2><p>${sub}</p></div></header>`;
    const settings = `<section class="dps-panel">${head('<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M28 4H11a4 4 0 0 0-4 4v32a4 4 0 0 0 4 4h12"/><path d="M28 4v10h10v8M14 16h8M14 24h10M14 32h6"/><circle cx="35" cy="35" r="5"/><path d="M35 25v3M35 42v3M25 35h3M42 35h3M28 28l2 2M40 40l2 2M28 42l2-2M40 30l2-2"/></svg>', 'Document Settings', 'Configure the information and options for generated documents. Defaults follow the twin-notice rule (Labor Code Art. 292(b); DOLE D.O. 147-15).')}
      <div class="dps-in"><div class="dps-grid">
        <label class="dps-field dps-box"><span>Minimum days to answer a Notice to Explain</span><span class="dps-num"><input type="number" name="minResponseDays" min="5" max="30" value="${s.minResponseDays}">${I.cal}</span><small>At least five (5) calendar days from receipt.</small></label>
        <fieldset class="dps-field dps-box dps-roles"><legend>${I.shield}Roles that approve decisions</legend>${roles.map(([id, label]) => `<label class="dps-check"><input type="checkbox" name="approverRoles" value="${id}" ${s.approverRoles.includes(id) ? 'checked' : ''}> ${label}</label>`).join('')}</fieldset>
        <label class="dps-check dps-rule"><input type="checkbox" name="separateApprover" ${s.separateApprover ? 'checked' : ''}> <b>The approver must be someone other than the person who prepared the decision</b></label>
        <label class="dps-check dps-rule"><input type="checkbox" name="hearingForDismissal" ${s.hearingForDismissal ? 'checked' : ''}> <span><b>A dismissal needs a hearing or conference on record</b> (held, waived or not attended).</span></label></div>
        <section class="dps-off"><h3>${I.list}Offenses</h3><label class="dps-field"><span class="dps-hint">One per line: code | name | Minor / Less serious / Serious / Grave</span><textarea name="offenses" rows="9">${esc(s.offenses.map(o => `${o.id} | ${o.name} | ${o.severity}`).join('\n'))}</textarea></label></section>
        <p class="dps-noteb">${I.info}<span><b>Note</b>These settings are used in generating documents and applying disciplinary actions. Please review carefully before saving.</span></p>
        <div class="dps-foot"><button type="button" class="dps-cancel" data-dps-cancel>${I.reset}Reset</button><button class="dps-save">${I.save}Save Settings</button></div></div></section>`;
    const tpl = Object.entries(s.templates).map(([k, v]) => { const [sub, icon] = TPL_INFO[k] || ['', 'pen']; return `<section class="dps-tpl"><header><span class="dps-tpl-ico">${I[icon]}</span><div><h3>${esc(options.templateTitles[k])} Template</h3><p>${sub}</p></div><span class="dps-tpl-tools"><button type="button" class="dps-preview" data-dps-preview="${k}">${I.eye}Preview</button><button type="button" class="dps-edit" data-dps-edit="${k}">${I.edit}Edit</button></span></header><div class="dps-tpl-text" data-dps-show="${k}">${esc(v)}</div><textarea name="tpl-${k}" rows="9" data-dps-tpl="${k}" hidden>${esc(v)}</textarea></section>`; }).join('');
    const templates = `<section class="dps-panel">${head('<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="7" width="30" height="37" rx="4"/><path d="M18 4h12v7H18zM16 20h16M16 28h16M16 36h10"/></svg>', 'Notice Templates', 'Create, edit and manage the due process notice templates for your organization.')}
      <div class="dps-in">${tpl}<p class="dps-chips">${I.info}<b>Placeholders (click to insert into the template being edited):</b>${PLACEHOLDERS.map(p => `<button type="button" class="dps-chip" data-dps-chip="${p}">{{${p}}}</button>`).join('')}</p>
        <div class="dps-foot dps-foot-note"><p>${I.info}You can edit each template and save your changes.</p><span><button type="button" class="dps-cancel" data-dps-cancel>${I.reset}Reset</button><button class="dps-save">${I.save}Save Templates</button></span></div></div></section>`;
    return `<form id="dp-settings" class="dps"><div id="dp-settings-error" class="form-error hidden" role="alert"></div>${settings}${templates}</form>`;
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
    if (form) {
      let lastTpl = null;
      form.addEventListener('focusin', e => { if (e.target.matches('[data-dps-tpl]')) lastTpl = e.target; });
      form.addEventListener('click', e => {
        const chip = e.target.closest('[data-dps-chip]');
        const ed = e.target.closest('[data-dps-edit]');
        if (ed) { const k = ed.dataset.dpsEdit, ta = form.elements[`tpl-${k}`], show = form.querySelector(`[data-dps-show="${k}"]`), open = ta.hidden; ta.hidden = !open; show.hidden = open; if (!open) show.textContent = ta.value; ed.lastChild.textContent = open ? 'Done' : 'Edit'; if (open) { ta.focus(); lastTpl = ta; } }
        if (chip && !lastTpl) toast('Click Edit on a template first, then the placeholder to insert.');
        if (chip && lastTpl) { const t = `{{${chip.dataset.dpsChip}}}`, at = lastTpl.selectionStart ?? lastTpl.value.length; lastTpl.setRangeText(t, at, lastTpl.selectionEnd ?? at, 'end'); lastTpl.focus(); }
        const pv = e.target.closest('[data-dps-preview]');
        if (pv) { const k = pv.dataset.dpsPreview, text = form.elements[`tpl-${k}`].value; ctx.openDialog(`Preview · ${options.templateTitles[k]} template`, `<div class="dialog-body"><p class="legend">Placeholders are filled from the case when the notice is issued.</p><div class="dps-sheet">${esc(text).replace(/\{\{(\w+)\}\}/g, '<mark>{{$1}}</mark>').replace(/\n/g, '<br>')}</div></div>`, '<div class="dialog-foot"><button data-close>Close</button></div>'); }
        if (e.target.closest('[data-dps-cancel]')) render();
      });
    }
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
