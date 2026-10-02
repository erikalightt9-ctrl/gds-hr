// Bulk attendance upload: choose any Excel/CSV file, confirm the recognised columns, review flagged rows, then import.
// Steps: 1 file → 2 column mapping → 3 preview → import. The file stays in this browser tab between steps.
const RESULT = {
  ready: ['Ready', ''], replace: ['Will replace', 'pending'], review: ['Needs review', 'rejected'],
  duplicate: ['Duplicate', 'neutral'], existing: ['Already recorded', 'neutral'],
};
const MAX_BYTES = 5 * 1024 * 1024;

export function createAttendanceImport({ api, esc, table, badge, toast, openDialog, dialog, refresh, render, getState }) {
  let upload = null, inspected = null, settings = null, lastPreview = null;

  function open() {
    upload = inspected = settings = lastPreview = null;
    openDialog('Upload attendance from Excel', `<div class="dialog-body" id="ai-root">
      <p>Upload any attendance spreadsheet: a biometric export, a DTR summary or your own sheet. No template is needed. The columns for employee, date, time in and time out are recognised automatically, and you can correct them before anything is saved.</p>
      <label class="field">Excel workbook (.xlsx) or CSV, up to 5 MB<input type="file" id="ai-file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      <div id="ai-step"></div></div>`, '<div class="dialog-foot" id="ai-foot"><button data-close>Cancel</button></div>');
    dialog.querySelector('#ai-file').onchange = choose;
    dialog.querySelector('#ai-root').addEventListener('click', onClick);
    dialog.querySelector('#ai-root').addEventListener('change', onChange);
  }

  async function choose(event) {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > MAX_BYTES) { toast('The file is larger than 5 MB. Split it or remove unused sheets.'); return; }
    try {
      const content = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('The file could not be read.')); reader.readAsDataURL(file); });
      upload = { fileName: file.name, content };
      inspected = await api('/attendance-import/inspect', upload);
      selectSheet(0);
    } catch (error) { toast(error.message); }
  }
  function selectSheet(index) {
    const sheet = inspected.sheets[index];
    settings = { sheet: index, headerRow: sheet.headerRow, mapping: { ...sheet.mapping }, dateOrder: 'auto', assignments: {}, approve: true, replaceExisting: false };
    drawMapping();
  }

  function drawMapping() {
    const sheet = inspected.sheets[settings.sheet], options = sel => `<option value="">— Not in this file —</option>${sheet.columns.map((c, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
    const found = Object.values(settings.mapping).filter(v => v !== null).length;
    dialog.querySelector('#ai-step').innerHTML = `<hr>
      <h3>2. Check the columns</h3>
      ${inspected.sheets.length > 1 ? `<label class="field">Sheet<select data-ai="sheet">${inspected.sheets.map((s, i) => `<option value="${i}" ${i === settings.sheet ? 'selected' : ''}>${esc(s.name)} (${s.rowCount} rows)</option>`).join('')}</select></label>` : ''}
      <p class="legend">${found} column${found === 1 ? '' : 's'} recognised in “${esc(sheet.name)}”, headings on row ${settings.headerRow + 1}. Use time in / time out for one row per day, or a date &amp; time punch column for biometric logs with one row per punch.</p>
      <div class="form-grid">${Object.entries(inspected.fields).map(([key, name]) => `<label class="field">${esc(name)}<select data-ai-map="${key}">${options(settings.mapping[key])}</select></label>`).join('')}
        <label class="field">Headings are on row<input type="number" min="1" max="5000" value="${settings.headerRow + 1}" data-ai="header"></label>
        <label class="field">Dates like 03/04/2026 mean<select data-ai="order"><option value="auto">Detect automatically</option><option value="mdy" ${settings.dateOrder === 'mdy' ? 'selected' : ''}>Month/Day/Year (March 4)</option><option value="dmy" ${settings.dateOrder === 'dmy' ? 'selected' : ''}>Day/Month/Year (3 April)</option></select></label></div>
      <h3>First rows of the file</h3>${table(sheet.columns.map(esc), sheet.sample.map(r => r.map(esc)), 'No data rows under the headings.')}
      <div id="ai-preview"></div>`;
    footer(`<button class="primary" data-ai-action="preview">Preview import</button>`);
  }

  async function runPreview() {
    try {
      lastPreview = await api('/attendance-import/preview', { ...upload, ...settings });
      drawPreview();
    } catch (error) { toast(error.message); }
  }
  function drawPreview() {
    const p = lastPreview, c = p.counts, employees = getState().employees.filter(e => !e.draft);
    const assign = key => `<select data-ai-assign="${esc(key)}"><option value="">Choose employee…</option>${employees.map(e => `<option value="${esc(e.id)}" ${settings.assignments[key] === e.id ? 'selected' : ''}>${esc(e.name)} · ${esc(e.id)}</option>`).join('')}</select>`;
    const toSave = c.ready + c.replace, skipped = p.rows.length - toSave;
    const rows = [...p.rows].sort((a, b) => order(a) - order(b) || a.line - b.line);
    dialog.querySelector('#ai-preview').innerHTML = `<hr><h3>3. Review before saving</h3>
      <div class="import-counts">${count(c.ready, 'ready to add')}${c.replace ? count(c.replace, 'will replace existing') : ''}${count(c.review, 'need review', c.review ? 'warn' : '')}${count(c.duplicate, 'duplicates in file')}${count(c.existing, 'already recorded')}</div>
      ${p.punchMode ? '<p class="legend">Punch log: each employee’s first punch of the day is time in and the last is time out.</p>' : ''}
      ${p.unmatched.length ? `<div class="notice"><strong>Employees not matched (${p.unmatched.length}).</strong> Choose who each name or ID belongs to, then update the preview. Rows left unmatched are skipped.<div class="import-assign">${p.unmatched.map(k => `<label class="field">${esc(k)}${assign(k)}</label>`).join('')}</div></div>` : ''}
      <label class="field check"><input type="checkbox" data-ai="approve" ${settings.approve ? 'checked' : ''}>Mark imported records as approved so they count in payroll <small>Untick to import them as pending; payroll will list them until each is approved.</small></label>
      <label class="field check"><input type="checkbox" data-ai="replace" ${settings.replaceExisting ? 'checked' : ''}>Replace days that are already recorded <small>The previous record, the reason and your name are kept in the correction history. GPS clock records and posted payroll are never replaced.</small></label>
      ${table(['Row', 'Result', 'Employee', 'Date', 'Time in', 'Time out', 'Status', 'What to check'], rows.map(r => [
        r.lines?.length > 1 ? `${r.line}<small>${r.lines.length} punches</small>` : r.line,
        badge(...RESULT[r.result]),
        r.employeeId ? `${esc(r.employeeName)}<small>${esc(r.employeeId)}${r.assigned ? ' · assigned by you' : ''}</small>` : `<span class="muted">${esc(r.key || '—')}</span>`,
        esc(r.date || r.source.date || r.source.punch || '—'), esc(r.timeIn || r.source.timeIn || '—'), esc(r.timeOut || r.source.timeOut || '—') + (r.endNextDay ? '<small>next day</small>' : ''),
        esc(r.status), `<span class="wrap">${esc(r.issues.join('; ')) || '—'}</span>`]), 'No data rows found.')}
      <p class="legend">${toSave} record${toSave === 1 ? '' : 's'} will be saved. ${skipped} row${skipped === 1 ? '' : 's'} will be skipped; fix them in the file and upload again, or enter them on the timecard.</p>`;
    footer(`<button data-ai-action="preview">Update preview</button><button class="primary" data-ai-action="commit" ${toSave ? '' : 'disabled'}>Import ${toSave} record${toSave === 1 ? '' : 's'}</button>`);
  }
  const order = r => ['review', 'duplicate', 'existing', 'replace', 'ready'].indexOf(r.result);
  const count = (n, text, kind = '') => `<div class="import-count ${kind}"><strong>${n}</strong><span>${text}</span></div>`;

  async function commit() {
    const button = dialog.querySelector('[data-ai-action="commit"]'); if (button) button.disabled = true;
    try {
      const result = await api('/attendance-import/commit', { ...upload, ...settings });
      dialog.close(); await refresh(); render();
      toast(`Imported ${result.saved} attendance record${result.saved === 1 ? '' : 's'} from ${result.fileName}. Timecards and payroll now include them.`);
    } catch (error) { toast(error.message); if (button) button.disabled = false; }
  }

  function footer(buttons) { dialog.querySelector('#ai-foot').innerHTML = `<button data-close>Cancel</button>${buttons}`; dialog.querySelector('#ai-foot').onclick = onClick; }
  function onClick(event) {
    const action = event.target.closest('[data-ai-action]')?.dataset.aiAction;
    if (action === 'preview') runPreview();
    if (action === 'commit') commit();
  }
  function onChange(event) {
    const el = event.target;
    if (el.dataset.aiMap) { settings.mapping[el.dataset.aiMap] = el.value === '' ? null : Number(el.value); stale(); }
    if (el.dataset.aiAssign !== undefined) { if (el.value) settings.assignments[el.dataset.aiAssign] = el.value; else delete settings.assignments[el.dataset.aiAssign]; stale(); }
    if (el.dataset.ai === 'sheet') selectSheet(Number(el.value));
    if (el.dataset.ai === 'header') { settings.headerRow = Math.max(0, Number(el.value) - 1); reinspect(); }
    if (el.dataset.ai === 'order') { settings.dateOrder = el.value; stale(); }
    if (el.dataset.ai === 'approve') settings.approve = el.checked;
    if (el.dataset.ai === 'replace') { settings.replaceExisting = el.checked; runPreview(); }
  }
  // A new heading row means new column names: let the server re-read them and re-suggest the mapping.
  async function reinspect() {
    try {
      inspected = await api('/attendance-import/inspect', { ...upload, sheet: settings.sheet, headerRow: settings.headerRow });
      settings.mapping = { ...inspected.sheets[settings.sheet].mapping }; lastPreview = null;
      drawMapping();
    } catch (error) { toast(error.message); }
  }
  // Mapping changed after a preview: the old preview no longer applies, so the import button waits for a new one.
  function stale() {
    if (!lastPreview) return;
    const target = dialog.querySelector('[data-ai-action="commit"]'); if (target) { target.disabled = true; target.textContent = 'Update the preview first'; }
  }

  return { open };
}
