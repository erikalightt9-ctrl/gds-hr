// Administration → Approval matrix and Users & roles (Nov 20, 2026). Both read what the server enforces.
export async function approvalsPage({ api, esc, shell, heading, table }) {
  shell(heading('Approval matrix', 'Who prepares and who approves each action. Built from the rules the system enforces.') + '<div class="loading">Loading…</div>');
  const rows = await api('/approval-matrix');
  shell(heading('Approval matrix', 'Who prepares and who approves each action. Built from the rules the system enforces.') +
    `<section class="panel">${table(['Area', 'Action', 'Prepared / requested by', 'Approved by', 'Rule'], rows.map(r => [esc(r.area), `<strong>${esc(r.action)}</strong>`, esc(r.prepares), esc(r.approves), `<span class="wrap">${esc(r.rule)}</span>`]))}
    <p class="panel-body legend">Approvals are recorded with the approver's own account. Shared logins cannot be traced to a person: give each approver a named account (Users &amp; roles). The service account (AI assistant) can only read.</p></section>`);
}
// Simplified (Nov 23, 2026): roles in use with their accounts; a note only where something needs doing; unused roles in one line.
export async function usersPage({ api, esc, shell, heading, table, badge, account }) {
  const head = heading('Users & roles', 'Who can sign in and what they can do.', '<button class="primary" data-open-accounts>Manage accounts</button>');
  shell(head + '<div class="loading">Loading…</div>');
  const rows = await api('/users-roles'), used = rows.filter(r => r.accounts), unused = rows.filter(r => !r.accounts);
  const notes = r => [
    r.mfaRequired && r.withMfa < r.accounts ? badge(`${r.accounts - r.withMfa} must set up two-factor sign-in`, 'pending') : '',
    r.unnamed ? badge(`${r.unnamed} not linked to a person`, 'rejected') : '',
  ].filter(Boolean).join(' ') || '—';
  shell(head + `<section class="panel">${table(['Role', 'What they can do', 'Accounts', 'Needs attention'], used.map(r => [`<strong>${esc(r.label)}</strong>`, `<span class="wrap">${esc(r.scope)}</span>`, r.people ? `<details class="role-people"><summary title="Show who has this role">${r.accounts}</summary><ul>${r.people.map(p => `<li><strong>${esc(p.name || p.username)}</strong>${p.name ? ` <small class="muted">${esc(p.username)}</small>` : ''}${r.mfaRequired && !p.twoFactor ? ' <small class="muted">· two-factor not set up</small>' : ''}</li>`).join('')}</ul></details>` : r.accounts, notes(r)]), 'No accounts yet.')}
    ${unused.length ? `<p class="panel-body legend">No accounts yet: ${unused.map(r => esc(r.label)).join(' · ')}</p>` : ''}</section>`);
  document.querySelector('[data-open-accounts]')?.addEventListener('click', () => account());
}
