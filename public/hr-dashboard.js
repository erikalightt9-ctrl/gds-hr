// HR dashboard: every figure is calculated on the server from current records; each card opens the matching list.
import { fmtDate, celebrationsHtml, bindCelebrationPhotos } from './hr-common.js';

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
export function createDashboard(ctx) {
  const { api, esc, table, shell, heading } = ctx;
  async function render() {
    shell(heading('Dashboard', 'Loading…') + '<div class="loading">Loading dashboard…</div>');
    const [d, party] = await Promise.all([api('/hr/dashboard'), api('/hr/celebrations').catch(() => null)]), t = d.totals;
    const card = (key, value, text, nav, { sub = '', link = '', tone = '', alert = false } = {}) => `<button class="db-card${alert ? ' alert' : ''}" data-go="${esc(JSON.stringify(nav))}"><span class="db-head"><span class="db-ico ${tone}">${svg(key)}</span><span class="db-title">${text}</span>${alert ? '<em>Needs attention</em>' : ''}</span><span class="db-value"><strong>${value ?? '—'}</strong>${sub && !link ? `<small>${sub}</small>` : ''}</span>${link ? `${sub ? `<small class="db-sub">${sub}</small>` : ''}<span class="db-link">${link} →</span>` : ''}</button>`;
    const asOf = new Date(`${String(d.asOf).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    shell(heading('Dashboard', `${esc(ctx.context().company.name)} · Overview as of ${asOf}`) +
      `${celebrationsHtml(esc, party)}<div class="db-grid">
        ${card('total', t.total, 'Total employees', { page: 'files' }, { tone: 'red', sub: t.archived ? `${t.archived} archived not counted` : '' })}
        ${card('active', t.active, 'Active employees', { page: 'files', status: 'Active' }, { tone: 'green' })}
        ${card('inactive', t.inactive, 'Inactive employees', { page: 'files', status: 'Inactive' }, { tone: 'red' })}
        ${card('newHires', t.newHires, 'New hires', { page: 'files', docs: 'newhires' }, { tone: 'red', sub: 'Last 30 days' })}
      </div>
      <h2 class="db-section">Operations overview</h2>
      <div class="db-grid">
        ${card('departments', t.departments, 'Subsidiaries', { dialog: 'departments' }, { link: 'View or add subsidiaries' })}
        ${t.missingDocuments !== null ? card('missing', t.missingDocuments, 'Missing requirements', { page: 'files', docs: 'missing' }, { tone: 'red', alert: t.missingDocuments > 0, sub: `${t.employeesMissing} employee${t.employeesMissing === 1 ? '' : 's'} affected`, link: 'Review requirements' }) : ''}
        ${card('acks', t.pendingAcks, 'Pending memo acknowledgments', { page: 'memos' }, { sub: t.pendingAcks ? (t.overdueAcks ? `${t.overdueAcks} overdue` : 'Waiting for employees') : 'All acknowledgments up to date' })}
        ${card('trainings', t.upcomingTrainings, 'Upcoming trainings', { page: 'trainings' }, { sub: t.upcomingTrainings ? 'Scheduled sessions' : 'No upcoming sessions' })}
      </div>
      ${ctx.livePanel ? `<div id="dash-live">${ctx.livePanel()}</div>` : ''}
      ${d.nextTrainings?.length ? `<section class="panel"><div class="panel-head"><h2>Upcoming trainings</h2></div>${table(['Training', 'Date', 'Participants', ''], d.nextTrainings.map(x => [esc(x.title) + (x.required ? ' <small>required</small>' : ''), `${fmtDate(x.date)}${x.startTime ? ` · ${x.startTime}` : ''}`, x.participants, `<button class="small" data-go="${esc(JSON.stringify({ page: 'trainings', id: x.id }))}">Open</button>`]))}</section>` : ''}`);
    bindCelebrationPhotos(document.querySelector('.content'));
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
