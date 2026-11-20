// How an approved or draft rules version is shown. An approved version is never also labeled Draft.
// Keep the wording in step with the server check in src/service.mjs (a draft legal basis cannot be approved).
export function rulesView(rule) {
  const approved = !!rule?.approvedBy;
  const stored = String(rule?.basis || '');
  const legal = approved && /\bdraft\b/i.test(stored)
    ? 'This version is approved. The earlier template wording is kept in the database and is not the status.'
    : stored;
  return {
    status: approved ? 'Approved' : 'Draft',
    legal,
    versionId: rule?.id || '',
    approver: approved ? rule.approvedBy : '',
    approvedAt: approved ? (rule.approvedAt || '') : '',
    save: !approved,
    approve: !approved,
  };
}
export function rulesViewText(rule) {
  const view = rulesView(rule);
  return [`Status: ${view.status}`, `Version: ${view.versionId}`, view.approver ? `Approved by: ${view.approver}` : '', view.approvedAt ? `When: ${view.approvedAt}` : '', `Legal basis: ${view.legal}`].filter(Boolean).join('\n');
}
