// Memo viewer (Company Communications policy, Nov 20, 2026): the official PDF of the memo inside GDS TimeHub with
// Download, Print and Open-in-new-tab (zoom is in the PDF toolbar), the deadline and the reader's status. Employees
// acknowledge here with the policy wording or ask for clarification; opening, printing or downloading never
// acknowledges. HR sees each recipient: status, deadline, first view, acknowledgment (paper ones marked manual, with
// the evidence), last reminder and clarification questions to answer.
import { fmtDate, fmtDateTime, readFile } from './hr-common.js';

export const STATUS_ICON = { pending: '🔔', overdue: '⚠️', clarification: '❓', answered: '🔔', acknowledged: '✅', withdrawn: '—', 'not-required': '' };
const TONE = { pending: 'pending', overdue: 'rejected', clarification: 'pending', answered: 'pending', acknowledged: '', withdrawn: 'neutral', 'not-required': 'neutral' };
export const statusChip = (esc, status, label) => `<span class="badge memo-status memo-status-${esc(status)} ${TONE[status] || ''}">${STATUS_ICON[status] ? `<span aria-hidden="true">${STATUS_ICON[status]}</span> ` : ''}${esc(label)}</span>`;
// Browsers on phones usually cannot show a PDF inside the page: offer the PDF in a new tab there.
const inlinePdf = () => navigator.pdfViewerEnabled !== false && !/Android|iPhone|iPad/i.test(navigator.userAgent);

export function pdfPane(esc, url, title) {
  return `<div class="memo-viewer"><div class="memo-viewer-bar"><a class="memo-bar-link" href="${esc(url)}" target="_blank" rel="noopener">↗ Open in new tab</a><a class="memo-bar-link" href="${esc(url)}${url.includes('?') ? '&' : '?'}download=1">⬇ Download</a>${inlinePdf() ? '<button type="button" class="memo-bar-link" data-memo-print>🖨 Print</button>' : ''}<span class="legend">Zoom with the PDF toolbar or your browser.</span></div>
    ${inlinePdf() ? `<iframe class="memo-frame" src="${esc(url)}" title="${esc(title)} (PDF)"></iframe>` : `<p class="legend">Tap <strong>Open in new tab</strong> to read the official PDF (zoom, download and print are in your phone's PDF viewer).</p>`}</div>`;
}
export function bindPrint(root) {
  root.querySelector('[data-memo-print]')?.addEventListener('click', () => { const frame = root.querySelector('.memo-frame'); try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(frame.src, '_blank', 'noopener'); } });
}

// ---------- Employee ----------
export function openMyMemo({ api, esc, toast, openDialog, dialog }, m, done) {
  const url = `/api/hr/me/memos/${m.memoId}/${m.version}.pdf`;
  api(`/hr/me/memos/${m.memoId}/${m.version}/view`, {}).catch(() => {});
  const thread = m.clarifications.length ? `<h3>Your questions</h3>${m.clarifications.map(q => `<div class="memo-q"><p><strong>You</strong> <small>${fmtDateTime(q.askedAt)}</small><br>${esc(q.question)}</p>${q.answer ? `<p><strong>HR</strong> <small>${fmtDateTime(q.answeredAt)}</small><br>${esc(q.answer)}</p>` : '<p class="legend">Waiting for HR’s answer.</p>'}</div>`).join('')}` : '';
  const act = m.ackRequired && !m.acknowledgedAt && m.latest && !m.archived;
  openDialog(m.title, `<div class="dialog-body memo-view-body">
    <p class="sub">${esc(m.reference)} · ${esc(m.category || '')} · issued ${fmtDate(m.issueDate)}${m.effectiveDate ? ` · effective ${fmtDate(m.effectiveDate)}` : ''} · version ${m.version}</p>
    <p>${statusChip(esc, m.status, m.statusLabel)}${m.ackRequired && !m.acknowledgedAt ? ` <span class="legend">Acknowledge by ${fmtDate(m.ackDeadline)}</span>` : ''}${m.acknowledgedAt ? ` <span class="legend">${m.manualAck ? 'Recorded by HR from your signed copy' : 'You acknowledged'} on ${fmtDateTime(m.acknowledgedAt)}</span>` : ''}</p>
    ${pdfPane(esc, url, m.title)}
    ${m.attachments.length ? `<p>${m.attachments.map(a => `<a href="/api/hr/me/memo-attachments/${a.id}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>`).join(' ')}</p>` : ''}
    ${thread}
    ${act ? `<div class="memo-ack-box"><p><strong>“${esc(m.ackWording)}”</strong></p><p class="legend">Acknowledging records receipt and understanding. It is not an admission of wrongdoing, an agreement to a separate contract change, or a waiver of your rights.</p>
      <form data-memo-q class="memo-q-form hidden"><label class="field">Your question for HR<textarea name="question" rows="3" required minlength="5" maxlength="2000"></textarea></label><div class="form-error hidden" role="alert"></div><button class="primary small">Send question</button></form></div>` : ''}</div>`,
  `<div class="dialog-foot">${act ? `<button type="button" data-memo-ask>❓ Request Clarification</button><button type="button" class="primary" data-memo-ack>${esc(m.ackButton)}</button>` : '<button type="button" data-close>Close</button>'}</div>`);
  dialog.classList.add('wide-dialog');
  dialog.addEventListener('close', () => dialog.classList.remove('wide-dialog'), { once: true });
  bindPrint(dialog);
  dialog.querySelector('[data-memo-ask]')?.addEventListener('click', () => { const f = dialog.querySelector('[data-memo-q]'); f.classList.remove('hidden'); f.elements.question.focus(); });
  dialog.querySelector('[data-memo-q]')?.addEventListener('submit', async event => {
    event.preventDefault();
    const f = event.target, err = f.querySelector('.form-error');
    try { await api(`/hr/me/memos/${m.memoId}/${m.version}/clarification`, { question: f.elements.question.value }); dialog.close(); toast('Your question was sent to HR. Status: Clarification Requested.'); done(); }
    catch (error) { err.textContent = error.message; err.classList.remove('hidden'); }
  });
  dialog.querySelector('[data-memo-ack]')?.addEventListener('click', async event => {
    event.target.disabled = true;
    try { await api(`/hr/me/memos/${m.memoId}/${m.version}/acknowledge`, {}); dialog.close(); toast('Acknowledged — received, read and understood. HR can see the date and time.'); done(); }
    catch (error) { toast(error.message); event.target.disabled = false; }
  });
}

