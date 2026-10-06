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
        ${card('departments', t.departments, 'Departments', { page: 'files' })}
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
      ctx.go(JSON.parse(b.dataset.go));
    });
  }
  return { render };
}
