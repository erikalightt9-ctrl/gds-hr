// My approvals (Nov 24, 2026): requests waiting for the signed-in person's step in an approval chain
// (leave: Supervisor → HR verification → approval). Approve / Reject call the request's own decision route.
export async function inboxPage({ api, esc, shell, heading, table, badge, toast }) {
  const head = heading('My approvals', 'Requests waiting for your step. Each step is recorded with your name.');
  shell(head + '<div class="loading">Loading…</div>');
  const items = await api('/approvals/inbox');
  const done = h => h.map(a => `${esc(a.step === 'supervisor' ? 'Supervisor' : a.step === 'verify' ? 'HR' : 'Approver')}: ${esc(a.decision)} · ${esc(a.by)}`).join('<br>') || '—';
  shell(head + `<section class="panel">${table(['Employee', 'Request', 'Dates', 'Reason', 'Steps so far', 'Waiting for', ''], items.map(i => [`<strong>${esc(i.employeeName)}</strong>${i.reference ? `<br><small class="muted">${esc(i.reference)}</small>` : ''}`, esc(i.what), esc(i.dates), `<span class="wrap">${esc(i.reason)}</span>`, `<small>${done(i.history)}</small>`, badge(i.stageLabel, 'pending'), `<span class="acc-actions"><button class="small primary" data-approve="${esc(i.id)}" data-kind="${esc(i.kind)}" data-own="${i.ownStep ? '1' : ''}">${i.ownStep ? (i.stage === 'supervisor' ? 'Endorse' : i.stage === 'verify' ? 'Verify' : 'Approve') : 'Decide without supervisor'}</button><button class="small danger" data-reject="${esc(i.id)}" data-kind="${esc(i.kind)}">Reject</button></span>`]), 'Nothing is waiting for you.')}</section>`);
  document.querySelector('main')?.addEventListener('click', async e => {
    const ok = e.target.closest('[data-approve]'), no = e.target.closest('[data-reject]');
    if (!ok && !no) return;
    let remarks = '';
    if (no) { remarks = window.prompt('Reason for the rejection (the employee sees it):') || ''; if (remarks.trim().length < 3) return; }
    else if (!ok.dataset.own) { remarks = window.prompt('The Supervisor has not checked this request yet. Reason for deciding without them:') || ''; if (remarks.trim().length < 5) return; }
    const id = (ok || no).dataset.approve || (ok || no).dataset.reject;
    const kind = (ok || no).dataset.kind;
    if (kind === 'overtime' && ok && ok.dataset.own !== '1') { toast('Open Attendance → Overtime applications to decide the hours.'); return; }
    try { await api(kind === 'overtime' ? `/overtime-requests/${encodeURIComponent(id)}/decision` : `/leaves/${encodeURIComponent(id)}/decision`, { decision: no ? 'reject' : 'approve', remarks }); toast(no ? 'Rejected.' : 'Done. The request moved to the next step.'); inboxPage({ api, esc, shell, heading, table, badge, toast }); } catch (error) { toast(error.message); }
  }, { once: true });
}