// ---------- HR ----------
const FILTERS = [['all', 'All'], ['acknowledged', 'Acknowledged'], ['open', 'Not acknowledged'], ['overdue', 'Overdue'], ['clarification', 'Clarification']];
// Acknowledgement records (Nov 25, 2026 design): five count cards that filter the list, a search box, a numbered
// table with icons, and the note. Same data, filters and actions as before.
const mi = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const MK = { people: mi('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'), shield: mi('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'), clock: mi('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), alert: mi('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.01"/>'), chat: mi('<path d="M4 5h16v11H9l-5 4z"/>'), search: mi('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'), cal: mi('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'), bell: mi('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'), info: mi('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>') };
const CARD = { all: ['grey', MK.people, 'All Employees'], acknowledged: ['green', MK.shield, 'Acknowledged'], open: ['amber', MK.clock, 'Not Acknowledged'], overdue: ['red', MK.alert, 'Overdue'], clarification: ['violet', MK.chat, 'Clarification'] };
export function recipientsHtml(ctx, memo, v, filter = 'all') {
  const { esc } = ctx;
  const match = (a, key) => (key === 'all' ? true : key === 'acknowledged' ? a.status === 'acknowledged' : key === 'open' ? !a.acknowledgedAt && a.status !== 'not-required' : a.status === key);
  const rows = v.assignments.filter(a => match(a, filter));
  const count = key => v.assignments.filter(a => match(a, key)).length;
  return `<div class="mk-cards">${FILTERS.map(([k]) => { const [tone, icon, label] = CARD[k]; return `<button type="button" class="mk-card mk-${tone}${k === filter ? ' on' : ''}" data-memo-filter="${k}" data-version="${v.version}"><span>${icon}</span><div><strong>${count(k)}</strong><small>${label}</small></div></button>`; }).join('')}</div>
    <div class="mk-panel"><label class="mk-search">${MK.search}<input type="search" data-mk-search placeholder="Search employee, company, or status…" aria-label="Search employee, company, or status"></label>
    <div class="mk-table"><table><thead><tr><th>#</th><th>Employee</th><th>Company / Team</th><th>Status</th><th>Due Date</th><th>First Viewed</th><th>Acknowledged</th><th>Last Reminder</th><th>Clarification</th><th></th></tr></thead><tbody>
    ${rows.map((a, i) => `<tr data-mk-row="${esc(`${a.name || a.employeeId} ${a.department || ''} ${a.statusLabel || a.status}`.toLowerCase())}"><td><span class="mk-num">${i + 1}</span></td><td><strong>${esc(a.name || a.employeeId)}</strong></td><td>${esc(a.department || '—')}</td><td>${statusChip(esc, a.status, a.statusLabel)}</td>
      <td>${a.due ? `<span class="mk-ic">${MK.cal}${fmtDate(a.due)}</span>` : '—'}</td>
      <td>${a.firstViewedAt ? fmtDateTime(a.firstViewedAt) : '<span class="mk-pill">Not opened</span>'}</td>
      <td>${a.acknowledgedAt ? `${a.manual ? `${fmtDate(a.manual.receivedOn)}<small>Paper acknowledgment recorded by ${esc(a.manual.by)} · <a href="/api/hr/memo-evidence/${esc(a.manual.evidenceId)}" target="_blank" rel="noopener">${esc(a.manual.evidenceName)}</a></small>` : fmtDateTime(a.acknowledgedAt)}` : '—'}</td>
      <td>${a.lastReminderAt ? `<span class="mk-ic mk-bell">${MK.bell}${fmtDateTime(a.lastReminderAt)}</span>` : '—'}</td>
      <td>${a.clarifications.length ? a.clarifications.map(q => `<div class="memo-q-cell"><small>${fmtDateTime(q.askedAt)}</small> ${esc(q.question)}${q.answer ? `<br><small>Answered by ${esc(q.answeredBy)}: ${esc(q.answer)}</small>` : ` <button type="button" class="small primary" data-memo-answer="${esc(q.id)}">Answer</button>`}</div>`).join('') : '—'}</td>
      <td>${!a.acknowledgedAt && memo.canRecordPaper && a.status !== 'withdrawn' && a.status !== 'not-required' ? `<button type="button" class="small" data-memo-paper="${esc(a.employeeId)}" data-version="${v.version}">Record paper acknowledgment</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="mk-empty">Nothing to show yet.</td></tr>'}
    </tbody></table></div>
    <p class="mk-note">${MK.info}<span><strong>Note:</strong> Counts show explicit acknowledgments of this version only. Opening the PDF is not an acknowledgment. Before any follow-up on overdue items, check access problems, approved leave and other circumstances. Due date = the issuer's date, or the end of the employee's next scheduled working day.</span></p></div>`;
}
// Search box: hides rows in place (no redraw, so typing is not interrupted).
if (typeof document !== 'undefined') document.addEventListener('input', e => { if (!e.target.matches?.('[data-mk-search]')) return; const q = e.target.value.trim().toLowerCase(); e.target.closest('.mk-panel')?.querySelectorAll('[data-mk-row]').forEach(r => { r.hidden = !!q && !r.dataset.mkRow.includes(q); }); });
export function bindRecipients(ctx, root, memo, reload) {
  const { api, toast, openDialog, dialog } = ctx;
  root.addEventListener('click', async event => {
    const f = event.target.closest('[data-memo-filter]');
    if (f) { const v = memo.versions.find(x => x.version === Number(f.dataset.version)); f.closest('.memo-recipients').innerHTML = recipientsHtml(ctx, memo, v, f.dataset.memoFilter); return; }
    const answer = event.target.closest('[data-memo-answer]');
    if (answer) {
      const text = window.prompt('Answer to the employee (they are notified and asked to acknowledge once it is clear):');
      if (!text) return;
      try { await api(`/hr/memos/${memo.id}/clarifications/${answer.dataset.memoAnswer}/answer`, { answer: text }); toast('Answer sent to the employee.'); reload(); } catch (error) { toast(error.message); }
      return;
    }
    const paper = event.target.closest('[data-memo-paper]');
    if (paper) {
      const a = memo.versions.find(x => x.version === Number(paper.dataset.version)).assignments.find(x => x.employeeId === paper.dataset.memoPaper);
      openDialog(`Paper acknowledgment · ${a.name}`, `<form id="memo-paper"><div class="dialog-body"><div class="form-error hidden" role="alert"></div><div class="form-grid one">
        <p class="legend">Only for a genuine signed acknowledgment or other documented receipt. It is recorded as a manual event with the evidence and your name; administrators never acknowledge for an employee.</p>
        <label class="field">Date the employee signed<input type="date" name="receivedOn" required max="${ctx.today()}"></label>
        <label class="field">What was signed / how it was received<input name="note" required minlength="5" maxlength="500" placeholder="e.g. Signed acknowledgment slip, filed in the 201"></label>
        <label class="field">Evidence (scan of the signed copy · PDF, JPG or PNG up to 10 MB)<input type="file" name="file" required accept="application/pdf,image/png,image/jpeg"></label></div></div>
        <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Record</button></div></form>`);
      const form = dialog.querySelector('#memo-paper');
      form.onsubmit = async e => {
        e.preventDefault();
        const file = form.elements.file.files[0], err = form.querySelector('.form-error');
        try { await api(`/hr/memos/${memo.id}/${paper.dataset.version}/paper-ack/${encodeURIComponent(a.employeeId)}`, { receivedOn: form.elements.receivedOn.value, note: form.elements.note.value, name: file.name, mime: file.type, data: await readFile(file) }); dialog.close(); toast('Paper acknowledgment recorded.'); reload(); }
        catch (error) { err.textContent = error.message; err.classList.remove('hidden'); }
      };
    }
  });
}
