// Administration → Approval matrix and Users & roles (Nov 20, 2026). Both read what the server enforces.
export async function approvalsPage({ api, esc, shell, heading, table }) {
  shell(heading('Approval matrix', 'Who prepares and who approves each action. Built from the rules the system enforces.') + '<div class="loading">Loading…</div>');
  const rows = await api('/approval-matrix');
  shell(heading('Approval matrix', 'Who prepares and who approves each action. Built from the rules the system enforces.') +
    `<section class="panel">${table(['Area', 'Action', 'Prepared / requested by', 'Approved by', 'Rule'], rows.map(r => [esc(r.area), `<strong>${esc(r.action)}</strong>`, esc(r.prepares), esc(r.approves), `<span class="wrap">${esc(r.rule)}</span>`]))}
    <p class="panel-body legend">Approvals are recorded with the approver's own account. Shared logins cannot be traced to a person: give each approver a named account (Users &amp; roles). The service account (AI assistant) can only read.</p></section>`);
}
export async function usersPage({ api, esc, shell, heading, table, badge, account }) {
  shell(heading('Users & roles', 'Roles, what each can do, and how many accounts have them.', '<button class="primary" data-open-accounts>Manage accounts</button>') + '<div class="loading">Loading…</div>');
  const rows = await api('/users-roles');
  shell(heading('Users & roles', 'Roles, what each can do, and how many accounts have them.', '<button class="primary" data-open-accounts>Manage accounts</button>') +
    `<section class="panel">${table(['Role', 'Can do', 'Accounts', 'Two-factor sign-in', 'Unnamed approver logins'], rows.map(r => [`<strong>${esc(r.label)}</strong>`, `<span class="wrap">${esc(r.scope)}</span>`, r.accounts, r.accounts ? `${r.withMfa} of ${r.accounts}${r.mfaRequired ? ` ${badge(r.withMfa === r.accounts ? 'Required · complete' : 'Required · set up at next sign-in', r.withMfa === r.accounts ? '' : 'pending')}` : ''}` : '—', r.unnamed ? badge(`${r.unnamed} not linked to a person`, 'rejected') : '—']))}
    <p class="panel-body legend">Two-factor sign-in is required for HR, HR Staff, Payroll and Management; it is strongly recommended for Administrators. Link each staff account to its person's employee record so approvals are named.</p></section>`);
  document.querySelector('[data-open-accounts]')?.addEventListener('click', () => account());
}
