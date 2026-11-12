// Live attendance "Reason" column: everything an employee gave as a reason for the day, in one place — out-of-office
// time in / out, a late arrival explanation, leave and overtime — each with its explanation, attachment and proof.
// Reasons are typed as "Choice — explanation" (the dropdown choice first), so the short label is the part before " — ".
const split = text => { const [choice, ...rest] = String(text || '').split(' — '); return { label: choice.trim(), explanation: rest.join(' — ').trim() }; };
const STATUS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', returned: 'Sent back', cancelled: 'Cancelled', submitted: 'Submitted' };
const leaveCovers = (l, day) => (l.countedDates?.length ? l.countedDates.includes(day) : l.startDate <= day && l.endDate >= day);
const document = id => (/^[0-9a-f-]{36}$/.test(id || '') ? id : '');

export function reasonsFor(store, state, employeeId, day) {
  const reasons = [];
  const events = store.db.prepare('SELECT data FROM clock_events WHERE employee_id=? AND work_date=? ORDER BY rowid').all(employeeId, day).map(r => JSON.parse(r.data));
  for (const e of events.filter(x => x.outOfOffice)) {
    const r = split(e.reason);
    reasons.push({ kind: 'out-of-office', title: `Off-site work time ${e.kind}`, label: r.label || 'Off-site work', explanation: r.explanation || e.reason || '', detail: `Time ${e.kind} at ${e.time}`, status: '', documentId: '' });
  }
  const explanation = store.db.prepare('SELECT data FROM attendance_explanations WHERE employee_id=? ORDER BY rowid DESC').all(employeeId).map(r => JSON.parse(r.data)).find(x => x.date === day && x.status !== 'rejected');
  if (explanation) reasons.push({ kind: 'late', title: 'Late arrival explanation', label: explanation.reason || 'Late', explanation: explanation.explanation || '', detail: explanation.requestedOffset ? `Requested offset ${explanation.requestedOffset} min` : '', status: STATUS[explanation.status] || explanation.status, documentId: document(explanation.documentId) });
  for (const l of state.leaves.filter(x => x.employeeId === employeeId && ['pending', 'approved'].includes(x.status) && leaveCovers(x, day))) {
    const r = split(l.reason), type = state.leaveTypes.find(t => t.id === l.typeId)?.name || l.typeId;
    reasons.push({ kind: 'leave', title: type, label: r.label || type, explanation: r.explanation, detail: `${l.startDate}${l.endDate !== l.startDate ? ` to ${l.endDate}` : ''} · ${l.days} day${l.days === 1 ? '' : 's'}`, status: STATUS[l.status] || l.status, documentId: document(l.documentReference), proof: l.proofStatus || '', proofNote: l.proofNote || '' });
  }
  const overtime = store.db.prepare("SELECT data FROM overtime_requests WHERE employee_id=? AND date=? AND status IN ('pending','approved')").all(employeeId, day).map(r => JSON.parse(r.data));
  for (const o of overtime) {
    const r = split(o.reason);
    reasons.push({ kind: 'overtime', title: 'Overtime application', label: r.label || 'Overtime', explanation: r.explanation, detail: `${o.startTime ? `${o.startTime}–${o.endTime}` : ''}${o.breakMinutes ? ` · ${o.breakMinutes} min break` : ''} · ${o.status === 'approved' ? `${o.approvedHours} of ${o.hours} h approved` : `${o.hours} h filed`}`, status: STATUS[o.status] || o.status, documentId: document(o.documentId) });
  }
  return reasons;
}
