// 13th Month Pay page: the annual ledger (posted payroll + salary encoded for months before the system),
// the encoding grid for those earlier months, and the final pay computation for separated employees.
import { who } from './hr-common.js';
export function createThirteenthPage({ api, esc, money, table, toast, openDialog, dialog, shell, heading, today, getState = () => null, context = () => null }) {
  // Grid filters (Company / Status), kept while the page is open. Rows are only hidden, so saving still covers every employee.
  let thCompany = '', thStatus = 'active';
  const empInfo = id => { const e = (getState()?.employees || []).find(x => x.id === id); return { company: e?.department || '', active: !!e && !e.archived && e.active !== false }; };
  const companyList = () => [...new Set([...(context()?.departments || []), ...(getState()?.employees || []).filter(e => !e.archived && e.department).map(e => e.department)])].sort();
  function applyGridFilter() {
    for (const tr of document.querySelectorAll('.th-grid tbody tr')) {
      const id = tr.querySelector('[data-prior], [data-th-ov], [data-emp]')?.dataset; const emp = id?.prior || id?.emp; if (!emp) continue;
      const info = empInfo(emp);
      tr.hidden = (thCompany && info.company !== thCompany) || (thStatus && (thStatus === 'active') !== info.active);
    }
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  // Amounts show as 1,000.00 in the boxes; commas are removed before saving.
  const fmtAmount = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
  // The row's months added up as they are on screen: typed amount + basic from finalized payroll (a fully posted month counts payroll only).
  function rowSum(emp) {
    let sum = 0;
    for (let i = 1; i <= 12; i++) {
      const m = `${year}-${String(i).padStart(2, '0')}`, fromPayroll = data.postedBasic?.[emp]?.[m] || 0;
      if (data.postedMonths[emp]?.includes(m)) { sum += fromPayroll; continue; }
      const typed = Number(parseAmount(document.querySelector(`.th-grid [data-prior="${CSS.escape(emp)}"][data-month="${m}"]`)?.value) || 0);
      sum += (Number.isNaN(typed) ? 0 : typed) + fromPayroll;
    }
    return r2(sum);
  }
  // Undo / redo for the salary records grid, like Excel: each finished edit (and the 13th month it recalculated) is one step.
  const history = { undo: [], redo: [] };
  let snapshot = null;
  const cellKey = el => (el.dataset.thOv ? `ov|${el.dataset.thOv}|${el.dataset.emp}` : `m|${el.dataset.prior}|${el.dataset.month}`);
  const gridCells = () => [...document.querySelectorAll('.th-grid [data-th-ov], .th-grid [data-prior]')];
  const readGrid = () => new Map(gridCells().map(el => [cellKey(el), el.value]));
  const cellOf = key => gridCells().find(el => cellKey(el) === key);
  function recordStep() {
    if (!snapshot) return;
    const now = readGrid(), step = [...now].filter(([k, v]) => snapshot.has(k) && snapshot.get(k) !== v).map(([k, v]) => ({ key: k, before: snapshot.get(k), after: v }));
    snapshot = now;
    if (step.length) { history.undo.push(step); history.redo = []; syncUndo(); }
  }
  function applyStep(from, to, side) {
    recordStep();
    const step = from.pop(); if (!step) return;
    for (const c of step) { const el = cellOf(c.key); if (el) el.value = c[side]; }
    to.push(step); snapshot = readGrid(); syncUndo();
    toast(`${side === 'before' ? 'Undone' : 'Redone'}. Click Save salary records to keep it.`);
  }
  function syncUndo() {
    const u = document.querySelector('#th-undo'), r = document.querySelector('#th-redo');
    if (u) u.disabled = !history.undo.length; if (r) r.disabled = !history.redo.length;
  }
  document.addEventListener('keydown', e => {
    if (!document.querySelector('.th-grid') || !(e.ctrlKey || e.metaKey) || document.querySelector('dialog[open]')) return;
    const key = e.key.toLowerCase(), typing = e.target.matches?.('input, textarea');
    // Inside a box the browser undoes the typing of that box; once you leave it, Ctrl+Z / Ctrl+Y undo whole edits.
    if (typing && snapshot && cellOf(cellKey(e.target)) === e.target && e.target.value !== snapshot.get(cellKey(e.target))) return;
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); applyStep(history.undo, history.redo, 'before'); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); applyStep(history.redo, history.undo, 'after'); }
  });
  const parseAmount = v => { const s = String(v ?? '').replace(/[,₱\s]/g, '').trim(); return s === '' ? '' : s; };
  // Leaving an amount box shows it as 1,000.00 (text that is not a number is left for the user to correct).
  document.addEventListener('focusout', e => { if (e.target.matches?.('[data-amount]')) { const v = parseAmount(e.target.value); if (v !== '' && !Number.isNaN(Number(v))) e.target.value = fmtAmount(v); } });
  let year = null, data = null, finalData = null, lastResult = null, lastInput = null, savedGrid = null;

  // The page opens on the list of years; each one opens that year's 13th month pay.
  async function open(y = null) { year = y || today().slice(0, 4); await render(); }
  // The 13th Month Pay section on the Payroll page: one card per year (this year, years with records, years added).
  async function section(openYear) {
    const thisYear = today().slice(0, 4), current = await api(`/thirteenth?year=${thisYear}`);
    const last = Math.max(Number(thisYear), current.lastYear || 0), years = [...new Set([...Array.from({ length: last - Number(thisYear) + 1 }, (_, i) => String(Number(thisYear) + i)), ...current.years])].sort();
    const box = document.createElement('section'); box.className = 'panel';
    const draw = () => { box.innerHTML = `<div class="pr-13"><span class="pr-13-ico"><svg class="pr-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="9" width="17" height="11.5" rx="1.5"/><path d="M3 9h18M12 9v11.5M12 9c-1.5-3.5-6-4.5-6-1.5 0 1.5 3 1.5 6 1.5Zm0 0c1.5-3.5 6-4.5 6-1.5 0 1.5-3 1.5-6 1.5Z"/></svg></span><div class="pr-13-text"><h2>13th Month Pay</h2><p>Review annual accruals and employee payouts.</p></div><div class="th-year-pick"><label class="field">Year<input id="th-year-select" type="text" inputmode="numeric" maxlength="4" placeholder="YYYY" value="${esc(thisYear)}" aria-label="Year (YYYY)"></label><button class="primary pr-13-open" data-th-open-selected><svg class="pr-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="9" width="17" height="11.5" rx="1.5"/><path d="M3 9h18M12 9v11.5M12 9c-1.5-3.5-6-4.5-6-1.5 0 1.5 3 1.5 6 1.5Zm0 0c1.5-3.5 6-4.5 6-1.5 0 1.5-3 1.5-6 1.5Z"/></svg>Open 13th Month Pay</button></div></div>`; };
    draw();
    box.onclick = async e => {
      if (e.target.closest('[data-th-add]')) { try { const r = await api('/thirteenth/years', {}); years.push(String(r.lastYear)); current.lastYear = r.lastYear; draw(); box.querySelector('#th-year-select').value = String(r.lastYear); } catch (err) { toast(err.message); } return; }
      if (e.target.closest('[data-th-open-selected]')) { const y = box.querySelector('#th-year-select').value.trim(); if (!/^\d{4}$/.test(y)) { toast('Type the year as YYYY, e.g. 2027.'); return; } openYear(y); }
    };
    return box;
  }
  async function render() {
    if (!year) year = today().slice(0, 4);
    shell(heading('13th month & final pay', 'Loading…') + '<div class="loading">Loading the ledger…</div>');
    [data, finalData] = await Promise.all([api(`/thirteenth?year=${year}`), api('/final-pay').catch(() => null)]);
    const L = data.ledger, editable = data.canEncode;
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const prior = new Map(data.prior.map(p => [`${p.employeeId}:${p.month}`, p]));
    // Total earned and 13th month pay: computed, but HR can type a different amount (blank = back to the computation).
    const ovBox = (r, kind, value, computed, edited) => `<span class="th-peso"><input class="share-input th-ov${kind === '13th' ? ' th-13' : ''}${edited ? ' th-edited' : ''}" type="text" inputmode="decimal" data-amount data-th-ov="${kind}" data-emp="${esc(r.employeeId)}" value="${fmtAmount(value)}" aria-label="${esc(r.name)} ${kind === '13th' ? '13th month pay' : 'total earned'}" title="${edited ? `Edited · computed ${fmtAmount(computed)}` : 'Computed'}"${editable ? '' : ' disabled'}></span>`;
    // The employee's name opens their 13th month payslip PDF: the finalized one when the year is paid in full on a
    // payslip, otherwise the draft built from the saved records.
    const nameCell = r => {
      if (!data.canPayslip) return esc(r.name);
      const final = r.balance <= 0 && data.payslips.find(p => p.employeeId === r.employeeId && p.status === 'final');
      return `<a class="employee-link" data-th-pdf href="${final ? slipUrl(final.id) : pdfUrl(r.employeeId)}" target="_blank" rel="noopener" title="Open the 13th month payslip PDF${final ? '' : ' (draft)'}">${esc(r.name)}</a>`;
    };
    const gridRow = r => [nameCell(r), ...months.map(m => {
      const posted = data.postedMonths[r.employeeId]?.includes(m), p = prior.get(`${r.employeeId}:${m}`), fromPayroll = data.postedBasic?.[r.employeeId]?.[m] || 0;
      // Fully posted month: the same peso box as the typed months, read-only (the amount comes from posted payroll).
      if (posted) return `<span class="th-peso"><input class="share-input th-posted" type="text" readonly tabindex="-1" aria-label="${esc(r.name)} basic salary ${m} (from posted payroll)" title="From posted payroll" value="${fmtAmount(fromPayroll)}"></span>`;
      // Part typed before the system + part from finalized payroll: one box with the month's total; click to see or change the typed part.
      if (fromPayroll) return `<input type="hidden" data-prior="${esc(r.employeeId)}" data-month="${m}" value="${p ? fmtAmount(p.basic) : ''}"><button type="button" class="share-input th-month-total" data-th-split="${esc(r.employeeId)}|${m}" title="Typed ${p ? fmtAmount(p.basic) : '0.00'} + payroll ${fmtAmount(fromPayroll)}">₱${fmtAmount((p?.basic || 0) + fromPayroll)}</button>`;
      return `<span class="th-peso"><input class="share-input" type="text" inputmode="decimal" data-amount aria-label="${esc(r.name)} basic salary ${m}" data-prior="${esc(r.employeeId)}" data-month="${m}" value="${p ? fmtAmount(p.basic) : ''}"${editable ? '' : ' disabled'}></span>`;
    }), ovBox(r, 'total', r.totalBasic, r.computedTotal, r.totalEdited), ovBox(r, '13th', r.accrued, r.computedAccrued, r.thirteenthEdited)];
    const thCard = (tone, icon, label, value, foot) => `<div class="th-card th-${tone}"><span>${icon}</span><div><b>${label}</b><strong>${value}</strong><small>${foot}</small></div></div>`;
    shell(`<section class="dp-hero th-hero"><span class="th-hero-art" aria-hidden="true"><svg viewBox="0 0 100 100"><rect x="8" y="16" width="80" height="74" rx="14" fill="#1f4fc8"/><rect x="8" y="16" width="80" height="22" rx="14" fill="#d7141a"/><rect x="22" y="8" width="8" height="18" rx="4" fill="#14306e"/><rect x="66" y="8" width="8" height="18" rx="4" fill="#14306e"/><rect x="18" y="44" width="60" height="38" rx="8" fill="#fff"/><text x="48" y="72" text-anchor="middle" font-size="24" font-weight="800" fill="#d7141a" font-family="Inter,Segoe UI,sans-serif">13th</text></svg></span><div class="dp-hello"><span>Payroll &amp; Attendance</span><h1>${esc(year)} 13th Month Pay</h1><p>Compute, track, and finalize 13th month pay for all employees.</p></div><button class="th-back" data-nav="payroll">← Payroll</button></section>` +
      `      <div class="th-cards">${thCard('blue', '<svg class="th-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4"/></svg>', 'Basic Earned (All Sources)', money(L.reduce((s, r) => s + r.totalBasic, 0)), `(${money(L.reduce((s, r) => s + r.priorBasic, 0))} recorded before the system)`)}${thCard('red', '<svg class="th-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="9" width="17" height="11.5" rx="1.5"/><path d="M3 9h18M12 9v11.5M12 9c-1.5-3.5-6-4.5-6-1.5 0 1.5 3 1.5 6 1.5Zm0 0c1.5-3.5 6-4.5 6-1.5 0 1.5-3 1.5-6 1.5Z"/></svg>', 'Accrued 13th Month', money(L.reduce((s, r) => s + r.accrued, 0)), 'Basic earned ÷ 12 (covered employees)')}${thCard('green', '<svg class="th-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12.5 4 4 8-9"/></svg>', 'Already Paid', money(L.reduce((s, r) => s + r.paid, 0)), 'Payroll + encoded payments')}${thCard('amber', '<svg class="th-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7Zm0 0 11-3v3"/><path d="M15 13h5"/></svg>', 'Balance to Pay', money(L.reduce((s, r) => s + r.balance, 0)), 'Release on or before December 24')}</div>

      <div class="th-info"><svg class="th-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/></svg><span>Basic salary actually earned each month (after absences and unpaid leave; exclude overtime, holiday premiums and allowances). Leave blank to clear.</span></div>
      <section class="panel th-panel">
        <div class="bal-filters th-filters"><label class="field">Company<select data-th-company><option value="">All companies</option>${companyList().map(c => `<option ${c === thCompany ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label class="field">Status<select data-th-status>${[['active', 'Active'], ['inactive', 'Not active'], ['', 'All']].map(([v, l]) => `<option value="${v}" ${v === thStatus ? 'selected' : ''}>${l}</option>`).join('')}</select></label><span class="th-tools"><button class="th-export" data-th-export><svg class="th-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M4 20h16"/></svg>Export</button><button class="th-update" data-th-update><svg class="th-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5L20 16M20 20v-4h-4"/></svg>Update Data</button></span></div>
        <div class="th-year-band"><svg class="th-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>YEAR ${esc(year)}</div>
        <div class="table-wrap th-grid">${table(['Employee', ...months.map(m => MONTHS[Number(m.slice(5)) - 1]), 'Total earned', '13th month pay'], L.map(gridRow), 'No employees.')}</div>
        ${editable ? '<div class="panel-foot"><div class="actions"><button class="small" id="th-undo" title="Undo (Ctrl+Z)" disabled>↶ Undo</button><button class="small" id="th-redo" title="Redo (Ctrl+Y)" disabled>↷ Redo</button></div><button class="primary" id="th-save">Save salary records</button></div>' : ''}</section>
      ${finalPanel()}`);
    const content = document.querySelector('.content');
    content.addEventListener('click', onClick);
    snapshot = readGrid(); savedGrid = readGrid(); syncUndo();
    applyGridFilter();
    content.addEventListener('click', e => {
      if (e.target.closest('[data-th-update]')) {
        const dirty = [...readGrid()].some(([k, v]) => savedGrid.get(k) !== v);
        if (dirty && !window.confirm('Reload the figures from the saved records? Unsaved changes in the grid will be lost.')) return;
        render(); return;
      }
      if (!e.target.closest('[data-th-export]')) return;
      const cellText = td => { const f = td.querySelector('input:not([type=hidden]), button'); return (f ? (f.value ?? f.textContent) : td.textContent).replace(/[₱,]/g, '').trim(); };
      const head = [...content.querySelectorAll('.th-grid thead th')].map(th => th.textContent.trim());
      const rows = [...content.querySelectorAll('.th-grid tbody tr')].filter(tr => !tr.hidden && tr.style.display !== 'none' && tr.children.length > 1).map(tr => [...tr.children].map((td, i) => (i ? cellText(td) : td.textContent.trim())));
      const csv = [head, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = `13th-month-${year}.csv`; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
    content.addEventListener('change', e => {
      if (e.target.matches('[data-th-company]')) { thCompany = e.target.value; applyGridFilter(); }
      else if (e.target.matches('[data-th-status]')) { thStatus = e.target.value; applyGridFilter(); }
    });
    // A payslip shows the saved records only: opening one with unsaved changes in the grid asks to save first.
    content.addEventListener('click', e => {
      const link = e.target.closest('[data-th-pdf]'); if (!link) return;
      const dirty = [...readGrid()].some(([k, v]) => savedGrid.get(k) !== v);
      if (dirty) { e.preventDefault(); toast('Save salary records first: the payslip shows saved records only.'); }
    });
    content.addEventListener('change', e => { if (e.target.closest('.th-grid')) recordStep(); });
    // Live formula: Jan + Feb + … + Dec = Total earned; Total earned ÷ 12 = 13th month pay.
    content.addEventListener('input', e => {
      const t = e.target, emp = t.dataset.thOv === 'total' ? t.dataset.emp : t.dataset.prior;
      if (!emp || !(t.dataset.thOv === 'total' || t.dataset.month)) return;
      const row = data.ledger.find(x => x.employeeId === emp), box = kind => content.querySelector(`[data-th-ov="${kind}"][data-emp="${CSS.escape(emp)}"]`);
      if (!row) return;
      let total;
      if (t.dataset.month) { total = rowSum(emp); if (box('total')) box('total').value = fmtAmount(total); }
      else { const raw = parseAmount(t.value); total = raw === '' ? rowSum(emp) : Number(raw); }
      if (Number.isNaN(total) || !box('13th')) return;
      box('13th').value = fmtAmount(row.covered13th ? r2(total / 12) : 0);
    });
    content.addEventListener('change', e => {
      const dd = e.target.closest('.leave-dropdown'); if (!dd) return;
      const picked = [...dd.querySelectorAll('input:checked')].map(i => i.dataset.leaveName);
      dd.querySelector('[data-leave-summary]').textContent = picked.join(', ') || 'None';
    });
    content.addEventListener('change', async e => {
      const approveBtn = e.target.closest('[data-fp-approve]'), settleBtn = e.target.closest('[data-fp-settle]');
      if (approveBtn || settleBtn) {
        try {
          if (approveBtn) { if (!window.confirm('Approve this final pay computation?')) return; await api(`/final-pay/${approveBtn.dataset.fpApprove}/approve`, {}); toast('Final pay approved. Finance records the settlement next.'); }
          else { const reference = window.prompt(`Record the final pay settlement of ${settleBtn.dataset.name}.\n\nPayment reference (bank transfer / cheque number):`); if (!reference || reference.trim().length < 2) return; await api(`/final-pay/${settleBtn.dataset.fpSettle}/release`, { released: true, reference: reference.trim(), releasedOn: today() }); toast('Settlement recorded in the 201 file.'); }
          await render();
        } catch (error) { toast(error.message); }
        return;
      }
      const sel = e.target.closest('[data-fp-release]'); if (!sel) return;
      sel.disabled = true;
      try { await api(`/final-pay/${sel.dataset.fpRelease}/release`, { released: sel.value === '1' }); toast(sel.value === '1' ? 'Final pay marked as released.' : 'Final pay marked as not released.'); await render(); }
      catch (error) { toast(error.message); sel.value = sel.value === '1' ? '' : '1'; sel.disabled = false; }
    });
    content.querySelector('#fp-form')?.addEventListener('submit', onCompute);
    // Final pay → Employee: a dropdown with a search box (same as Payroll → Employee); the plain list stays if it fails to load.
    if (content.querySelector('#fp-form select[data-searchable]')) import('./searchable-select.js').then(m => m.enhanceAll(content)).catch(() => {});
    // Choosing an employee fills in the last day from their 201 record (separation / resignation date), when there is one.
    content.querySelector('#fp-form [name=employeeId]')?.addEventListener('change', e => { const end = e.target.selectedOptions[0]?.dataset.end; if (end) e.target.form.separationDate.value = end; });
  }

  // ---------- 13th month payslips (one per employee per year) ----------
  const pdfUrl = (emp, download = false) => `/api/thirteenth/payslip.pdf?employeeId=${encodeURIComponent(emp)}&year=${year}${download ? '&download=1' : ''}`;
  const slipUrl = (id, download = false) => `/api/thirteenth/payslips/${id}.pdf${download ? '?download=1' : ''}`;
  async function finalizeDialog(employeeId) {
    if ([...readGrid()].some(([k, v]) => savedGrid.get(k) !== v)) { toast('Save salary records first: the payslip shows saved records only.'); return; }
    const d = await api(`/thirteenth/payslip?employeeId=${encodeURIComponent(employeeId)}&year=${year}`);
    openDialog(`Finalize 13th month payslip · ${d.employeeName}`, `<div class="dialog-body"><p>${esc(year)} 13th month pay of <strong>${esc(d.employeeName)}</strong> (${esc(d.employeeId)}).</p>
      ${table(['', 'Amount'], [['Total basic salary earned', money(d.totalBasic)], ['13th month pay', money(d.thirteenth)], ['Approved adjustments', money(d.adjustmentsTotal)], ['Total due', money(d.totalDue)], ['Less previous payments', money(d.previousTotal)], ['<strong>Amount to pay now</strong>', `<strong>${money(d.remaining)}</strong>`]])}
      ${d.pendingAdjustments ? '<div class="notice">An adjustment is waiting for approval. Approve or reject it before finalizing.</div>' : ''}
      <p class="sub">Once finalized, this payslip cannot be edited and ${money(d.remaining)} is recorded as paid. Payroll will not pay it again. Check the <a href="${pdfUrl(employeeId)}" target="_blank" rel="noopener">draft PDF</a> first.</p></div>
      <div class="dialog-foot"><button data-close>Continue reviewing</button><button class="primary" id="th-confirm-final"${d.pendingAdjustments || d.remaining <= 0 ? ' disabled' : ''}>Finalize payslip</button></div>`);
    dialog.querySelector('#th-confirm-final').onclick = async ev => {
      ev.target.disabled = true;
      try { await api('/thirteenth/payslips', { employeeId, year, fingerprint: d.fingerprint }); dialog.close(); toast('13th month payslip finalized.'); await render(); }
      catch (error) { ev.target.disabled = false; toast(error.message); }
    };
  }
  function adjustDialog(employeeId) {
    const r = data.ledger.find(x => x.employeeId === employeeId);
    openDialog(`13th month adjustment · ${r.name}`, `<form id="th-adj-form"><div class="dialog-body form-grid">
      <label class="field">Amount<input name="amount" type="text" inputmode="decimal" data-amount required placeholder="1,000.00 or -1,000.00"><small>Positive adds to the 13th month pay; negative deducts.</small></label>
      <label class="field full">Reason<input name="reason" required minlength="3" maxlength="500"></label>
      <p class="sub full">${data.canApprove ? 'Your adjustment is approved when saved.' : 'An administrator approves it before it counts.'} It appears on the payslip with its reason.</p></div>
      <div class="dialog-foot"><button type="button" data-close>Close</button><button class="primary">Save adjustment</button></div></form>`);
    dialog.querySelector('#th-adj-form').onsubmit = async ev => {
      ev.preventDefault(); const f = new FormData(ev.target), amount = Number(parseAmount(f.get('amount')));
      if (!amount || Number.isNaN(amount)) { toast('Enter an amount such as 1,000.00 or -1,000.00.'); return; }
      try { await api('/thirteenth/adjustments', { employeeId, year, amount, reason: String(f.get('reason')) }); dialog.close(); toast(data.canApprove ? 'Adjustment saved.' : 'Adjustment sent for approval.'); await render(); } catch (error) { toast(error.message); }
    };
  }
  function voidDialog(id) {
    openDialog('Cancel 13th month payslip', `<form id="th-void-form"><div class="dialog-body"><p>The amount on this payslip will no longer count as paid. The payslip stays in the records, marked cancelled.</p><label class="field">Reason<input name="reason" required minlength="3" maxlength="500"></label></div>
      <div class="dialog-foot"><button type="button" data-close>Keep it</button><button class="primary">Cancel payslip</button></div></form>`);
    dialog.querySelector('#th-void-form').onsubmit = async ev => {
      ev.preventDefault();
      try { await api(`/thirteenth/payslips/${id}/void`, { reason: String(new FormData(ev.target).get('reason')) }); dialog.close(); toast('Payslip cancelled.'); await render(); } catch (error) { toast(error.message); }
    };
  }

  // Final pay (Nov 25, 2026 design): banner, two-column form with field icons, red Compute button, table with chips.
  const fpI = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const FP = {
    person: fpI('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
    cal: fpI('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01"/>'),
    scale: fpI('<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>'),
    note: fpI('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
    doc: fpI('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    chat: fpI('<path d="M4 5h16v11H9l-5 4z"/>'),
    case: fpI('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18"/>'),
    coins: fpI('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4"/>'),
    minus: fpI('<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>'),
    pct: fpI('<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>'),
    calc: fpI('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h4"/>'),
    info: fpI('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>'),
    clip: fpI('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h6"/>'),
    check: fpI('<path d="m6 12.5 4 4 8-9"/>'),
  };
  const fpRow = (icon, inner) => `<div class="fp-row"><span class="fp-ico">${icon}</span>${inner}</div>`;
  const fpPeso = (name, attrs) => `<span class="fp-peso"><i>₱</i><input type="number" name="${name}" ${attrs}></span>`;
  const fpInitials = name => { const [last, first] = String(name).split(',').map(x => x.trim()); return `${(first || last || '?')[0]}${first ? (last || '')[0] : ''}`.toUpperCase(); };
  function finalPanel() {
    if (!finalData) return '';
    const emps = data.ledger.slice().sort((a, b) => a.name.localeCompare(b.name));
    const leaveField = finalData.leaveTypes.length ? `<details class="leave-dropdown"><summary data-leave-summary>${esc(finalData.leaveTypes.filter(t => /service incentive|\bsil\b/i.test(t.name)).map(t => t.name).join(', ') || 'None')}</summary><div class="leave-options">${finalData.leaveTypes.map(t => `<label class="check"><input type="checkbox" name="convertLeave" value="${esc(t.id)}" data-leave-name="${esc(t.name)}"${/service incentive|\bsil\b/i.test(t.name) ? ' checked' : ''}> ${esc(t.name)}</label>`).join('')}</div></details>` : '<small>No leave types configured.</small>';
    const status = r => (r.stage === 'released' ? `<span class="fp-status fp-released">${FP.check}Released</span><small class="muted">${fmt(r.release.releasedOn)}${r.release.reference ? ` · ${esc(r.release.reference)}` : ''}</small>` : r.stage === 'approved' ? `<span class="fp-status fp-approved">${FP.check}Approved</span>` : '<span class="fp-status fp-prepared">Prepared</span>');
    const action = r => (r.stage === 'approved' ? (finalData.canSettle ? `<button class="fp-act" data-fp-settle="${esc(r.id)}" data-name="${esc(r.name)}">${FP.doc}Record Settlement</button>` : '<small class="muted">Awaiting Finance</small>') : r.stage === 'prepared' || !r.stage ? (finalData.canApprove ? `<button class="fp-act" data-fp-approve="${esc(r.id)}">${FP.check}Approve</button>` : '<small class="muted">Awaiting approval</small>') : '<span class="muted">—</span>');
    return `<section class="dp-hero fp-hero"><span class="fp-hero-art" aria-hidden="true"><svg viewBox="0 0 110 100"><rect x="8" y="6" width="62" height="80" rx="12" fill="#1f4fc8" transform="rotate(-10 39 46)"/><rect x="18" y="14" width="42" height="16" rx="4" fill="#cfe0fb" transform="rotate(-10 39 46)"/><g fill="#fff" transform="rotate(-10 39 46)"><rect x="18" y="38" width="10" height="9" rx="2"/><rect x="34" y="38" width="10" height="9" rx="2"/><rect x="50" y="38" width="10" height="9" rx="2"/><rect x="18" y="53" width="10" height="9" rx="2"/><rect x="34" y="53" width="10" height="9" rx="2"/><rect x="50" y="53" width="10" height="9" rx="2"/></g><g fill="#f2b33d" stroke="#c98a12" stroke-width="2"><ellipse cx="82" cy="88" rx="20" ry="7"/><ellipse cx="82" cy="80" rx="20" ry="7"/><ellipse cx="82" cy="72" rx="20" ry="7"/><ellipse cx="86" cy="60" rx="16" ry="6"/></g></svg></span><div class="dp-hello"><span>Payroll</span><h1>Final Pay</h1><p>Compute an employee’s final pay, including separation and last earnings.</p></div></section>
    <section class="panel fp-panel"><div class="fp-head"><span class="fp-head-ico">${FP.clip}</span><h2>Final Pay Computation</h2><span class="fp-advisory">${FP.info}Labor Advisory 06-2020: release within 30 days of separation. Certificate of Employment within 3 days of request.</span></div>
      <form id="fp-form" class="fp-form"><div class="fp-col">
        ${fpRow(FP.person, `<label class="field"><span>Employee <b>*</b></span><select name="employeeId" required data-searchable data-search-placeholder="Search employee name or ID" data-required-message="Choose the employee."><option value="">Choose employee…</option>${emps.map(e => `<option value="${esc(e.employeeId)}" data-end="${esc(e.endDate || '')}">${esc(e.name)}</option>`).join('')}</select></label>`)}
        ${fpRow(FP.cal, '<label class="field">Unpaid days worked (optional)<input type="number" name="unpaidDays" min="0" step="0.5"><small>Blank = scheduled workdays after the last paid cutoff up to the last day.</small></label>')}
        ${fpRow(FP.scale, `<div class="field"><span>Convert unused leave to cash</span>${leaveField}<small>Service Incentive Leave is convertible by law, other leave only if company policy says so.</small></div>`)}
        <label class="check fp-check"><input type="checkbox" name="deductLoans" checked> Deduct outstanding loans</label>
        ${fpRow(FP.note, '<label class="field">Other earnings note<input name="otherEarningsNote" maxlength="500" placeholder="Enter other earnings (e.g., bonus, allowance)…"></label>')}
        ${fpRow(FP.doc, '<label class="field">Deductions note<input name="otherDeductionsNote" maxlength="500" placeholder="Enter deductions (e.g., advances, loans)…"></label>')}
        ${fpRow(FP.chat, '<label class="field">Notes<input name="notes" maxlength="2000" placeholder="Add additional notes…"></label>')}
      </div><div class="fp-col">
        ${fpRow(FP.cal, `<label class="field"><span>Last day / separation date <b>*</b></span><input type="date" name="separationDate" required value="${today()}"></label>`)}
        ${fpRow(FP.case, '<label class="field">Separation pay<select name="separationCause"><option value="none">None (resignation, end of contract, just cause)</option><option value="redundancy">Redundancy / labor-saving devices (1 month per year)</option><option value="retrenchment">Retrenchment / closure / disease (½ month per year)</option></select></label>')}
        ${fpRow(FP.coins, `<label class="field">Other earnings${fpPeso('otherEarnings', 'min="0" step="0.01" value="0"')}</label>`)}
        ${fpRow(FP.minus, `<label class="field">Other deductions / accountabilities${fpPeso('otherDeductions', 'min="0" step="0.01" value="0"')}</label>`)}
        ${fpRow(FP.pct, `<label class="field">Tax adjustment (+ due, − refund)${fpPeso('taxAdjustment', 'step="0.01" value="0"')}</label>`)}
        <div class="fp-submit"><button class="primary fp-compute">${FP.calc}Compute Final Pay</button></div>
      </div></form><div id="fp-result"></div>
      <div class="fp-table">${table(['Employee', 'Separation', 'Net final pay', 'Release due', 'Computed by', 'Status', 'Action'], finalData.records.map(r => [`<span class="fp-emp"><i>${esc(fpInitials(r.name))}</i><a class="employee-link" href="/api/final-pay/${esc(r.id)}.pdf" target="_blank" rel="noopener" title="Open the final pay PDF">${esc(r.name)}</a></span>`, `<span class="fp-date">${FP.cal}${fmt(r.separationDate)}</span>`, `<span class="fp-net">${money(r.net)}</span>`, `<span class="fp-date">${FP.cal}${fmt(r.releaseDue)}</span>`, `<span class="fp-by">${FP.person}${esc(who(r.computedBy))}</span>`, status(r), action(r)]), 'No saved final pay computations yet.')}</div></section>`;
  }

  const resultHtml = r => `<div class="panel-body"><h3>${esc(r.name)} · final pay as of ${fmt(r.separationDate)}</h3><p class="legend">Daily rate ${money(r.dailyRate)} · monthly ${money(r.monthlySalary)} · ${r.yearsOfService} year${r.yearsOfService === 1 ? '' : 's'} of service (counted) · release due ${fmt(r.releaseDue)}</p>
    ${table(['Item', 'Basis', 'Earnings', 'Deductions'], r.items.map(i => [esc(i.label), `<span class="wrap">${esc(i.basis)}</span>`, i.side === 'earnings' ? money(i.amount) : '', i.side === 'deductions' ? money(i.amount) : '']), 'Nothing due.')}
    <div class="bd-total"><span>Gross ${money(r.gross)} − deductions ${money(r.deductions)}</span><strong>Net ${money(r.net)}</strong></div></div>`;

  async function onCompute(event) {
    event.preventDefault(); const f = new FormData(event.target);
    lastInput = { employeeId: f.get('employeeId'), separationDate: f.get('separationDate'), unpaidDays: f.get('unpaidDays') === '' ? null : Number(f.get('unpaidDays')), separationCause: f.get('separationCause'), convertLeave: f.getAll('convertLeave'), deductLoans: f.get('deductLoans') === 'on', otherEarnings: Number(f.get('otherEarnings') || 0), otherEarningsNote: f.get('otherEarningsNote'), otherDeductions: Number(f.get('otherDeductions') || 0), otherDeductionsNote: f.get('otherDeductionsNote'), taxAdjustment: Number(f.get('taxAdjustment') || 0), notes: f.get('notes') };
    try {
      lastResult = await api('/final-pay/compute', lastInput);
      document.querySelector('#fp-result').innerHTML = resultHtml(lastResult) + '<div class="actions"><button class="primary" data-final-save>Save this computation</button><span class="legend">Saved computations are kept with who computed them and are recorded in the audit log.</span></div>';
    } catch (error) { toast(error.message); }
  }

  async function onClick(event) {
    const b = event.target.closest('button'); if (!b) return;
    try {
      if (b.id === 'th-undo') { applyStep(history.undo, history.redo, 'before'); return; }
      if (b.id === 'th-redo') { applyStep(history.redo, history.undo, 'after'); return; }
      if (b.id === 'th-save') {
        recordStep();
        const bad = [...document.querySelectorAll('[data-prior]')].find(i => parseAmount(i.value) !== '' && (Number.isNaN(Number(parseAmount(i.value))) || Number(parseAmount(i.value)) < 0));
        if (bad) { bad.focus(); toast(`Check the amount “${bad.value}”: enter a number such as 1,000.00.`); return; }
        const entries = [...document.querySelectorAll('[data-prior]')].flatMap(input => {
          const p = data.prior.find(x => x.employeeId === input.dataset.prior && x.month === input.dataset.month), value = parseAmount(input.value);
          if (value === '' && !p) return [];
          if (p && value !== '' && Number(value) === p.basic) return [];
          return [{ employeeId: input.dataset.prior, month: input.dataset.month, basic: value === '' ? null : Number(value), thirteenthPaid: p?.thirteenthPaid || 0, notes: p?.notes || '' }];
        });
        const badOv = [...document.querySelectorAll('[data-th-ov]')].find(i => parseAmount(i.value) !== '' && (Number.isNaN(Number(parseAmount(i.value))) || Number(parseAmount(i.value)) < 0));
        if (badOv) { badOv.focus(); toast(`Check the amount “${badOv.value}”: enter a number such as 1,000.00.`); return; }
        const overrides = data.ledger.flatMap(row => {
          const box = kind => document.querySelector(`[data-th-ov="${kind}"][data-emp="${CSS.escape(row.employeeId)}"]`);
          const read = (el, computed) => { const v = parseAmount(el?.value); return v === '' || Number(v) === computed ? null : Number(v); };
          const sum = rowSum(row.employeeId), totalBasic = read(box('total'), sum), thirteenth = read(box('13th'), row.covered13th ? r2((totalBasic ?? sum) / 12) : 0);
          const was = { totalBasic: row.totalEdited ? row.totalBasic : null, thirteenth: row.thirteenthEdited ? row.accrued : null };
          return totalBasic === was.totalBasic && thirteenth === was.thirteenth ? [] : [{ employeeId: row.employeeId, totalBasic, thirteenth }];
        });
        if (!entries.length && !overrides.length) { toast('No changes to save.'); return; }
        if (overrides.length) await api('/thirteenth/overrides', { year, entries: overrides });
        if (!entries.length) { toast('Saved. Totals updated.'); await render(); return; }
        const r = await api('/thirteenth/prior', { entries }); toast(`Saved ${r.saved} month${r.saved === 1 ? '' : 's'}${r.removed ? `, cleared ${r.removed}` : ''}. The 13th month was recalculated.`); await render();
      }
      if (b.dataset.priorDetail) detail(b.dataset.priorDetail);
      if (b.dataset.thFinalize) await finalizeDialog(b.dataset.thFinalize);
      if (b.dataset.thAdjust) adjustDialog(b.dataset.thAdjust);
      if (b.dataset.thVoid) voidDialog(b.dataset.thVoid);
      if (b.dataset.thReview) { const [id, decision] = b.dataset.thReview.split('|'); await api(`/thirteenth/adjustments/${id}/review`, { decision }); toast(decision === 'approve' ? 'Adjustment approved.' : 'Adjustment rejected.'); await render(); }
      if (b.dataset.thSplit) { const [id, m] = b.dataset.thSplit.split('|'); splitMonth(id, m); }
      if (b.hasAttribute('data-final-save')) {
        await api('/final-pay/compute', { ...lastInput, save: true }); toast('Final pay computation saved.'); await render();
      }
    } catch (error) { toast(error.message); }
  }

  // A month made of a typed part and finalized payroll: shows both parts (by cutoff) and lets HR change the typed part.
  function splitMonth(employeeId, m) {
    const r = data.ledger.find(x => x.employeeId === employeeId), p = data.prior.find(x => x.employeeId === employeeId && x.month === m);
    const cutoffs = data.postedCutoffs?.[employeeId]?.[m] || [], day = d => Number(d.slice(8));
    const mon = MONTHS[Number(m.slice(5)) - 1], typedPart = cutoffs.length && cutoffs.every(c => day(c.start) === 16) ? `${mon} 1–15` : cutoffs.length && cutoffs.every(c => day(c.start) === 1) ? `${mon} 16–${new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate()}` : 'Typed (before the system)';
    const payroll = cutoffs.reduce((s, c) => s + c.basic, 0);
    openDialog(`${mon} ${year} · ${r.name}`, `<form id="th-split-form"><div class="dialog-body">${table(['Period', 'Basic salary', ''], [
      [esc(typedPart), `<input class="share-input" type="text" inputmode="decimal" data-amount name="basic" value="${p ? fmtAmount(p.basic) : ''}" aria-label="${esc(typedPart)} basic salary"${data.canEncode ? '' : ' disabled'}>`, '<small>Typed</small>'],
      ...cutoffs.map(c => [`${mon} ${day(c.start)}–${day(c.end)}`, `<strong>${fmtAmount(c.basic)}</strong>`, '<small>Finalized payroll</small>']),
      ['<strong>Total</strong>', `<strong id="th-split-total">${fmtAmount((p?.basic || 0) + payroll)}</strong>`, '']])}</div>
      <div class="dialog-foot"><button type="button" data-close>Close</button>${data.canEncode ? '<button class="primary">Save</button>' : ''}</div></form>`);
    const form = dialog.querySelector('#th-split-form'), input = form.querySelector('[name=basic]');
    input.oninput = () => { const v = Number(parseAmount(input.value) || 0); form.querySelector('#th-split-total').textContent = fmtAmount((Number.isNaN(v) ? 0 : v) + payroll); input.setCustomValidity(''); };
    form.onsubmit = async ev => {
      ev.preventDefault(); const value = parseAmount(input.value);
      if (value !== '' && (Number.isNaN(Number(value)) || Number(value) < 0)) { input.setCustomValidity('Enter a number such as 1,000.00.'); input.reportValidity(); return; }
      if ((value === '' && !p) || (p && value !== '' && Number(value) === p.basic)) { dialog.close(); return; }
      try { await api('/thirteenth/prior', { entries: [{ employeeId, month: m, basic: value === '' ? null : Number(value), thirteenthPaid: p?.thirteenthPaid || 0, notes: p?.notes || '' }] }); dialog.close(); toast('Saved. The 13th month was recalculated.'); await render(); } catch (error) { toast(error.message); }
    };
  }
  // Per-employee detail: basic, 13th month already paid and notes per month.
  function detail(employeeId) {
    const r = data.ledger.find(x => x.employeeId === employeeId), lastMonth = year === today().slice(0, 4) ? Number(today().slice(5, 7)) : 12;   // details: months up to now
    const rows = Array.from({ length: lastMonth }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).map(m => {
      const p = data.prior.find(x => x.employeeId === employeeId && x.month === m), posted = data.postedMonths[employeeId]?.includes(m);
      return [MONTHS[Number(m.slice(5)) - 1], posted ? '<span class="share-state">From posted payroll</span>' : `<input class="share-input" type="text" inputmode="decimal" data-amount name="basic-${m}" value="${p ? fmtAmount(p.basic) : ''}" aria-label="Basic ${m}"${data.canEncode ? '' : ' disabled'}>`, posted ? '' : `<input class="share-input" type="text" inputmode="decimal" data-amount name="paid-${m}" value="${p?.thirteenthPaid ? fmtAmount(p.thirteenthPaid) : ''}" aria-label="13th month paid ${m}"${data.canEncode ? '' : ' disabled'}>`, posted ? '' : `<input name="notes-${m}" maxlength="500" value="${esc(p?.notes || '')}" aria-label="Notes ${m}"${data.canEncode ? '' : ' disabled'}>`, p ? `<small>${esc(who(p.enteredBy))} · ${fmt(p.enteredAt)}</small>` : ''];
    });
    openDialog(`Salary records · ${r.name}`, `<form id="prior-detail"><div class="dialog-body"><p class="sub">Basic salary earned and any 13th month already paid (advance or partial) for each month before the system.</p>${table(['Month', 'Basic salary earned', '13th month paid', 'Notes', 'Encoded by'], rows)}</div>
      <div class="dialog-foot"><button type="button" data-close>Close</button>${data.canEncode ? '<button class="primary">Save</button>' : ''}</div></form>`);
    dialog.querySelector('#prior-detail').onsubmit = async ev => {
      ev.preventDefault(); const f = new FormData(ev.target), entries = [];
      const bad = [...ev.target.querySelectorAll('[data-amount]')].find(i => parseAmount(i.value) !== '' && (Number.isNaN(Number(parseAmount(i.value))) || Number(parseAmount(i.value)) < 0));
      if (bad) { bad.focus(); bad.setCustomValidity('Enter a number such as 1,000.00.'); bad.reportValidity(); bad.oninput = () => bad.setCustomValidity(''); return; }
      for (const [key] of f.entries()) {
        if (!key.startsWith('basic-')) continue;
        const m = key.slice(6), basic = parseAmount(f.get(key)), p = data.prior.find(x => x.employeeId === employeeId && x.month === m);
        const paid = Number(parseAmount(f.get(`paid-${m}`)) || 0), notes = String(f.get(`notes-${m}`) || '');
        if (basic === '' && !p) { if (paid) { toast(`Enter the basic salary for ${m} before the 13th month paid.`); return; } continue; }
        if (p && basic !== '' && Number(basic) === p.basic && paid === (p.thirteenthPaid || 0) && notes === (p.notes || '')) continue;
        entries.push({ employeeId, month: m, basic: basic === '' ? null : Number(basic), thirteenthPaid: paid, notes });
      }
      if (!entries.length) { dialog.close(); return; }
      try { await api('/thirteenth/prior', { entries }); dialog.close(); toast('Salary records saved.'); await render(); } catch (error) { toast(error.message); }
    };
  }
  return { open, section, render };
}
