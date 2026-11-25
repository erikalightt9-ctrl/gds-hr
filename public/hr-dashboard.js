// HR / Admin dashboard (Nov 25, 2026 design). Every figure is read on the server from current records
// (GET /api/hr/dashboard/overview, src/dashboard-overview.mjs; GET /api/hr/dashboard for the subsidiaries list); each
// card opens the matching page.
const ico = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  people: ico('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'),
  check: ico('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  clock: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  cal: ico('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>'),
  exit: ico('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>'),
  bars: ico('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  team: ico('<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7.5 20c0-2.8 2-4.8 4.5-4.8s4.5 2 4.5 4.8M1.5 19c0-2.2 1.5-3.8 3.5-3.8M22.5 19c0-2.2-1.5-3.8-3.5-3.8"/>'),
  shield: ico('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  grid: ico('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'),
  doc: ico('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  coin: ico('<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6.5V8M12 16v1.5"/>'),
  alert: ico('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.01"/>'),
  bolt: ico('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  money: ico('<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>'),
  school: ico('<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>'),
  flag: ico('<path d="M5 21V4h11l-1.5 4L16 12H5"/>'),
  arrow: ico('<path d="M5 12h14M13 6l6 6-6 6"/>'),
};
const MONTH = m => new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const stamp = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pct = v => (v === null || v === undefined ? '' : `${Number.isInteger(v) ? v : v.toFixed(1)}%`);

// Attendance rate per month (line with area).
function lineChart(esc, months) {
  const W = 380, H = 200, L = 38, R = 14, T = 26, B = 24, pts = months.map((m, i) => ({ ...m, x: L + (months.length > 1 ? i * (W - L - R) / (months.length - 1) : 0) }));
  const y = v => T + (H - T - B) * (1 - v / 100), grid = [0, 25, 50, 75, 100];
  const valid = pts.filter(p => p.rate !== null), line = valid.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${y(p.rate).toFixed(1)}`).join(' ');
  const area = valid.length ? `${line} L${valid.at(-1).x.toFixed(1)} ${y(0)} L${valid[0].x.toFixed(1)} ${y(0)} Z` : '';
  return `<svg class="hd-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="Attendance rate per month">
    <defs><linearGradient id="hdArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2f5bd6" stop-opacity=".28"/><stop offset="1" stop-color="#2f5bd6" stop-opacity=".02"/></linearGradient></defs>
    ${grid.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="hd-grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="hd-axis">${v}%</text>`).join('')}
    ${area ? `<path d="${area}" fill="url(#hdArea)"/><path d="${line}" class="hd-path"/>` : ''}
    ${pts.map((p, i) => `<text x="${p.x}" y="${H - 6}" text-anchor="middle" class="hd-axis">${esc(MONTH(p.month))}</text>${p.rate === null ? '' : `<g><title>${esc(MONTH(p.month))}: ${p.rate}% (${p.present} of ${p.workdays} working days)</title><circle cx="${p.x}" cy="${y(p.rate)}" r="${i === pts.length - 1 ? 6 : 5}" class="${i === pts.length - 1 ? 'hd-dot-now' : 'hd-dot'}"/>${i === pts.length - 1 ? `<rect x="${p.x - 26}" y="${y(p.rate) - 30}" width="52" height="20" rx="6" class="hd-tag"/><text x="${p.x}" y="${y(p.rate) - 16}" text-anchor="middle" class="hd-tag-text">${p.rate}%</text>` : `<text x="${p.x}" y="${y(p.rate) - 10}" text-anchor="middle" class="hd-val">${p.rate}%</text>`}</g>`}`).join('')}</svg>`;
}
// Workforce composition donut.
const SLICE = ['#1f3fb8', '#7aa9f7', '#f5a524', '#16a34a', '#c8102e', '#7c4ddb', '#9aa0aa'];
function donut(esc, parts, total) {
  const r = 58, c = 2 * Math.PI * r; let off = 0;
  const rings = parts.map((p, i) => { const len = (p.count / (total || 1)) * c, s = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${SLICE[i % SLICE.length]}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)"><title>${esc(p.name)}: ${p.count}</title></circle>`; off += len; return s; }).join('');
  return `<svg class="hd-donut" viewBox="0 0 160 160" role="img" aria-label="Workforce composition"><circle cx="80" cy="80" r="${r}" fill="none" stroke="#eef0f5" stroke-width="22"/>${rings}<text x="80" y="80" text-anchor="middle" class="hd-donut-num">${total}</text><text x="80" y="99" text-anchor="middle" class="hd-donut-lbl">Total Staff</text></svg>`;
}

export function createDashboard(ctx) {
  const { api, esc, shell, heading } = ctx;
  async function render() {
    shell(heading('Dashboard', 'Loading…') + '<div class="loading">Loading dashboard…</div>');
    let d, o, me;
    try { [d, o, me] = await Promise.all([api('/hr/dashboard'), api('/hr/dashboard/overview'), api('/me/account').catch(() => ({}))]); }
    catch (error) { shell(heading('Dashboard', '') + `<div class="notice">${esc(/not found/i.test(error.message) ? 'The new dashboard will appear after the HR server restarts.' : error.message)}</div>`); return; }
    const name = me.employeeName ? (() => { const [last, first] = String(me.employeeName).split(',').map(x => x.trim()); return first ? `${first} ${last}` : me.employeeName; })() : (ctx.who?.(me.username) || me.username || 'there');
    const ini = name.split(/\s+/).filter(Boolean).map(x => x[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join('').toUpperCase();
    const t = o.today, nav = x => esc(JSON.stringify(x));
    const kpi = (tone, icon, label, value, chip, go) => `<button class="hd-kpi hd-${tone}" data-go="${nav(go)}"><span class="hd-kpi-ico">${icon}</span><span class="hd-kpi-text"><span>${label}</span><strong>${value}</strong></span>${chip ? `<em>${chip}</em>` : ''}<span class="hd-kpi-art">${icon}</span></button>`;
    const panel = (icon, title, go, body, extra = '') => `<section class="hd-panel"><div class="hd-panel-head"><h3><span class="hd-panel-ico">${icon}</span>${title}</h3>${extra}${go ? `<button class="hd-more" data-go="${nav(go)}">${go.label || 'View Details'} ${I.arrow}</button>` : ''}</div>${body}</section>`;
    const comp = o.compliance, active = o.employees.active, latest = o.monthly.at(-1);
    const quick = (tone, icon, value, label, go) => `<button class="hd-quick hd-q-${tone}" data-go="${nav(go)}"><span>${icon}</span><strong>${value ?? '—'}</strong><small>${label}</small></button>`;
    const eventIcon = { holiday: I.flag, payroll: I.money, training: I.school };
    shell(`<div class="hd">
      <section class="hd-hero"><span class="hd-photo"><span>${esc(ini)}</span>${me.employeeId ? `<img src="/api/hr/employees/${encodeURIComponent(me.employeeId)}/photo" alt="" data-hd-photo>` : ''}<i></i></span>
        <div class="hd-hello"><span>Welcome back,</span><h1>${esc(name)}!</h1><p>Here’s what’s happening in your organization today.</p></div><p class="hd-motto">“Build on Trust,<br>Backed by Expertise”</p></section>
      <div class="hd-kpis">
        ${kpi('blue', I.people, 'Total Employees', o.employees.total, `${active} active`, { page: 'files' })}
        ${kpi('green', I.check, 'Present Today', t ? t.present : '—', t ? pct(t.presentRate) : '', { page: 'attendance' })}
        ${kpi('orange', I.clock, 'On Leave Today', t ? t.onLeave : '—', t ? pct(t.onLeaveRate) : '', { page: 'leave' })}
        ${kpi('violet', I.cal, 'Late Arrivals', t ? t.late : '—', t ? pct(t.lateRate) : '', { page: 'attendance' })}
        ${kpi('teal', I.exit, 'Absent Today', t ? t.noTimeIn : '—', t ? pct(t.noTimeInRate) : '', { page: 'attendance' })}
      </div>
      <div class="hd-row3">
        ${panel(I.bars, 'Attendance Overview', { page: 'attendance' }, `<div class="hd-legend"><span><b class="hd-k-blue"></b>Present</span><span><b class="hd-k-red"></b>Attendance Rate</span></div>${lineChart(esc, o.monthly)}<p class="hd-foot">${latest?.rate === null || latest?.rate === undefined ? 'No working days yet this month.' : `${esc(MONTH(latest.month))}: ${latest.present} of ${latest.workdays} working days attended so far`}</p>`)}
        ${panel(I.team, 'Workforce Composition', { page: 'files' }, `<div class="hd-comp">${donut(esc, o.composition, active)}<ul>${o.composition.map((p, i) => `<li><b data-hd-color="${SLICE[i % SLICE.length]}"></b><span>${esc(p.name)}<small>${pct(p.share)} (${p.count})</small></span></li>`).join('')}</ul></div><button class="hd-link" data-go="${nav({ dialog: 'departments' })}">Subsidiaries (${d.totals.departments}) ${I.arrow}</button>`)}
        ${panel(I.shield, 'Document Compliance', { page: 'files', docs: 'missing' }, comp ? `<div class="hd-compliance"><div><strong class="hd-big">${comp.percent}<small>%</small></strong><span>Overall Compliance</span><div class="hd-bar"><i data-hd-w="${comp.percent}"></i></div><p>${I.check}${comp.complied} of ${comp.required} requirements met · ${comp.employeesComplete} of ${comp.employees} employees complete</p></div><span class="hd-clip">${I.doc}<i>${I.check}</i></span></div>` : '<p class="hd-foot">Visible to the HR team.</p>')}
      </div>
      <div class="hd-row3 hd-row3b">
        ${panel(I.grid, 'Quick Stats', null, `<div class="hd-quicks">${quick('red', I.cal, o.quick.pendingLeaves, 'Pending Leaves', { page: 'leave' })}${quick('blue', I.doc, o.quick.pendingDocs, 'Pending 201 Files', { page: 'files', docs: 'review' })}${quick('orange', I.coin, o.quick.payrollAlerts, 'Attendance Alerts', { page: 'attendance', view: 'requests' })}${quick('pink', I.alert, o.quick.systemAlerts, 'System Alerts', { page: 'settings' })}</div>`)}
        ${panel(I.bolt, 'Recent Activities', null, o.activities.length ? `<ol class="hd-acts">${o.activities.map(a => `<li class="hd-a-${esc(a.kind)}"><small>${esc(stamp(a.at))}</small><strong>${esc(a.text)}</strong></li>`).join('')}</ol>` : '<p class="hd-foot">No recent activity.</p>')}
        ${panel(I.cal, 'Upcoming Events', { page: 'holidays', label: 'View Calendar' }, o.upcoming.length ? `<ul class="hd-events">${o.upcoming.map(e => { const dt = new Date(`${e.date}T00:00:00Z`); return `<li><span class="hd-date"><small>${esc(dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase())}</small><strong>${dt.getUTCDate()}</strong></span><span class="hd-ev-ico">${eventIcon[e.kind] || I.cal}</span><span><strong>${esc(e.title)}</strong><small>${esc(e.sub)}</small></span></li>`; }).join('')}</ul>` : '<p class="hd-foot">Nothing scheduled.</p>')}
      </div></div>`);
    const root = document.querySelector('.content');
    root.querySelectorAll('[data-hd-photo]').forEach(img => { img.addEventListener('error', () => img.remove()); img.addEventListener('load', () => img.closest('.hd-photo')?.classList.add('has-photo')); });
    // Sizes / colours set from script (the page's security policy blocks style attributes).
    root.querySelectorAll('[data-hd-w]').forEach(el => { el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.hdW)))}%`; });
    root.querySelectorAll('[data-hd-color]').forEach(el => { el.style.background = el.dataset.hdColor; });
    root.onclick = event => {
      const b = event.target.closest('[data-go]'); if (!b) return;
      const go = JSON.parse(b.dataset.go);
      if (go.dialog === 'departments') { departments(d.departments); return; }
      ctx.go(go);
    };
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
