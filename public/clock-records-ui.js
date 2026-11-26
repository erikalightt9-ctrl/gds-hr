// Attendance -> Time in / out records (HR / Admin only): every office and off-site time in / out of a month with the
// captured address, GPS coordinates and accuracy, office Wi-Fi verification, device connection, flags for review and
// HR corrections, and a map for each location. Original records cannot be edited here.
const fmtDay = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const stamp = iso => (iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '');
const isCorrection = e => e.latitude === null || e.latitude === undefined;
const typeOf = e => (isCorrection(e) ? 'correction' : e.attendanceType === 'offsite' || e.outOfOffice ? 'offsite' : 'office');
const TYPE_LABEL = { office: 'Office', offsite: 'Off-site work', correction: 'HR correction' };

export function createClockRecordsUi({ api, esc, badge, openDialog, employees, today }) {
  let list = [], month = '', filters = { employee: '', type: '', flagged: false };
  const name = id => employees().find(e => e.id === id)?.name || id;
  const network = e => {
    if (isCorrection(e)) return '<span class="muted">—</span>';
    const verified = e.network ? e.network.verified : e.onOfficeNetwork;
    return `${verified ? badge('Office Wi-Fi verified', '') : e.officeBy === 'gps' ? badge('Office by GPS · Wi-Fi not verified', 'pending') : badge('Not office Wi-Fi', 'neutral')}`;
  };
  const rows = () => list.filter(e => (!filters.employee || e.employeeId === filters.employee) && (!filters.type || typeOf(e) === filters.type) && (!filters.flagged || e.flags?.length));

  // Page (Nov 26, 2026 design): blue clock header with skyline, four count cards (All / Office / Off-site / Flagged),
  // month + employee pills, Filter (flagged only) and Export (CSV), type tabs, numbered table with initials, Time in /
  // Time out columns (one punch per row), status chip, remarks, View (details and map) and a ⋯ menu; 10 rows per page.
  const PER_PAGE = 10;
  const g = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const I = { clock: g('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), people: g('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'), check: g('<path d="m6 12.5 4 4 8-9"/>'), pin: g('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>'), cal: g('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01"/>'), arrow: g('<path d="M5 12h14M13 6l6 6-6 6"/>'), person: g('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'), funnel: g('<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>'), export: g('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'), eye: g('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'), dots: g('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'), left: g('<path d="M19 12H5M11 6l-6 6 6 6"/>'), warn: g('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.01"/>'), edit: g('<path d="M4 20h4L19 9l-4-4L4 16Z"/>') };
  const initials = n => { const [last, first] = String(n).split(',').map(x => x.trim()); return `${(first || last || '?')[0]}${first ? last[0] : ''}`.toUpperCase(); };
  const ampm = t => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : '—'; };
  const pct = (n, of) => (of ? `${((n / of) * 100).toFixed(1)}%` : '0%');
  let page = 1;
  function render(box) {
    const shown = rows(), count = t => list.filter(e => typeOf(e) === t).length, flagged = list.filter(e => e.flags?.length && !e.flagResolution).length;
    const people = [...new Set(list.map(e => e.employeeId))].map(id => [id, name(id)]).sort((a, b) => a[1].localeCompare(b[1]));
    const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE)); page = Math.min(page, pages);
    const from = (page - 1) * PER_PAGE, slice = shown.slice(from, from + PER_PAGE);
    const card = (cls, attr, icon, n, label, extra = '') => `<button class="crx-card crx-${cls}${attr.active ? ' active' : ''}" ${attr.data}><span class="crx-card-ico">${icon}</span><span class="crx-card-num"><strong>${n}</strong><small>${label}</small></span>${extra}</button>`;
    const tab = (key, label, n) => `<button data-cr-type="${key}" class="${filters.type === key && !filters.flagged ? 'active' : ''}">${key === '' ? I.clock : key === 'office' ? I.check : key === 'offsite' ? I.pin : I.edit}${label} (${n})</button>`;
    const status = e => { const t = typeOf(e); return `<span class="crx-st crx-st-${t}">${t === 'office' ? I.check : t === 'offsite' ? I.pin : I.edit}${TYPE_LABEL[t]}</span>`; };
    const remarks = e => [e.reason ? esc(e.reason) : '', ...(e.flags || []).map(f => `<span class="crx-flag">${I.warn}${esc(f)}</span>`), e.flagResolution ? `<span class="crx-ok">✓ Resolved by ${esc(e.flagResolution.by)}</span>` : ''].filter(Boolean).join('') || '—';
    const pageNums = () => { const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b); return nums.map((n, i) => `${i && n - nums[i - 1] > 1 ? '<span class="crx-gap">…</span>' : ''}<button data-cr-page="${n}" class="${n === page ? 'active' : ''}">${n}</button>`).join(''); };
    box.innerHTML = `<section class="crx">
      <header class="crx-hero"><span class="crx-hero-ico">${I.clock}</span><div><h2>Time In / Out Records</h2><p>View and manage office attendance records. Office attendance needs the authorized office Wi-Fi; off-site work records the confirmed address and GPS reading. Original records cannot be changed; HR corrections are listed separately.</p></div></header>
      <div class="crx-cards">${card('all', { active: !filters.type && !filters.flagged, data: 'data-cr-type=""' }, I.people, list.length, 'All Records', `<i class="crx-go">${I.arrow}</i>`)}${card('office', { active: filters.type === 'office', data: 'data-cr-type="office"' }, I.check, count('office'), 'Office', `<em>${pct(count('office'), list.length)}</em>`)}${card('offsite', { active: filters.type === 'offsite', data: 'data-cr-type="offsite"' }, I.pin, count('offsite'), 'Off-site Work', `<em>${pct(count('offsite'), list.length)}</em>`)}${card('flag', { active: filters.flagged, data: 'data-cr-flagged' }, I.cal, flagged, 'Flagged for Review', `<i class="crx-go">${I.arrow}</i>`)}</div>
      <div class="crx-tools"><label class="crx-pill">${I.cal}<span>Month</span><input type="month" data-cr-month value="${esc(month)}" aria-label="Month"></label><label class="crx-pill">${I.person}<span>Employee</span><select data-cr-filter="employee" aria-label="Employee"><option value="">All Employees</option>${people.map(([id, n]) => `<option value="${esc(id)}" ${id === filters.employee ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <span class="crx-right"><button class="crx-filter${filters.flagged ? ' on' : ''}" data-cr-flagtoggle title="Show only records flagged for review">${I.funnel}Filter</button><button class="crx-export" data-cr-export>${I.export}Export</button></span></div>
      <section class="crx-panel"><nav class="crx-tabs">${tab('', 'All Records', list.length)}${tab('office', 'Office', count('office'))}${tab('offsite', 'Off-site', count('offsite'))}${count('correction') ? tab('correction', 'HR corrections', count('correction')) : ''}</nav>
      <div class="crx-wrap"><table class="crx-table"><thead><tr><th>#</th><th>Employee</th><th>Date</th><th>Time In</th><th>Time Out</th><th>Status</th><th>Remarks</th><th class="crx-act">Actions</th></tr></thead><tbody>
      ${slice.map((e, i) => `<tr class="${e.flags?.length && !e.flagResolution ? 'cr-flagged' : ''}"><td class="crx-n">${from + i + 1}</td><td><span class="crx-emp"><i>${esc(initials(name(e.employeeId)))}</i><span><strong>${esc(name(e.employeeId))}</strong><small>${esc(e.employeeId)}</small></span></span></td><td>${esc(fmtDay(e.workDate))}</td>
        <td class="crx-in">${e.kind === 'in' ? esc(ampm(e.time)) : '—'}</td><td class="crx-out">${e.kind === 'in' ? '—' : esc(ampm(e.time))}</td><td>${status(e)}</td><td class="crx-rem">${remarks(e)}</td>
        <td class="crx-act"><button class="crx-view" data-cr-view="${esc(e.id)}">${I.eye}View</button><details class="crx-more"><summary aria-label="More actions">${I.dots}</summary><div>${isCorrection(e) ? '' : `<a href="https://www.google.com/maps/search/?api=1&query=${esc(e.latitude)},${esc(e.longitude)}" target="_blank" rel="noopener noreferrer">Open pin in Google Maps</a>`}${e.flags?.length && !e.flagResolution ? `<button data-cr-resolve="${esc(e.id)}">Resolve flag…</button>` : ''}<button data-cr-view="${esc(e.id)}">View details</button></div></details></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nothing to show yet.</td></tr>'}
      </tbody></table></div>
      <div class="crx-foot"><span>Showing ${shown.length ? `${from + 1}–${from + slice.length}` : '0'} of ${shown.length} records</span><span class="crx-pages"><button data-cr-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${pageNums()}<button data-cr-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page" class="crx-next">${I.left}</button></span></div></section></section>`;
  }
  function exportCsv() {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Employee', 'ID', 'Date', 'Punch', 'Time', 'Type', 'Address', 'GPS', 'Accuracy (m)', 'Network', 'Reason', 'Flags', 'Recorded'].map(cell).join(',')].concat(rows().map(e => [name(e.employeeId), e.employeeId, e.workDate, e.kind === 'in' ? 'Time in' : 'Time out', e.time, TYPE_LABEL[typeOf(e)], e.place || e.address || '', isCorrection(e) ? '' : `${e.latitude}, ${e.longitude}`, isCorrection(e) ? '' : Math.round(e.accuracy), isCorrection(e) ? '' : (e.network ? e.network.verified : e.onOfficeNetwork) ? 'Office Wi-Fi verified' : e.officeBy === 'gps' ? 'Office by GPS' : 'Not office Wi-Fi', e.reason || '', (e.flags || []).join('; '), stamp(e.recordedAt)].map(cell).join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' })); a.download = `time-in-out-${month}.csv`; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function showCorrection(e) {
    openDialog(`HR correction · ${e.kind === 'in' ? 'time in' : 'time out'} ${e.time}`, `<div class="dialog-body loc-box"><p class="loc-when">${esc(name(e.employeeId))} · ${esc(fmtDay(e.workDate))} · recorded ${esc(stamp(e.recordedAt))}</p><p>No GPS: this time was entered by HR.</p>${e.reason ? `<p class="legend">${esc(e.reason)}</p>` : ''}</div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
  }
  function showMap(e) {
    const x = Number(e.longitude), y = Number(e.latitude), bounds = [x - .003, y - .003, x + .003, y + .003].join(',');
    openDialog(`${TYPE_LABEL[typeOf(e)]} · ${e.kind === 'in' ? 'time in' : 'time out'} ${e.time}`, `<div class="dialog-body loc-box">
      <p class="loc-when">${esc(name(e.employeeId))} · ${esc(fmtDay(e.workDate))} · recorded ${esc(stamp(e.recordedAt))}</p>
      <p class="loc-place">📍 ${esc(e.place || e.address || 'No address recorded')}</p>
      <p class="loc-net">${network(e)} ${badge(TYPE_LABEL[typeOf(e)], typeOf(e) === 'offsite' ? 'pending' : '')}${e.reason ? ` <span class="legend">${esc(e.reason)}</span>` : ''}</p>
      ${e.addressCorrected ? `<p class="legend">Address found by the map service: ${esc(e.addressDetected)}</p>` : ''}
      <div class="loc-map"><iframe class="attendance-map" title="Recorded location" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bounds)}&amp;layer=mapnik&amp;marker=${encodeURIComponent(`${y},${x}`)}"></iframe></div>
      <p class="loc-actions"><a class="button small" href="https://www.google.com/maps/search/?api=1&query=${y},${x}" target="_blank" rel="noopener noreferrer">Open pin in Google Maps</a></p>
      <p class="legend">GPS ${esc(y.toFixed(6))}, ${esc(x.toFixed(6))} · accuracy ±${esc(Math.round(e.accuracy))} m${e.accuracyLimit ? ` (limit ${esc(e.accuracyLimit)} m)` : ''} · ${e.network?.verified || e.onOfficeNetwork ? 'office Wi-Fi verified' : 'not on the office Wi-Fi'}${e.network?.connection?.type ? ` · ${esc(e.network.connection.type)}` : ''}</p>
      ${(e.flags || []).map(f => `<p class="ot-flag">⚠ ${esc(f)}</p>`).join('')}
      ${e.device?.userAgent ? `<p class="legend">Device: ${esc(e.device.userAgent)}</p>` : ''}</div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
  }
  async function load(box) {
    box.innerHTML = '<div class="loading">Loading time in / out records…</div>';
    try { list = await api(`/clock-events?month=${encodeURIComponent(month)}`); render(box); } catch (error) { box.innerHTML = `<p class="muted">${esc(error.message)}</p>`; }
  }
  function fill(box) {
    month = month || today().slice(0, 7);
    box.onchange = event => {
      if (event.target.matches('[data-cr-month]')) { month = event.target.value || today().slice(0, 7); load(box); return; }
      const f = event.target.dataset.crFilter; if (f) { filters = { ...filters, [f]: event.target.value }; page = 1; render(box); }
    };
    box.onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-cr-type')) { filters = { ...filters, type: b.dataset.crType, flagged: false }; page = 1; render(box); }
      if (b.hasAttribute('data-cr-flagged')) { filters = { ...filters, type: '', flagged: true }; page = 1; render(box); }
      if (b.dataset.crView) { const e = list.find(x => x.id === b.dataset.crView); b.closest('details')?.removeAttribute('open'); if (e) (isCorrection(e) ? showCorrection : showMap)(e); }
      if (b.hasAttribute('data-cr-flagtoggle')) { filters = { ...filters, type: '', flagged: !filters.flagged }; page = 1; render(box); }
      if (b.hasAttribute('data-cr-export')) exportCsv();
      if (b.dataset.crPage) { page = Number(b.dataset.crPage); render(box); }
      if (b.dataset.crResolve) { const note = window.prompt('How was this flag resolved? (e.g. confirmed with the supervisor; the employee was at the client site)'); if (note) api(`/clock/${b.dataset.crResolve}/resolve-flag`, { note }).then(() => load(box)).catch(error => window.alert(error.message)); }
    };
    load(box);
  }
  return { panel: () => '<div data-clock-records><div class="loading">Loading time in / out records…</div></div>', fill };
}
