// HR dashboard: every figure is calculated on the server from current records; each card opens the matching list.
import { fmtDate, celebrationsHtml, bindCelebrationPhotos } from './hr-common.js';

const ICONS = { total: '👥', active: '✅', inactive: '⛔', newHires: '🎉', departments: '🏢', missing: '⚠️', acks: '📝', trainings: '🎓' };
export function createDashboard(ctx) {
  const { api, esc, table, shell, heading } = ctx;
  async function render() {
    shell(heading('Dashboard', 'Loading…') + '<div class="loading">Loading dashboard…</div>');
    const [d, party] = await Promise.all([api('/hr/dashboard'), api('/hr/celebrations').catch(() => null)]), t = d.totals;
    const card = (key, value, text, nav, sub = '') => `<button class="hr-stat" data-go="${esc(JSON.stringify(nav))}"><span class="hr-stat-icon" aria-hidden="true">${ICONS[key]}</span><strong>${value ?? '—'}</strong><span>${text}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
    shell(heading('Dashboard', `${esc(ctx.context().company.name)} · figures as of ${fmtDate(d.asOf)}`) +
      `${celebrationsHtml(esc, party)}<div class="hr-stats">
        ${card('total', t.total, 'Total employees', { page: 'files' }, t.archived ? `${t.archived} archived not counted` : '')}
        ${card('active', t.active, 'Active employees', { page: 'files', status: 'Active' })}
        ${card('inactive', t.inactive, 'Inactive employees', { page: 'files', status: 'Inactive' })}
        ${card('newHires', t.newHires, 'New hires (last 30 days)', { page: 'files', docs: 'newhires' })}
        ${card('departments', t.departments, 'Departments & companies', { dialog: 'departments' }, 'Click to view or add')}
        ${t.missingDocuments !== null ? card('missing', t.missingDocuments, 'Missing requirements', { page: 'files', docs: 'missing' }, `${t.employeesMissing} employee${t.employeesMissing === 1 ? '' : 's'} affected`) : ''}
        ${card('acks', t.pendingAcks, 'Pending memo acknowledgements', { page: 'memos' }, t.overdueAcks ? `${t.overdueAcks} overdue` : '')}
        ${card('trainings', t.upcomingTrainings, 'Upcoming trainings', { page: 'trainings' })}
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
      ctx.openDialog('Departments & companies', `<div class="dialog-body"><p class="sub">GDS Capital group: each department or company, with its number of employees. Assign employees in their 201 file (Edit record → Department).</p>
        <ul class="plain-list dept-list">${items.map(x => `<li><span><strong>${esc(x.name)}</strong> <small>${x.count} employee${x.count === 1 ? '' : 's'}</small></span>${settings && x.name !== 'Unassigned' && !x.count ? `<button class="small danger" data-dept-remove="${esc(x.name)}">Remove</button>` : ''}</li>`).join('')}</ul>
        ${settings ? `<form id="dept-add" class="dept-add"><input name="name" maxlength="120" required placeholder="e.g. GDS Realty Corp. or Finance Department" aria-label="New department or company"><button class="primary">＋ Add</button></form>` : '<p class="legend">Only System Administrators can add or remove departments.</p>'}
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
