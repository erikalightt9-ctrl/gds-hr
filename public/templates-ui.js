// Reports → Excel report templates: download a template filled with current records (formulas, totals, filters),
// keep edited copies as versions (upload), download or remove them. Only templates the role may see are listed.
import { fmtDateTime, readFile, who } from './hr-common.js';

export function createTemplates({ api, esc, table, badge, toast, openDialog, dialog, today }) {
  const CATEGORIES = ['HR', 'Administrative', 'Accounting', 'Operational'];
  const period = t => (t.params.includes('month') ? `<input type="month" data-period="month" value="${today().slice(0, 7)}" aria-label="Month">` : t.params.includes('year') ? `<input inputmode="numeric" maxlength="4" data-period="year" value="${today().slice(0, 4)}" aria-label="Year" class="tpl-year">` : '');
  async function section() {
    const list = await api('/hr/templates'), box = document.createElement('section');
    box.className = 'panel';
    if (!list.length) return box;
    box.innerHTML = `<div class="panel-head"><div><h2>Excel report templates</h2><p class="legend">Filled with current records: shaded headings with filters, formulas for computed columns and totals. Edit in Excel and upload to keep each version on record.</p></div></div>
      ${CATEGORIES.filter(c => list.some(t => t.category === c)).map(c => `<h3 class="tpl-cat">${esc(c)}</h3><ul class="report-list wide">${list.filter(t => t.category === c).map(t => `<li data-tpl="${esc(t.key)}"><span><strong>${esc(t.title)}</strong>${t.sensitive ? ` ${badge('Restricted', 'neutral')}` : ''}<small>${esc(t.description)}</small></span><span class="tpl-actions">${period(t)}<button class="small primary" data-download>Download</button><button class="small" data-files>Saved files (${t.files})</button></span></li>`).join('')}</ul>`).join('')}`;
    box.onclick = async e => {
      const b = e.target.closest('button'), li = b?.closest('[data-tpl]'); if (!li) return;
      const t = list.find(x => x.key === li.dataset.tpl), input = li.querySelector('[data-period]');
      if (b.hasAttribute('data-download')) {
        const q = input ? `?${input.dataset.period}=${encodeURIComponent(input.value)}` : '';
        if (input && !(input.dataset.period === 'year' ? /^\d{4}$/ : /^\d{4}-\d{2}$/).test(input.value)) { toast('Choose the period first.'); return; }
        const a = document.createElement('a'); a.href = `/api/hr/templates/${t.key}.xlsx${q}`; a.download = ''; document.body.append(a); a.click(); a.remove();
      }
      if (b.hasAttribute('data-files')) files(t, async () => { const updated = await api('/hr/templates'); t.files = updated.find(x => x.key === t.key)?.files ?? t.files; b.textContent = `Saved files (${t.files})`; });
    };
    return box;
  }
  async function files(t, onChange) {
    const rows = await api(`/hr/templates/${t.key}/files`), live = rows.filter(f => !f.removed), removed = rows.filter(f => f.removed);
    openDialog(`${t.title} · saved files`, `<div class="dialog-body">
      ${t.canUpload ? `<form id="tpl-upload" class="form-grid"><label class="field">Edited workbook (.xlsx, up to 5 MB)<input type="file" name="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label><label class="field">Period (e.g. 2026-09)<input name="period" maxlength="40" value="${t.params.includes('month') ? today().slice(0, 7) : t.params.includes('year') ? today().slice(0, 4) : ''}"></label><label class="field full">Notes<input name="notes" maxlength="1000" placeholder="What was changed or reviewed"></label><div class="full"><button class="primary">Upload as a new version</button></div></form>` : '<p class="legend">You can download these files. Uploading is for HR, Payroll and administrators.</p>'}
      ${table(['File', 'Period', 'Version', 'Uploaded', 'Notes', ''], live.map(f => [`<a href="/api/hr/report-files/${f.id}">⬇ ${esc(f.name)}</a><small>${f.sheets.map(s => `${esc(s.name)} (${s.rows} rows)`).join(' · ')}</small>`, esc(f.period || '—'), `v${f.version}`, `${fmtDateTime(f.uploadedAt)}<small>${esc(who(f.uploadedBy))}</small>`, esc(f.notes || ''), t.canUpload ? `<button class="small danger" data-remove="${f.id}">Remove</button>` : '']), 'No saved files yet.')}
      ${removed.length ? `<details><summary>${removed.length} removed file${removed.length === 1 ? '' : 's'} (kept on record)</summary>${table(['File', 'Removed', 'Reason'], removed.map(f => [esc(f.name), `${fmtDateTime(f.removedAt)} · ${esc(who(f.removedBy))}`, esc(f.removeReason)]))}</details>` : ''}</div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
    const form = dialog.querySelector('#tpl-upload');
    if (form) form.onsubmit = async ev => {
      ev.preventDefault(); const file = form.elements.file.files[0];
      if (!file || !/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) { toast('Choose an .xlsx workbook up to 5 MB.'); return; }
      try { await api(`/hr/templates/${t.key}/files`, { name: file.name, period: form.elements.period.value, notes: form.elements.notes.value, data: await readFile(file) }); toast('Uploaded as a new version.'); await onChange(); await files(t, onChange); } catch (error) { toast(error.message); }
    };
    dialog.querySelector('.dialog-body').onclick = async e => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      const reason = window.prompt('Why is this file removed? It stays on record, marked as removed.'); if (!reason) return;
      try { await api(`/hr/report-files/${b.dataset.remove}/remove`, { reason }); toast('File removed.'); await onChange(); await files(t, onChange); } catch (error) { toast(error.message); }
    };
  }
  return { section };
}
