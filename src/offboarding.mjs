// Access removal (Nov 24, 2026): when a person's employment ends (separation applied on its effective date, or the
// 201 file archived), every login linked to that employee record is disabled and signed out on all devices. Nothing
// is deleted: the records, payslips and audit trail stay for authorized staff. The last active System Administrator
// is never disabled (someone must be able to sign in).
export function disableLoginsFor(store, actor, employeeId, reason) {
  const users = store.db.prepare('SELECT id, username, role FROM users WHERE employee_id=? AND (disabled IS NULL OR disabled=0)').all(employeeId);
  const disabled = [];
  for (const u of users) {
    if (u.role === 'admin' && store.db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND (disabled IS NULL OR disabled=0) AND id<>?").get(u.id).n === 0) continue;
    store.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(u.id);
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    store.log(actor, 'disable-on-separation', 'users', u.id, { disabled: false }, { disabled: true, employeeId, reason });
    disabled.push(u.username);
  }
  if (disabled.length) store.notify(null, `Login${disabled.length > 1 ? 's' : ''} ${disabled.join(', ')} disabled: ${reason}. Records are kept.`);
  return disabled;
}
