// Payroll attendance review (Nov 20, 2026): the days payroll cannot validate on its own, each with its specific issue
// (missing punch, conflicting records, manual entry not approved, time correction pending). Original punches are
// System Validated and HR-approved records / corrections are used automatically; only these items need HR. Each item
// needs a documented payroll decision; nothing is treated as an absence or a full-day deduction by itself. Employees
// with undecided items are held out of posting; everyone else can be finalized now.
const DECISIONS = { 'pay-recorded': 'Pay as recorded', credit: 'Credit as a worked day pending verification', hold: 'Hold: not paid until resolved', absent: 'Absent (verified by HR)' };
const ISSUE_TONE = { 'missing-punch': 'att-chip-out', conflict: 'att-chip-none', 'manual-entry': 'att-chip-verify', 'pending-correction': 'att-chip-in' };
const nice = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function reviewHtml(run, esc) {
  const items = run.reviewItems || [], held = new Set(run.held || []);
  if (!items.length) return '';
  const byEmployee = [...new Set(items.map(i => i.employeeId))].map(id => ({ id, name: items.find(i => i.employeeId === id).employeeName, items: items.filter(i => i.employeeId === id) }));
  const ok = run.rows.filter(r => !held.has(r.employeeId)).length;
  return `<section class="panel pr-review"><div class="panel-head"><div><h2>Attendance for HR review · ${items.length} item${items.length === 1 ? '' : 's'}, ${held.size} employee${held.size === 1 ? '' : 's'} held</h2>
    <p class="legend">Original TimeHub time in / out that is complete and consistent is <strong>System Validated</strong>; records and time corrections HR already approved are used as approved. Only the days below need you. Record a payroll decision with the reason for each; none is treated as an absence automatically. ${ok} employee${ok === 1 ? '' : 's'} without items can be finalized now; held employees are finalized once every item has a decision. Overtime approval is separate.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>Issue</th><th>Details</th><th>Payroll decision</th></tr></thead><tbody>
    ${byEmployee.map(g => g.items.map((i, n) => `<tr>${n === 0 ? `<td rowspan="${g.items.length}"><strong>${esc(g.name)}</strong><br><small>${g.items.length} item${g.items.length === 1 ? '' : 's'} · held</small></td>` : ''}<td>${esc(nice(i.date))}</td><td><span class="att-chip ${ISSUE_TONE[i.issue] || ''}">${esc(i.issueLabel)}</span></td><td class="wrap">${esc(i.detail || '')}</td>
      <td><form class="pr-decide" data-pr-decide="${esc(i.employeeId)}" data-date="${esc(i.date)}" data-issue="${esc(i.issue)}"><select name="mode" required><option value="">Choose…</option>${Object.entries(DECISIONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><input name="note" required minlength="5" maxlength="1000" placeholder="Reason / documentation"><button class="small primary">Save</button></form></td></tr>`).join('')).join('')}
    </tbody></table></div></section>`;
}
export function bindReview(box, { api, toast }, onSaved) {
  box.querySelectorAll('[data-pr-decide]').forEach(form => {
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('button'); button.disabled = true;
      try {
        await api('/payroll/decisions', { employeeId: form.dataset.prDecide, date: form.dataset.date, issue: form.dataset.issue, mode: form.elements.mode.value, note: form.elements.note.value });
        toast('Payroll decision recorded. Recalculating…'); await onSaved();
      } catch (error) { toast(error.message); button.disabled = false; }
    };
  });
}
