// Reports page additions: the Excel templates (built from the records, with formulas, totals and filters) grouped by
// area, and the report library where staff upload, version and download the Excel reports they maintain.
import { fmtDateTime, readFile, who } from './hr-common.js';

export function createReportLibrary({ api, esc, badge, toast, openDialog, dialog, today }) {
  const CATEGORY_ORDER = ['Administrative', 'HR', 'Accounting', 'Operational'];
  function templatesPanel(reports) {
    const list = reports.filter(r => r.template);
    if (!list.length) return '';
    const month = today().slice(0, 7), link = (r, f) => `/api/reports/${esc(r.key)}.${f}${r.filters.includes('month') ? `?month=${month}` : ''}`;
    const filter = r => (r.filters.includes('month') ? `<input type="month" value="${month}" data-template-month="${esc(r.key)}" aria-label="Month">` : r.filters.includes('caseStatus') ? `<select data-template-status="${esc(r.key)}" aria-label="Case status"><option value="">All cases</option><option value="pending">Pending</option><option value="investigation">Under Investigation</option><option value="awaiting">Awaiting Explanation</option><option value="evaluation">For Evaluation</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select>` : '');
    return `<section class="panel nv-panel nv-i-sheet nv-reports"><div class="panel-head"><div><h2>Excel templates</h2><p class="legend">Filter buttons, frozen headings, totals and live formulas; only what your role may see</p></div></div>${CATEGORY_ORDER.map(cat => { const items = list.filter(r => r.category === cat); return items.length ? `<h3 class="report-group">${cat}</h3><ul class="report-list wide">${items.map(r => `<li data-template="${esc(r.key)}"><span>${esc(r.title)}</span>${filter(r)}<span class="download-links"><a class="small download-link" data-template-link data-format="xlsx" href="${link(r, 'xlsx')}" download>Excel</a><a class="small download-link" data-template-link data-format="pdf" href="${link(r, 'pdf')}" download>PDF</a></span></li>`).join('')}</ul>` : ''; }).join('')}</section>`;
  }
  async function libraryPanel() {
    let lib;
    try { lib = await api('/report-library'); } catch { return ''; }
    const rows = lib.files.filter(f => !f.archived), archived = lib.files.filter(f => f.archived);
    const row = f => { const v = f.versions.at(-1); return `<tr><td><strong>${esc(f.title)}</strong>${f.description ? `<br><small>${esc(f.description)}</small>` : ''}</td><td>${badge(f.category, 'neutral')}</td><td><small>${esc(lib.accessLabels[f.access])}</small></td><td>v${v.version} · ${esc(v.fileName)}<br><small>${v.sheets.map(s => `${esc(s.name)} (${s.rows} rows)`).join(', ')}</small></td><td><small>${fmtDateTime(v.at)}<br>${esc(who(v.by))}</small></td><td class="actions-cell"><a class="small download-link" href="/api/report-library/${f.id}/download" download>Download</a>${lib.canUpload ? `<button class="small" data-lib-version="${f.id}">New version</button><button class="small" data-lib-edit="${f.id}">Details</button>` : ''}${f.versions.length > 1 ? `<button class="small" data-lib-history="${f.id}">History (${f.versions.length})</button>` : ''}</td></tr>`; };
    const tableHtml = list => `<div class="scroll-table"><table><thead><tr><th>Report</th><th>Area</th><th>Access</th><th>Current version</th><th>Uploaded</th><th></th></tr></thead><tbody>${list.length ? list.map(row).join('') : '<tr><td colspan="6" class="empty"><strong>Nothing here yet</strong>Upload an Excel report your team maintains.</td></tr>'}</tbody></table></div>`;
    state = lib;
    return `<section class="panel nv-panel nv-i-folder nv-reports" data-library><div class="panel-head"><div><h2>Report library</h2><p class="legend">Excel or CSV reports you maintain: download, edit in Excel, upload the new version (every version is kept)</p></div>${lib.canUpload ? '<button class="small" data-lib-upload>＋ Upload report</button>' : ''}</div>${tableHtml(rows)}${archived.length ? `<details><summary>Archived (${archived.length})</summary>${tableHtml(archived)}</details>` : ''}</section>`;
  }
  let state = null;
  const errorBox = (form, error) => { const err = form.querySelector('.form-error'); err.textContent = error.message; err.classList.remove('hidden'); };
  const fields = (f = {}) => `<label class="field full">Title<input name="title" required maxlength="150" value="${esc(f.title || '')}"></label>
    <label class="field">Area<select name="category">${state.categories.map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label class="field">Who may see it<select name="access">${Object.entries(state.access).map(([k, v]) => `<option value="${k}" ${k === f.access ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label class="field full">Description<textarea name="description" rows="2" maxlength="1000">${esc(f.description || '')}</textarea></label>`;
  function upload(onDone) {
    openDialog('Upload report', `<form id="lib-form"><div class="dialog-body"><div class="form-error hidden" role="alert"></div><div class="form-grid">${fields()}<label class="field full">File (.xlsx or .csv, up to 5 MB)<input type="file" name="file" required accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></label></div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Upload</button></div></form>`);
    const form = dialog.querySelector('#lib-form');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements, file = f.file.files[0];
      try { await api('/report-library', { title: f.title.value, category: f.category.value, access: f.access.value, description: f.description.value, fileName: file.name, data: await readFile(file) }); dialog.close(); toast('Report uploaded.'); onDone(); } catch (error) { errorBox(form, error); }
    };
  }
  function newVersion(id, onDone) {
    const file = state.files.find(x => x.id === id);
    openDialog(`New version · ${file.title}`, `<form id="lib-form"><div class="dialog-body"><div class="form-error hidden" role="alert"></div><div class="form-grid one"><label class="field">File (.xlsx or .csv)<input type="file" name="file" required accept=".xlsx,.csv"></label><label class="field">What changed<input name="note" required maxlength="500"></label></div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Upload version</button></div></form>`);
    const form = dialog.querySelector('#lib-form');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements, chosen = f.file.files[0];
      try { await api(`/report-library/${id}/versions`, { fileName: chosen.name, data: await readFile(chosen), note: f.note.value }); dialog.close(); toast('New version uploaded.'); onDone(); } catch (error) { errorBox(form, error); }
    };
  }
  function details(id, onDone) {
    const file = state.files.find(x => x.id === id);
    openDialog(`Details · ${file.title}`, `<form id="lib-form"><div class="dialog-body"><div class="form-error hidden" role="alert"></div><div class="form-grid">${fields(file)}<label class="field check full"><input type="checkbox" name="archived" ${file.archived ? 'checked' : ''}> Archived (hidden from the main list; versions are kept)</label></div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`);
    const form = dialog.querySelector('#lib-form');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements;
      try { await api(`/report-library/${id}`, { title: f.title.value, category: f.category.value, access: f.access.value, description: f.description.value, archived: f.archived.checked }); dialog.close(); toast('Saved.'); onDone(); } catch (error) { errorBox(form, error); }
    };
  }
  function history(id) {
    const file = state.files.find(x => x.id === id);
    openDialog(`Versions · ${file.title}`, `<div class="dialog-body"><ul class="dp-history">${file.versions.slice().reverse().map(v => `<li><a href="/api/report-library/${id}/download?version=${v.version}" download>v${v.version} · ${esc(v.fileName)}</a> · ${fmtDateTime(v.at)} · ${esc(who(v.by))}${v.note ? ` · ${esc(v.note)}` : ''}</li>`).join('')}</ul></div>`);
  }
  // Binds the template filters and the library buttons inside the Reports page; onChange redraws the page.
  function bind(root, onChange) {
    root.addEventListener('change', event => {
      const li = event.target.closest('[data-template]'); if (!li) return;
      const v = event.target.value, key = event.target.dataset.templateMonth ? 'month' : 'caseStatus';
      li.querySelectorAll('[data-template-link]').forEach(a => { a.href = `/api/reports/${li.dataset.template}.${a.dataset.format}${v ? `?${key}=${encodeURIComponent(v)}` : ''}`; });
    });
    root.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b || !b.closest('[data-library]')) return;
      if (b.hasAttribute('data-lib-upload')) upload(onChange);
      if (b.dataset.libVersion) newVersion(b.dataset.libVersion, onChange);
      if (b.dataset.libEdit) details(b.dataset.libEdit, onChange);
      if (b.dataset.libHistory) history(b.dataset.libHistory);
    });
  }
  return { templatesPanel, libraryPanel, bind };
}
