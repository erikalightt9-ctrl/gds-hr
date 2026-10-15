// HR dashboard: every figure is calculated on the server from current records; each card opens the matching list.
import { celebrationsHtml, bindCelebrationPhotos } from './hr-common.js';

// Outline icons for the dashboard cards.
const ICONS = {
  total: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>',
  active: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  inactive: '<circle cx="10" cy="8" r="4"/><path d="M2 21c0-4.4 3.6-7 8-7 1.4 0 2.8.3 4 .8M18 15v6M15 18h6"/>',
  newHires: '<circle cx="10" cy="8" r="4"/><path d="M2 21c0-4.4 3.6-7 8-7 1.4 0 2.8.3 4 .8M18 15v6M15 18h6"/>',
  departments: '<path d="M5 21V4h10v17M15 9h4v12M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1M3 21h18"/>',
  missing: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.01"/>',
  acks: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  trainings: '<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
// People analytics: attendance trend (present / late per day, from attendance records), workforce composition
// (active / inactive) and document compliance. Every figure comes from the system's own records.
const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']];
const mins = hm => { const [h, m] = String(hm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
function attendanceTrend(state, days, today) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - i); const date = d.toISOString().slice(0, 10);
    const recs = (state?.attendance || []).filter(a => a.date === date && a.status === 'present');
    const grace = (state?.rules || []).filter(r => r.approvedBy).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.graceMinutes ?? 0;
    const late = recs.filter(a => { const raw = mins(a.timeIn) !== null && mins(a.scheduledIn) !== null ? mins(a.timeIn) - mins(a.scheduledIn) : 0; return raw > grace && raw > (a.offsetMinutes || 0); }).length;
    const open = (state?.openClockIns || []).filter(c => c.workDate === date).length;
    out.push({ date, present: recs.length - late + open, late });
  }
  return out;
}
function trendChart(esc, data) {
  const W = 560, H = 170, L = 30, B = 24, T = 8, max = Math.max(4, ...data.map(d => d.present + d.late)), top = Math.ceil(max / 4) * 4;
  const slot = (W - L - 8) / data.length, bw = Math.max(2, Math.min(18, slot * 0.36)), y = v => T + (H - T - B) * (1 - v / top);
  const step = data.length > 14 ? Math.ceil(data.length / 10) : 1, DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const grid = [0, top / 4, top / 2, (3 * top) / 4, top].map(v => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="an-grid"/><text x="${L - 8}" y="${y(v) + 4}" class="an-axis" text-anchor="end">${v}</text>`).join('');
  const bars = data.map((d, i) => { const x = L + i * slot + slot / 2; return `<g><title>${esc(d.date)}: ${d.present} present, ${d.late} late</title><rect x="${x - bw - 1}" y="${y(d.present)}" width="${bw}" height="${y(0) - y(d.present)}" rx="2" class="an-present"/><rect x="${x + 1}" y="${y(d.late)}" width="${bw}" height="${y(0) - y(d.late)}" rx="2" class="an-late"/>${i % step === 0 ? `<text x="${x}" y="${H - 8}" class="an-axis" text-anchor="middle">${data.length <= 7 ? DAY[new Date(`${d.date}T00:00:00Z`).getUTCDay()] : d.date.slice(5).replace('-', '/')}</text>` : ''}</g>`; }).join('');
  return `<svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Present and late employees per day">${grid}${bars}</svg>`;
}
function donut(active, inactive) {
  const total = active + inactive || 1, r = 52, c = 2 * Math.PI * r, part = (active / total) * c;
  return `<svg class="an-donut" viewBox="0 0 140 140" role="img" aria-label="${active} active, ${inactive} inactive"><circle cx="70" cy="70" r="${r}" class="an-ring-off"/><circle cx="70" cy="70" r="${r}" class="an-ring-on" stroke-dasharray="${part.toFixed(2)} ${(c - part).toFixed(2)}" transform="rotate(-90 70 70)"/><text x="70" y="68" text-anchor="middle" class="an-donut-num">${active + inactive}</text><text x="70" y="88" text-anchor="middle" class="an-donut-label">Employees</text></svg>`;
}
let analyticsRange = '7';
// Employee spotlight: today's celebrant, else the newest hire (last 30 days), else an employee of the day (rotates daily).
function pickSpotlight(people, party, today) {
  const active = people.filter(p => !p.archived && !p.draft && p.status === 'Active');
  const c = party?.celebrations?.[0];
  if (c) { const p = active.find(x => x.id === c.employeeId); if (p) return { p, chip: c.occasion === 'birthday' ? '🎂 Birthday today' : `🎉 ${c.years ? `${c.years} year${c.years === 1 ? '' : 's'}` : 'Work anniversary'} today` }; }
  const cut = new Date(`${today}T00:00:00Z`); cut.setUTCDate(cut.getUTCDate() - 30); const since = cut.toISOString().slice(0, 10);
  const fresh = active.filter(p => p.dateHired && p.dateHired >= since && p.dateHired <= today).sort((a, b) => b.dateHired.localeCompare(a.dateHired))[0];
  if (fresh) return { p: fresh, chip: '👋 New hire' };
  if (!active.length) return null;
  const seed = [...today].reduce((s, ch) => s + ch.charCodeAt(0), 0), p = active.slice().sort((a, b) => a.name.localeCompare(b.name))[seed % active.length];
  const years = p.dateHired ? Math.floor((Date.parse(today) - Date.parse(p.dateHired)) / (365.25 * 86400000)) : 0;
  return { p, chip: years >= 1 ? `⭐ ${years} year${years === 1 ? '' : 's'} with GDS` : '⭐ Employee of the day' };
}
function spotlightHtml(esc, pick) {
  if (!pick) return '';
  const { p, chip } = pick, [last, first] = String(p.name).split(',').map(x => x.trim()), name = first ? `${first.split(' ')[0]} ${last}` : p.name;
  const ini = `${(first || '').charAt(0)}${(last || '').charAt(0)}`.toUpperCase();
  return `<button class="an-card sp-card" data-go="${esc(JSON.stringify({ page: 'files' }))}" title="Open the employee masterlist"><span class="sp-photo"><span class="sp-ini">${esc(ini)}</span><img src="/api/hr/employees/${encodeURIComponent(p.id)}/photo" alt="" data-sp-photo></span><span class="sp-shade"></span><span class="sp-text"><strong>${esc(name)}</strong><small>${esc(p.position || '—')}</small></span><span class="sp-chip">${esc(chip)}</span></button>`;
}
export function createDashboard(ctx) {
  const { api, esc, shell, heading } = ctx;
  let spotCard = '';
  function analyticsHtml(t) {
    const state = ctx.getState?.(), trend = attendanceTrend(state, Number(analyticsRange), ctx.today());
    const totalP = trend.reduce((s, d) => s + d.present, 0), totalL = trend.reduce((s, d) => s + d.late, 0);
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    const affected = pct(t.employeesMissing || 0, t.total || 0), bar = Math.round(affected / 5) * 5;
    return `<div class="an-head"><div><h2>People analytics</h2><p>Workforce, attendance, and document insights</p></div><select data-an-range aria-label="Period">${RANGES.map(([v, l]) => `<option value="${v}" ${v === analyticsRange ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="an-grid3${spotCard ? ' with-spot' : ''}">${spotCard}
        <section class="an-card"><h3>Attendance trends</h3><p>${totalP + totalL ? `${totalP} on time · ${totalL} late in the period` : 'No attendance recorded in this period'}</p>${trendChart(esc, trend)}<div class="an-legend"><span><i class="an-present"></i>Present</span><span><i class="an-late"></i>Late</span></div></section>
        <section class="an-card"><h3>Workforce composition</h3><p>Current snapshot</p><div class="an-donut-wrap">${donut(t.active || 0, t.inactive || 0)}</div><ul class="an-key"><li><i class="an-on"></i>Active <span>${t.active || 0} · ${pct(t.active || 0, (t.active || 0) + (t.inactive || 0))}%</span></li><li><i class="an-off"></i>Inactive <span>${t.inactive || 0} · ${pct(t.inactive || 0, (t.active || 0) + (t.inactive || 0))}%</span></li></ul></section>
        <section class="an-card"><h3>Document compliance</h3><p>Current snapshot</p>${t.missingDocuments === null ? '<p class="legend">Visible to HR.</p>' : `<strong class="an-big">${t.missingDocuments}</strong><span class="an-big-label">Missing requirements</span><div class="an-row"><span>Employees affected</span><span>${t.employeesMissing} of ${t.total} (${affected}%)</span></div><div class="an-bar"><i class="db-w${bar}"></i></div><p class="an-note">${t.employeesMissing && t.employeesMissing === t.total ? 'All employees have at least one missing requirement.' : t.employeesMissing ? `${t.total - t.employeesMissing} employee${t.total - t.employeesMissing === 1 ? ' is' : 's are'} complete.` : 'Every employee is complete.'}</p><button class="an-link" data-go="${esc(JSON.stringify({ page: 'files', docs: 'missing' }))}">Review requirements →</button>`}</section>
      </div>`;
  }
  async function render() {
    shell(heading('Dashboard', 'Loading…') + '<div class="loading">Loading dashboard…</div>');
    const [d, party, people] = await Promise.all([api('/hr/dashboard'), api('/hr/celebrations').catch(() => null), api('/hr/employees').catch(() => [])]), t = d.totals;
    const spot = spotlightHtml(esc, pickSpotlight(people, party, ctx.today()));
    const card = (key, value, text, nav, { sub = '', link = '', tone = '', alert = false } = {}) => `<button class="db-card${alert ? ' alert' : ''}" data-go="${esc(JSON.stringify(nav))}"><span class="db-head"><span class="db-ico ${tone}">${svg(key)}</span><span class="db-title">${text}</span>${alert ? '<em>Needs attention</em>' : ''}</span><span class="db-value"><strong>${value ?? '—'}</strong>${sub && !link ? `<small>${sub}</small>` : ''}</span>${link ? `${sub ? `<small class="db-sub">${sub}</small>` : ''}<span class="db-link">${link} →</span>` : ''}</button>`;
    const asOf = new Date(`${String(d.asOf).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    shell(heading('Dashboard', `${esc(ctx.context().company.name)} · Overview as of ${asOf}`) +
      `${celebrationsHtml(esc, party)}<section class="an an-top" id="dash-analytics">${(spotCard = spot, analyticsHtml(t))}</section><div class="db-grid db-grid8">
        ${card('total', t.total, 'Total employees', { page: 'files' }, { tone: 'red', sub: t.archived ? `${t.archived} archived not counted` : '' })}
        ${card('active', t.active, 'Active employees', { page: 'files', status: 'Active' }, { tone: 'green' })}
        ${card('inactive', t.inactive, 'Inactive employees', { page: 'files', status: 'Inactive' }, { tone: 'red' })}
        ${card('newHires', t.newHires, 'New hires', { page: 'files', docs: 'newhires' }, { tone: 'red', sub: 'Last 30 days' })}
        ${card('departments', t.departments, 'Subsidiaries', { dialog: 'departments' }, { link: 'View or add subsidiaries' })}
        ${t.missingDocuments !== null ? card('missing', t.missingDocuments, 'Missing requirements', { page: 'files', docs: 'missing' }, { tone: 'red', alert: t.missingDocuments > 0, sub: `${t.employeesMissing} employee${t.employeesMissing === 1 ? '' : 's'} affected`, link: 'Review requirements' }) : ''}
        ${card('acks', t.pendingAcks, 'Pending memo acknowledgments', { page: 'memos' }, { sub: t.pendingAcks ? (t.overdueAcks ? `${t.overdueAcks} overdue` : 'Waiting for employees') : 'All acknowledgments up to date' })}
        ${card('trainings', t.upcomingTrainings, 'Upcoming trainings', { page: 'trainings' }, { sub: t.upcomingTrainings ? 'Scheduled sessions' : 'No upcoming sessions' })}
      </div>
      ${ctx.livePanel ? `<div id="dash-live">${ctx.livePanel()}</div>` : ''}
      `);
    bindCelebrationPhotos(document.querySelector('.content'));
    const bindSpot = () => document.querySelectorAll('[data-sp-photo]').forEach(img => { img.addEventListener('error', () => img.remove()); img.addEventListener('load', () => img.closest('.sp-card')?.classList.add('has-photo')); });
    bindSpot();
    document.querySelector('[data-an-range]')?.addEventListener('change', event => { analyticsRange = event.target.value; document.querySelector('#dash-analytics').innerHTML = analyticsHtml(t); bindSpot(); });
    document.querySelector('.content').addEventListener('click', event => {
      const b = event.target.closest('[data-go],[data-quick]'); if (!b) return;
      if (b.dataset.quick) { ctx.quick(b.dataset.quick); return; }
      const nav = JSON.parse(b.dataset.go);
      if (nav.dialog === 'departments') { departments(d.departments); return; }
      ctx.go(nav);
    });
  }
  // Departments / companies of the group: list with head counts; System Administrators add or remove them
  // (saved in Settings, then chosen per employee in Edit record).
  async function departments(list) {
    let settings = null;
    try { settings = await api('/hr/settings'); } catch { settings = null; }   // only System Administrators can change the list
    const draw = (items, error = '') => {
      ctx.openDialog('Subsidiaries', `<div class="dialog-body"><p class="sub">Companies of the GDS Capital group. Assign an employee in their 201 file (Edit record).</p>
        <ul class="plain-list dept-list">${items.filter(x => x.name !== 'Unassigned').map(x => `<li><span><strong>${esc(x.name)}</strong></span>${settings && x.name !== 'Unassigned' && !x.count ? `<button class="small danger" data-dept-remove="${esc(x.name)}">Remove</button>` : ''}</li>`).join('')}</ul>
        ${settings ? `<form id="dept-add" class="dept-add"><input name="name" maxlength="120" required placeholder="e.g. PDMN or GDS Realty Corp." aria-label="New subsidiary"><button class="primary">＋ Add</button></form>` : '<p class="legend">Only System Administrators can add or remove subsidiaries.</p>'}
        ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}</div>`);
      const box = ctx.dialog;
      const save = async (names, items2) => {
        try { settings = await api('/hr/settings', { ...settings, departments: names }); await ctx.reloadContext?.(); draw(items2); }
        catch (e) { draw(items, e.message); }
      };
      box.querySelector('#dept-add')?.addEventListener('submit', ev => {
        ev.preventDefault(); const name = new FormData(ev.target).get('name').trim(); if (!name) return;
        if (items.some(x => x.name.toLowerCase() === name.toLowerCase())) { draw(items, `${name} is already in the list.`); return; }
        save([...settings.departments, name], [...items, { name, count: 0 }]);
      });
      box.querySelectorAll('[data-dept-remove]').forEach(b => b.addEventListener('click', () => {
        const name = b.dataset.deptRemove;
        save(settings.departments.filter(x => x !== name), items.filter(x => x.name !== name));
      }));
    };
    draw(list);
  }
  return { render };
}
