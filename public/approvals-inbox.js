// My approvals (Nov 24, 2026; Nov 25 design): requests waiting for the signed-in person's step in an approval chain
// (leave: Supervisor → HR verification → approval; overtime: Supervisor → HR). Approve / Reject call the request's own
// decision route. Page: red hero, KPI cards, search + type / status / date filters, CSV export, table.
const ico = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const AI = {
  doc: ico('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  clock: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  check: ico('<path d="m6 12.5 4 4 8-9"/>'),
  x: ico('<path d="M7 7l10 10M17 7 7 17"/>'),
  leave: ico('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'),
  search: ico('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  export: ico('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
};
const HERO = '<svg viewBox="0 0 110 110" aria-hidden="true"><rect x="16" y="14" width="66" height="84" rx="8" fill="#1f4fc8"/><rect x="22" y="22" width="54" height="70" rx="4" fill="#fff"/><rect x="36" y="8" width="26" height="14" rx="4" fill="#14306e"/><path d="m30 38 4 4 7-8M30 56l4 4 7-8M30 74l4 4 7-8" stroke="#d7141a" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M48 39h20M48 57h20M48 75h12" stroke="#8ea6d8" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="80" r="20" fill="#22b45a" stroke="#fff" stroke-width="4"/><path d="m71 80 6 6 12-12" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TONES = ['green', 'amber', 'blue', 'violet', 'rose'];
const ui = { q: '', type: '', status: '', from: '', to: '' };

export async function inboxPage(ctx) {
  const { api, esc, shell, toast } = ctx;
  shell('<div class="loading">Loading…</div>');
  const [items, mine] = await Promise.all([api('/approvals/inbox'), api('/approvals/summary').catch(() => null)]);
  const who = name => String(name || '').split(',').map(x => x.trim());
  const initials = name => { const [last, first] = who(name); return `${(first || last || '?')[0]}${first ? last[0] : ''}`.toUpperCase(); };
  const tone = name => TONES[[...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length];
  const done = h => h.map(a => `${esc(a.step === 'supervisor' ? 'Supervisor' : a.step === 'verify' ? 'HR' : 'Approver')}: ${esc(a.decision)} · ${esc(a.by)}`).join('<br>') || '—';
  const firstDate = i => String(i.dates).slice(0, 10);
  const label = i => (i.ownStep ? (i.stage === 'supervisor' ? 'Endorse' : i.stage === 'verify' ? 'Verify' : 'Approve') : 'Decide without supervisor');
  const rows = () => {
    const q = ui.q.trim().toLowerCase();
    return items.filter(i => !ui.type || i.kind === ui.type).filter(i => !ui.status || (ui.status === 'mine' ? i.ownStep : !i.ownStep))
      .filter(i => (!ui.from || firstDate(i) >= ui.from) && (!ui.to || firstDate(i) <= ui.to))
      .filter(i => !q || `${i.employeeName} ${i.what} ${i.reason} ${i.reference || ''}`.toLowerCase().includes(q));
  };
  const draw = () => {
    const list = rows(), kpi = (cls, icon, value, text) => `<div class="ap-kpi ap-${cls}"><span>${icon}</span><div><strong>${value}</strong><small>${text}</small></div></div>`;
    const what = i => { const [type, ...rest] = String(i.what).split(' · '); return `<span class="ap-req ap-req-${esc(i.kind)}">${i.kind === 'overtime' ? AI.clock : AI.leave}<span><strong>${esc(type)}</strong><small>${esc(rest.join(' · '))}</small></span></span>`; };
    shell(`<div class="dp ap"><section class="dp-hero ap-hero"><span class="ap-hero-art">${HERO}</span><div class="dp-hello"><span>People Operations</span><h1>My Approvals</h1><p>Requests waiting for your step. Each step is recorded with your name.</p></div></section>
      <div class="ap-kpis">${kpi('blue', AI.doc, items.length, 'Total Requests')}${kpi('amber', AI.clock, items.filter(i => i.ownStep).length, 'Waiting for My Approval')}${kpi('green', AI.check, mine ? mine.approved : '—', 'Approved')}${kpi('rose', AI.x, mine ? mine.rejected : '—', 'Rejected')}</div>
      <div class="ap-tools"><label class="ap-search">${AI.search}<input type="search" data-ap="q" value="${esc(ui.q)}" placeholder="Search employee, request, or reason…" aria-label="Search employee, request, or reason"></label>
        <select class="ap-select" data-ap="type" aria-label="Request type"><option value="">All Request Types</option><option value="leave" ${ui.type === 'leave' ? 'selected' : ''}>Leave</option><option value="overtime" ${ui.type === 'overtime' ? 'selected' : ''}>Overtime</option></select>
        <select class="ap-select" data-ap="status" aria-label="Status"><option value="">All Status</option><option value="mine" ${ui.status === 'mine' ? 'selected' : ''}>Waiting for my step</option><option value="other" ${ui.status === 'other' ? 'selected' : ''}>Waiting for another step</option></select>
        <details class="ap-range"><summary class="ap-select">${ui.from || ui.to ? esc(`${ui.from || '…'} – ${ui.to || '…'}`) : 'Date Range'}${AI.leave}</summary><div class="ap-pop"><label>From<input type="date" data-ap="from" value="${esc(ui.from)}"></label><label>To<input type="date" data-ap="to" value="${esc(ui.to)}"></label><button class="small" data-ap-clear>Clear dates</button></div></details>
        <button class="ap-export" data-ap-export>${AI.export}Export</button></div>
      <section class="ap-table"><table><thead><tr><th>Employee</th><th>Request</th><th>Dates</th><th>Reason</th><th>Steps so far</th><th>Waiting for</th><th class="ap-act">Action</th></tr></thead><tbody>
        ${list.length ? list.map(i => `<tr><td><span class="ap-emp"><i class="ap-av ap-${tone(i.employeeName)}">${esc(initials(i.employeeName))}</i><span><strong>${esc(i.employeeName)}</strong>${i.reference ? `<small>${esc(i.reference)}</small>` : ''}</span></span></td><td>${what(i)}</td><td class="ap-dates">${esc(i.dates)}</td><td class="ap-reason">${esc(i.reason || '—')}</td><td class="ap-steps"><small>${done(i.history)}</small></td><td><span class="ap-stage">${esc(i.stageLabel)}</span></td><td class="ap-act"><button class="ap-ok" data-approve="${esc(i.id)}" data-kind="${esc(i.kind)}" data-own="${i.ownStep ? '1' : ''}">${AI.check}${label(i)}</button><button class="ap-no" data-reject="${esc(i.id)}" data-kind="${esc(i.kind)}">${AI.x}Reject</button></td></tr>`).join('') : `<tr><td colspan="7" class="ap-empty">${items.length ? 'No requests match these filters.' : 'Nothing is waiting for you.'}</td></tr>`}
      </tbody></table></section></div>`);
    const root = document.querySelector('.content');
    const q = root.querySelector('[data-ap="q"]');
    q.oninput = () => { ui.q = q.value; const pos = q.selectionStart; draw(); const again = document.querySelector('[data-ap="q"]'); again.focus(); again.setSelectionRange(pos, pos); };
    root.querySelectorAll('select[data-ap], input[type=date][data-ap]').forEach(el => { el.onchange = () => { ui[el.dataset.ap] = el.value; draw(); }; });
    root.onclick = async e => {
      root.querySelectorAll('.ap details[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
      if (e.target.closest('[data-ap-clear]')) { ui.from = ''; ui.to = ''; draw(); return; }
      if (e.target.closest('[data-ap-export]')) {
        const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`, line = r => r.map(cell).join(',');
        const csv = [line(['Employee', 'Reference', 'Request', 'Dates', 'Reason', 'Steps so far', 'Waiting for'])].concat(rows().map(i => line([i.employeeName, i.reference, i.what, i.dates, i.reason, i.history.map(a => `${a.step}: ${a.decision} (${a.by})`).join('; '), i.stageLabel]))).join('\r\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'my-approvals.csv'; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        return;
      }
      const ok = e.target.closest('[data-approve]'), no = e.target.closest('[data-reject]');
      if (!ok && !no) return;
      let remarks = '';
      if (no) { remarks = window.prompt('Reason for the rejection (the employee sees it):') || ''; if (remarks.trim().length < 3) return; }
      else if (!ok.dataset.own) { remarks = window.prompt('The Supervisor has not checked this request yet. Reason for deciding without them:') || ''; if (remarks.trim().length < 5) return; }
      const id = (ok || no).dataset.approve || (ok || no).dataset.reject, kind = (ok || no).dataset.kind;
      if (kind === 'overtime' && ok && ok.dataset.own !== '1') { toast('Open Attendance → Overtime applications to decide the hours.'); return; }
      const url = kind === 'overtime' ? `/overtime-requests/${encodeURIComponent(id)}/decision` : `/leaves/${encodeURIComponent(id)}/decision`, body = { decision: no ? 'reject' : 'approve', remarks };
      const send = async extra => { await api(url, { ...body, ...extra }); toast(no ? 'Rejected.' : 'Done. The request moved to the next step.'); inboxPage(ctx); };
      try { await send({}); } catch (error) {
        // Overtime without approved attendance / payable hours: the server accepts it only with a written override reason.
        if (kind === 'overtime' && ok && /override reason/i.test(error.message)) {
          const reason = window.prompt(`${error.message}\n\nOverride reason (at least 10 characters), or Cancel to leave it pending:`) || '';
          if (reason.trim().length < 10) { if (reason) toast('The override reason needs at least 10 characters.'); return; }
          try { await send({ overrideReason: reason.trim() }); } catch (again) { toast(again.message); }
          return;
        }
        toast(error.message);
      }
    };
  };
  draw();
}
