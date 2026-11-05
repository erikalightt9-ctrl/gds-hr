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
    const verified = e.network ? e.network.verified : e.onOfficeNetwork, conn = e.network?.connection?.type || e.network?.connection?.effectiveType;
    return `${verified ? badge('Office Wi-Fi verified', '') : badge('Not office Wi-Fi', 'neutral')}${conn ? `<small>${esc(conn)}</small>` : ''}`;
  };
  const rows = () => list.filter(e => (!filters.employee || e.employeeId === filters.employee) && (!filters.type || typeOf(e) === filters.type) && (!filters.flagged || e.flags?.length));

  function render(box) {
    const shown = rows(), count = t => list.filter(e => typeOf(e) === t).length, flagged = list.filter(e => e.flags?.length).length;
    const people = [...new Set(list.map(e => e.employeeId))].map(id => [id, name(id)]).sort((a, b) => a[1].localeCompare(b[1]));
    box.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Time in / out records</h2><p class="legend">Office attendance needs the authorized office Wi-Fi; off-site work records the confirmed address and GPS reading. Original records cannot be changed; HR corrections are listed separately.</p></div></div>
      <div class="ot-summary"><button data-cr-type="" class="${!filters.type && !filters.flagged ? 'active' : ''}"><strong>${list.length}</strong>All</button><button data-cr-type="office" class="${filters.type === 'office' ? 'active' : ''}"><strong>${count('office')}</strong>Office</button><button data-cr-type="offsite" class="${filters.type === 'offsite' ? 'active' : ''}"><strong>${count('offsite')}</strong>Off-site work</button><button data-cr-flagged class="${filters.flagged ? 'active' : ''}"><strong>${flagged}</strong>Flagged for review</button></div>
      <div class="ot-filters"><label class="field">Month<input type="month" data-cr-month value="${esc(month)}"></label><label class="field">Employee<select data-cr-filter="employee"><option value="">All employees</option>${people.map(([id, n]) => `<option value="${esc(id)}" ${id === filters.employee ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>Time</th><th>Type</th><th>Address</th><th>GPS</th><th>Network</th><th>Flags</th><th></th></tr></thead><tbody>
      ${shown.map(e => `<tr class="${e.flags?.length ? 'cr-flagged' : ''}"><td>${esc(name(e.employeeId))}<small>${esc(e.employeeId)}</small></td><td>${esc(fmtDay(e.workDate))}</td><td>${e.kind === 'in' ? 'Time in' : 'Time out'} <strong>${esc(e.time)}</strong><small>recorded ${esc(stamp(e.recordedAt))}</small></td>
        <td>${badge(TYPE_LABEL[typeOf(e)], typeOf(e) === 'offsite' ? 'pending' : typeOf(e) === 'correction' ? 'neutral' : '')}${e.reason ? `<small class="wrap">${esc(e.reason)}</small>` : ''}</td>
        <td class="wrap">${esc(e.place || e.address || '')}${e.addressCorrected ? `<small>Detected: ${esc(e.addressDetected)}</small>` : ''}</td>
        <td>${isCorrection(e) ? '<span class="muted">No GPS (HR correction)</span>' : `${esc(Number(e.latitude).toFixed(6))}, ${esc(Number(e.longitude).toFixed(6))}<small>±${esc(Math.round(e.accuracy))} m</small>`}</td>
        <td>${network(e)}</td><td>${(e.flags || []).map(f => `<small class="ot-flag">⚠ ${esc(f)}</small>`).join('') || '<span class="muted">—</span>'}</td>
        <td>${isCorrection(e) ? '' : `<button class="small" data-cr-map="${esc(e.id)}">Map</button>`}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nothing to show yet.</td></tr>'}
      </tbody></table></div></section>`;
  }
  function showMap(e) {
    const x = Number(e.longitude), y = Number(e.latitude), bounds = [x - .003, y - .003, x + .003, y + .003].join(',');
    openDialog(`${TYPE_LABEL[typeOf(e)]} · ${e.kind === 'in' ? 'time in' : 'time out'} ${e.time}`, `<div class="dialog-body loc-box">
      <p class="loc-when">${esc(name(e.employeeId))} · ${esc(fmtDay(e.workDate))} · recorded ${esc(stamp(e.recordedAt))}</p>
      <p class="loc-place">📍 ${esc(e.place || e.address || 'No address recorded')}</p>
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
      const f = event.target.dataset.crFilter; if (f) { filters = { ...filters, [f]: event.target.value }; render(box); }
    };
    box.onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-cr-type')) { filters = { ...filters, type: b.dataset.crType, flagged: false }; render(box); }
      if (b.hasAttribute('data-cr-flagged')) { filters = { ...filters, type: '', flagged: true }; render(box); }
      if (b.dataset.crMap) { const e = list.find(x => x.id === b.dataset.crMap); if (e) showMap(e); }
    };
    load(box);
  }
  return { panel: () => '<div data-clock-records><div class="loading">Loading time in / out records…</div></div>', fill };
}
