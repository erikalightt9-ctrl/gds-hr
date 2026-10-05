// HR dashboard: every figure is calculated on the server from current records; each card opens the matching list.
import { DOC_BADGE, fmtDate } from './hr-common.js';

const ICONS = { total: '👥', active: '✅', inactive: '⛔', newHires: '🎉', departments: '🏢', missing: '⚠️', acks: '📝', trainings: '🎓' };
export function createDashboard(ctx) {
  const { api, esc, table, badge, shell, heading, money } = ctx;
  async function render() {
    shell(heading('Dashboard', 'Loading…') + '<div class="loading">Loading dashboard…</div>');
    const d = await api('/hr/dashboard'), t = d.totals, can = ctx.context().can, legacy = ctx.legacy() ? ctx.legacyGlance() : null;
    const card = (key, value, text, nav, sub = '') => `<button class="hr-stat" data-go="${esc(JSON.stringify(nav))}"><span class="hr-stat-icon" aria-hidden="true">${ICONS[key]}</span><strong>${value ?? '—'}</strong><span>${text}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
    const max = Math.max(1, ...d.departments.map(x => x.count));
    const attention = [
      t.overdueDocuments && [`${t.overdueDocuments} overdue document submission${t.overdueDocuments === 1 ? '' : 's'}`, { page: 'files', docs: 'missing' }],
      t.expiredDocuments && [`${t.expiredDocuments} expired document${t.expiredDocuments === 1 ? '' : 's'}`, { page: 'files', docs: 'expired' }],
      t.expiringDocuments && [`${t.expiringDocuments} document${t.expiringDocuments === 1 ? '' : 's'} expiring soon`, { page: 'reports' }],
      t.documentsToReview && [`${t.documentsToReview} document${t.documentsToReview === 1 ? '' : 's'} waiting for review`, { page: 'files', docs: 'review' }],
      t.pendingSheets && [`${t.pendingSheets} data sheet${t.pendingSheets === 1 ? '' : 's'} waiting for approval`, { page: 'datasheets' }],
      t.overdueAcks && [`${t.overdueAcks} overdue memo acknowledgement${t.overdueAcks === 1 ? '' : 's'}`, { page: 'memos' }],
      ...d.probationDue.map(p => [`Probation end for ${p.name} on ${fmtDate(p.date)}`, { page: 'employee201', id: p.id }]),
      ...d.reviewsDue.map(p => [`Performance review for ${p.name} on ${fmtDate(p.date)}`, { page: 'employee201', id: p.id }]),
    ].filter(Boolean);
    shell(heading('Dashboard', `${esc(ctx.context().company.name)} · figures as of ${fmtDate(d.asOf)}`) +
      `<div class="hr-stats">
        ${card('total', t.total, 'Total employees', { page: 'files' }, t.archived ? `${t.archived} archived not counted` : '')}
        ${card('active', t.active, 'Active employees', { page: 'files', status: 'Active' })}
        ${card('inactive', t.inactive, 'Inactive employees', { page: 'files', status: 'Inactive' })}
        ${card('newHires', t.newHires, 'New hires (last 30 days)', { page: 'files', docs: 'newhires' })}
        ${card('departments', t.departments, 'Departments', { page: 'files' })}
        ${t.missingDocuments !== null ? card('missing', t.missingDocuments, 'Missing requirements', { page: 'files', docs: 'missing' }, `${t.employeesMissing} employee${t.employeesMissing === 1 ? '' : 's'} affected`) : ''}
        ${card('acks', t.pendingAcks, 'Pending memo acknowledgements', { page: 'memos' }, t.overdueAcks ? `${t.overdueAcks} overdue` : '')}
        ${card('trainings', t.upcomingTrainings, 'Upcoming trainings', { page: 'trainings' })}
      </div>
      ${attention.length ? `<section class="panel attention"><div class="panel-head"><h2>Attention needed</h2></div><ul class="plain-list attention-list">${attention.map(([text, nav]) => `<li><button class="link-button" data-go="${esc(JSON.stringify(nav))}">${esc(text)}</button></li>`).join('')}</ul></section>` : ''}
      <div class="grid2">
        <section class="panel"><div class="panel-head"><h2>Department summary</h2></div><div class="panel-body">${d.departments.length ? d.departments.map(x => `<div class="dept-row"><span>${esc(x.name)}</span><span class="dept-bar"><span class="dept-fill w${Math.round(x.count / max * 20) * 5}"></span></span><strong>${x.count}</strong></div>`).join('') : '<p class="muted">No employees yet.</p>'}</div></section>
        <section class="panel"><div class="panel-head"><h2>Employee summary</h2></div><div class="panel-body">
          <div class="summary-pair"><div><strong>${t.active}</strong><span>Active</span></div><div><strong>${t.inactive}</strong><span>Inactive</span></div></div>
          <p class="legend">Employment classification (separate from active / inactive):</p>
          <div class="summary-chips">${d.classifications.map(c => `<span class="chip"><strong>${c.count}</strong> ${esc(c.name)}</span>`).join('') || '<span class="muted">No records.</span>'}</div>
          ${can.manage ? `<h3 class="spaced">Quick actions</h3><div class="actions"><button class="primary small" data-quick="employee">＋ Add employee</button><button class="small" data-quick="memo">＋ Create memo</button><button class="small" data-quick="training">＋ Add training</button></div>` : ''}
        </div></section>
      </div>
      <section class="panel"><div class="panel-head"><h2>Recent employees</h2><button class="small" data-go='{"page":"files"}'>View all</button></div>${table(['Employee no.', 'Name', 'Department', 'Position', 'Date hired', 'Status', 'Classification'], d.recent.map(p => [esc(p.number), `<button class="link-button" data-go="${esc(JSON.stringify({ page: 'employee201', id: p.id }))}">${esc(p.name)}</button>`, esc(p.department || '—'), esc(p.position || '—'), fmtDate(p.dateHired), badge(p.status, p.status === 'Active' ? '' : 'rejected'), esc(p.classification || '—')]), 'No employees yet.')}</section>
      ${t.missingDocuments !== null ? `<section class="panel"><div class="panel-head"><h2>Missing requirements</h2><button class="small" data-go='{"page":"reports"}'>Full report</button></div>${table(['Employee', 'Department', 'Missing requirement', 'Due', 'Status', ''], d.missing.map(r => [esc(r.name), esc(r.department || '—'), esc(r.requirement), r.due ? fmtDate(r.due) : '—', `${badge(r.status, DOC_BADGE[r.status])}${r.overdue ? ' <small class="danger-text">overdue</small>' : ''}`, `<button class="small" data-go="${esc(JSON.stringify({ page: 'employee201', id: r.employeeId, tab: 'documents' }))}">Open checklist</button>`]), 'Every required document is on file and verified.')}</section>` : ''}
      ${d.nextTrainings?.length ? `<section class="panel"><div class="panel-head"><h2>Upcoming trainings</h2></div>${table(['Training', 'Date', 'Participants', ''], d.nextTrainings.map(x => [esc(x.title) + (x.required ? ' <small>required</small>' : ''), `${fmtDate(x.date)}${x.startTime ? ` · ${x.startTime}` : ''}`, x.participants, `<button class="small" data-go="${esc(JSON.stringify({ page: 'trainings', id: x.id }))}">Open</button>`]))}</section>` : ''}
      ${legacy ? `<section class="panel"><div class="panel-head"><h2>Attendance &amp; payroll at a glance</h2></div><div class="summary-pair four"><div><strong>${legacy.leave}</strong><span>Leave requests awaiting review</span></div><div><strong>${money(legacy.net)}</strong><span>Latest posted net payroll</span></div><div><strong>${money(legacy.loans)}</strong><span>Outstanding loans</span></div><div><button class="small" data-go='{"page":"payroll"}'>Open payroll →</button></div></div></section>` : ''}`);
    document.querySelector('.content').addEventListener('click', event => {
      const b = event.target.closest('[data-go],[data-quick]'); if (!b) return;
      if (b.dataset.quick) { ctx.quick(b.dataset.quick); return; }
      ctx.go(JSON.parse(b.dataset.go));
    });
  }
  return { render };
}
