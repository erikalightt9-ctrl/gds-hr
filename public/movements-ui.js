// Employee movements, offboarding and clearance (Nov 20, 2026): on the 201 Employment tab (one employee) and as a
// page (everyone). Requested with an effective date and reason, approved by a second person, applied on the date.
const TYPES = { promotion: 'Promotion', transfer: 'Transfer', regularization: 'Regularization', 'type-change': 'Change of employment type / classification', separation: 'Separation' };
const KINDS = ['Resignation', 'End of contract', 'Termination (just cause)', 'Termination (authorized cause)', 'Retirement'];
const STATUS = { pending: ['Waiting for a second approver', 'pending'], approved: ['Approved · applies on the effective date', 'pending'], applied: ['Applied', ''], rejected: ['Rejected', 'rejected'] };
const CLEAR = { pending: ['Pending', 'pending'], cleared: ['Cleared', ''], 'not-applicable': ['Not applicable', 'neutral'] };

function rowsHtml(list, esc, badge, withName) {
  const change = m => (m.type === 'separation' ? `${esc(m.changes.separationKind)} · last day ${esc(m.effectiveDate)}` : [m.changes.position && `Position: ${esc(m.before.position || '—')} → <strong>${esc(m.changes.position)}</strong>`, m.changes.department && `Department: ${esc(m.before.department || '—')} → <strong>${esc(m.changes.department)}</strong>`, m.changes.classification && `Classification: ${esc(m.before.classification || '—')} → <strong>${esc(m.changes.classification)}</strong>`, m.changes.employmentType && `Type: ${esc(m.before.employmentType || '—')} → <strong>${esc(m.changes.employmentType)}</strong>`].filter(Boolean).join('<br>'));
  const clearance = m => (m.clearance ? `<details ${m.clearanceCompleteAt ? '' : 'open'}><summary>Clearance ${m.clearanceCompleteAt ? badge('Complete', '') : badge(`${m.clearance.filter(i => i.status === 'pending').length} pending`, 'pending')}</summary><ul class="plain-list">${m.clearance.map(i => `<li>${badge(...CLEAR[i.status])} <strong>${esc(i.label)}</strong> <small>${esc(i.owner)}${i.note ? ` · ${esc(i.note)} (${esc(i.by)})` : ''}</small>${m.canClear && i.status === 'pending' ? ` <button class="small" data-clear="${esc(m.id)}" data-key="${esc(i.key)}" data-status="cleared">Clear…</button> <button class="small" data-clear="${esc(m.id)}" data-key="${esc(i.key)}" data-status="not-applicable">N/A…</button>` : ''}</li>`).join('')}</ul></details>` : '');
  return list.map(m => `<tr>${withName ? `<td><strong>${esc(m.employeeName)}</strong></td>` : ''}<td>${esc(m.typeLabel)}</td><td>${esc(m.effectiveDate)}</td><td class="wrap">${change(m)}${clearance(m)}</td><td class="wrap">${esc(m.reason)}</td><td>${badge(...(STATUS[m.status] || [m.status, 'neutral']))}<br><small>${esc(m.requestedBy)}${m.decidedBy ? ` → ${esc(m.decidedBy)}` : ''}</small></td><td>${m.canDecide ? `<button class="small primary" data-mv-approve="${esc(m.id)}">Approve</button> <button class="small" data-mv-reject="${esc(m.id)}">Reject</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="${withName ? 7 : 6}" class="empty">Nothing to show yet.</td></tr>`;
}
// Page view (Nov 25, 2026 design): red hero, intro, six tiles that filter the list, search + filters + Excel (CSV), table, empty state.
const mvIco = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const MV_TILES = [
  ['promotion', 'Promotions', 'blue', mvIco('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>')],
  ['transfer', 'Transfers', 'violet', mvIco('<path d="M4 8h14l-4-4M20 16H6l4 4"/>')],
  ['regularization', 'Regularizations', 'green', mvIco('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 13l2 2 4-4"/>')],
  ['type-change', 'Type Changes', 'orange', mvIco('<path d="M4 9a7 7 0 0 1 12-3l3 3M20 15a7 7 0 0 1-12 3l-3-3M19 4v5h-5M5 20v-5h5"/>')],
  ['separation', 'Separations', 'rose', mvIco('<circle cx="10" cy="8" r="4"/><path d="M3 21c0-4 3-7 7-7 1.6 0 3 .4 4 1.2M16 16l5 5M21 16l-5 5"/>')],
  ['clearance', 'Offboarding Clearance', 'sky', mvIco('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/>')],
];
const MV_HERO = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M20 38a32 32 0 0 1 50-20" fill="none" stroke="#2f6df0" stroke-width="7" stroke-linecap="round"/><path d="m66 8 6 12-13 2" fill="#2f6df0"/><path d="M80 62a32 32 0 0 1-50 20" fill="none" stroke="#d7141a" stroke-width="7" stroke-linecap="round"/><path d="m34 92-6-12 13-2" fill="#d7141a"/><circle cx="50" cy="40" r="9" fill="#14306e"/><circle cx="33" cy="46" r="7" fill="#14306e"/><circle cx="67" cy="46" r="7" fill="#14306e"/><path d="M34 72c0-10 7-16 16-16s16 6 16 16zM20 70c0-8 5-13 12-13 3 0 5 1 7 2-4 3-6 7-6 11zM80 70c0-8-5-13-12-13-3 0-5 1-7 2 4 3 6 7 6 11z" fill="#14306e"/></svg>';
const MV_EMPTY = '<svg viewBox="0 0 120 100" aria-hidden="true"><path d="M14 30a6 6 0 0 1 6-6h24l8 8h44a6 6 0 0 1 6 6v6H14z" fill="#a9bde8"/><path d="M10 44h92l-8 40a6 6 0 0 1-6 5H22a6 6 0 0 1-6-5z" fill="#c9d7f3"/><circle cx="78" cy="64" r="14" fill="#fff" stroke="#4867b8" stroke-width="5"/><path d="m88 74 14 14" stroke="#4867b8" stroke-width="7" stroke-linecap="round"/></svg>';
const clearancePending = m => m.type === 'separation' && m.clearance && !m.clearanceCompleteAt;
async function mountPage(box, ctx) {
  const { api, esc, badge } = ctx;
  let list;
  try { list = await api('/movements'); } catch { box.innerHTML = '<p class="legend">Movements are available after the HR server restarts.</p>'; return null; }
  const f = box.mvFilter || (box.mvFilter = { tile: '', q: '', type: '', status: '', from: '', to: '', clearance: '' });
  const rows = () => {
    const q = f.q.trim().toLowerCase();
    return list.filter(m => !f.tile || (f.tile === 'clearance' ? m.type === 'separation' && m.clearance : m.type === f.tile))
      .filter(m => !f.type || m.type === f.type).filter(m => !f.status || m.status === f.status)
      .filter(m => (!f.from || m.effectiveDate >= f.from) && (!f.to || m.effectiveDate <= f.to))
      .filter(m => !f.clearance || (f.clearance === 'pending' ? clearancePending(m) : m.clearanceCompleteAt))
      .filter(m => !q || `${m.employeeName} ${m.typeLabel} ${m.reason} ${JSON.stringify(m.changes)}`.toLowerCase().includes(q));
  };
  const count = id => (id === 'clearance' ? list.filter(clearancePending).length : list.filter(m => m.type === id).length);
  const filtered = rows(), anyFilter = Object.values(f).some(Boolean);
  box.innerHTML = `<div class="mvp">
    <section class="mvp-hero"><span class="mvp-hero-ico">${MV_HERO}</span><div><span>People Operations</span><h1>Movements &amp; Clearance</h1><p>Promotions, transfers, regularizations, separations and offboarding clearance.</p></div></section>
    <section class="mvp-panel">
      <div class="mvp-intro"><i>${mvIco('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 10h10l-3-3M17 14H7l3 3"/>')}</i><div><h2>Movements, Offboarding &amp; Clearance</h2><p>Promotion, transfer, regularization, change of type and separation: requested with a reason and effective date, approved by a second HR Manager / Admin, applied on the date.<br>A separation starts the clearance checklist. Pay changes are requested separately (Compensation → Request salary change).</p></div></div>
      <div class="mvp-tiles">${MV_TILES.map(([id, label, tone, icon]) => `<button class="mvp-tile mvp-${tone}${f.tile === id ? ' on' : ''}" data-mv-tile="${id}" aria-pressed="${f.tile === id}" title="${id === 'clearance' ? 'Separations whose clearance is not complete' : `Show ${label.toLowerCase()}`}"><i>${icon}</i><span>${label}</span><strong>${count(id)}</strong></button>`).join('')}</div>
      <div class="mvp-tools">
        <label class="mvp-search">${mvIco('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>')}<input type="search" data-mv-q value="${esc(f.q)}" placeholder="Search employee, movement, reason…" aria-label="Search employee, movement, reason"></label>
        <select class="mvp-select" data-mv-f="type" aria-label="Movement"><option value="">All Movements</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <select class="mvp-select" data-mv-f="status" aria-label="Status"><option value="">All Status</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${esc(l.split(' · ')[0])}</option>`).join('')}</select>
        <details class="mvp-pop-wrap"><summary class="mvp-select mvp-range">${f.from || f.to ? esc(`${f.from || '…'} – ${f.to || '…'}`) : 'Effective Date'}${mvIco('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>')}</summary><div class="mvp-pop"><label>From<input type="date" data-mv-f="from" value="${esc(f.from)}"></label><label>To<input type="date" data-mv-f="to" value="${esc(f.to)}"></label><button class="small" data-mv-dates-clear>Clear dates</button></div></details>
        <details class="mvp-pop-wrap"><summary class="mvp-btn">${mvIco('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')}Filter${f.clearance ? ' •' : ''}</summary><div class="mvp-pop"><label>Clearance<select data-mv-f="clearance"><option value="">Any</option><option value="pending" ${f.clearance === 'pending' ? 'selected' : ''}>Not complete</option><option value="complete" ${f.clearance === 'complete' ? 'selected' : ''}>Complete</option></select></label><button class="small" data-mv-clear-all>Clear all filters</button></div></details>
        <button class="mvp-excel" data-mv-export>${mvIco('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>')}Excel</button></div>
      <div class="mvp-table"><table><thead><tr><th>Employee</th><th>Movement</th><th>Effective</th><th>Change / Clearance</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>${filtered.length ? rowsHtml(filtered, esc, badge, true) : ''}</tbody></table>
        ${filtered.length ? '' : `<div class="mvp-empty">${MV_EMPTY}<strong>Nothing to show yet.</strong><span>${anyFilter ? 'No records match your selected filters.' : 'No movements have been requested yet. Open an employee’s 201 file → Employment to request one.'}</span></div>`}</div>
    </section></div>`;
  const redraw = () => mountPage(box, ctx);
  const q = box.querySelector('[data-mv-q]');
  q.oninput = () => { f.q = q.value; const pos = q.selectionStart; redraw().then(() => { const again = box.querySelector('[data-mv-q]'); again?.focus(); again?.setSelectionRange(pos, pos); }); };
  box.querySelectorAll('select[data-mv-f], input[data-mv-f]').forEach(el => { el.onchange = () => { f[el.dataset.mvF] = el.value; redraw(); }; });
  box.mvPageClick = event => {
    const t = event.target;
    box.querySelectorAll('.mvp details[open]').forEach(d => { if (!d.contains(t)) d.open = false; });
    const tile = t.closest('[data-mv-tile]'); if (tile) { f.tile = f.tile === tile.dataset.mvTile ? '' : tile.dataset.mvTile; redraw(); return true; }
    if (t.closest('[data-mv-dates-clear]')) { f.from = ''; f.to = ''; redraw(); return true; }
    if (t.closest('[data-mv-clear-all]')) { Object.keys(f).forEach(k => { f[k] = ''; }); redraw(); return true; }
    if (t.closest('[data-mv-export]')) {
      const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`, line = r => r.map(cell).join(',');
      const csv = [line(['Employee', 'Movement', 'Effective', 'Change', 'Clearance', 'Reason', 'Status', 'Requested by', 'Decided by'])].concat(rows().map(m => line([m.employeeName, m.typeLabel, m.effectiveDate, m.type === 'separation' ? `${m.changes.separationKind || ''}` : Object.entries(m.changes).filter(([, v]) => v).map(([k, v]) => `${k}: ${m.before?.[k] || '—'} → ${v}`).join('; '), m.clearance ? (m.clearanceCompleteAt ? 'Complete' : `${m.clearance.filter(i => i.status === 'pending').length} pending`) : '', m.reason, (STATUS[m.status] || [m.status])[0], m.requestedBy, m.decidedBy || '']))).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'movements-and-clearance.csv'; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      return true;
    }
    return false;
  };
  return list;
}
export async function mountMovements(box, ctx, employeeId = '') {
  if (!box) return;
  const { api, esc, badge, toast, openDialog, dialog, today } = ctx;
  let list;
  if (!employeeId) { if (await mountPage(box, ctx) === null) return; } else {
  try { list = await api(`/movements?employeeId=${encodeURIComponent(employeeId)}`); } catch { box.innerHTML = '<p class="legend">Movements are available after the HR server restarts.</p>'; return; }
  box.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>🔁 Movements, offboarding &amp; clearance</h2><p class="legend">Promotion, transfer, regularization, change of type and separation: requested with a reason and effective date, approved by a second HR Manager / Admin, applied on the date. A separation starts the clearance checklist. Pay changes are requested separately (Compensation → Request salary change).</p></div>${employeeId ? '<button class="small primary" data-mv-new>New movement</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr>${employeeId ? '' : '<th>Employee</th>'}<th>Movement</th><th>Effective</th><th>Change / clearance</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>${rowsHtml(list, esc, badge, !employeeId)}</tbody></table></div></section>`;
  }
  const reload = () => mountMovements(box, ctx, employeeId);
  box.onclick = async event => {
    if (!employeeId && box.mvPageClick?.(event)) return;
    const b = event.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.mvApprove) { await api(`/movements/${b.dataset.mvApprove}/decision`, { decision: 'approve' }); toast('Movement approved.'); return reload(); }
      if (b.dataset.mvReject) { const note = window.prompt('Reason for rejecting:'); if (!note) return; await api(`/movements/${b.dataset.mvReject}/decision`, { decision: 'reject', note }); toast('Movement rejected.'); return reload(); }
      if (b.dataset.clear) { const note = window.prompt(b.dataset.status === 'cleared' ? 'Note (what was returned, settled or checked):' : 'Why is this item not applicable?'); if (!note) return; await api(`/movements/${b.dataset.clear}/clearance`, { key: b.dataset.key, status: b.dataset.status, note }); toast('Clearance updated.'); return reload(); }
    } catch (error) { toast(error.message); return; }
    if (!b.hasAttribute('data-mv-new')) return;
    openDialog('New movement', `<form id="mv-form"><div class="dialog-body"><div class="form-error hidden" role="alert"></div><div class="form-grid">
      <label class="field">Movement<select name="type" required>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label class="field">Effective date (separation: last day)<input type="date" name="effectiveDate" required value="${esc(today())}"></label>
      <label class="field" data-mv="change">New position<input name="position" maxlength="200"></label><label class="field" data-mv="change">New department / company<input name="department" maxlength="200"></label>
      <label class="field" data-mv="change">New classification<input name="classification" maxlength="60" placeholder="e.g. Regular"></label>
      <label class="field" data-mv="change">Employment type<select name="employmentType"><option value="">Unchanged</option><option>Full-Time</option><option>Part-Time</option><option>Other</option></select></label>
      <label class="field hidden" data-mv="separation">Kind of separation<select name="separationKind"><option value="">Choose…</option>${KINDS.map(k => `<option>${esc(k)}</option>`).join('')}</select></label>
      <label class="field full">Reason / basis (e.g. performance review, approved resignation letter)<textarea name="reason" rows="3" required minlength="10" maxlength="2000"></textarea></label>
      <p class="legend full">A second HR Manager or Administrator approves it. Termination still follows Due Process &amp; Discipline (notice, explanation, decision) before it is recorded here.</p></div></div>
      <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Send for approval</button></div></form>`);
    const form = dialog.querySelector('#mv-form'), sync = () => { const sep = form.elements.type.value === 'separation'; form.querySelectorAll('[data-mv]').forEach(el => el.classList.toggle('hidden', (el.dataset.mv === 'separation') !== sep)); };
    form.elements.type.onchange = sync; sync();
    form.onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form)), err = form.querySelector('.form-error');
      try { await api('/movements', { ...f, employeeId }); dialog.close(); toast('Movement sent for approval.'); reload(); } catch (error) { err.textContent = error.message; err.classList.remove('hidden'); }
    };
  };
}
