// Employee portal: My profile & 201 file → Employment (Nov 24, 2026). Official employment information read live from
// the HR records (GET /api/me/employment): status, compensation, work information, employment records and the change
// log. Read-only: HR changes it in the HR platform and it shows here at once.
const peso = v => (v === null || v === undefined || v === '' ? '—' : `₱${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = d => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const stamp = iso => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATUS_CLASS = { Active: 'ok', Regular: 'ok', 'On Leave': 'wait', Probationary: 'wait', Suspended: 'wait', Resigned: 'off', Terminated: 'off', Inactive: 'off', AWOL: 'off' };
const hours = h => (h === null || h === undefined || h === '' ? '' : `${h} h`);
const ampm = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${(h + 11) % 12 + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

export function renderEmployment(box, d, esc) {
  const kv = (label, value) => `<div class="bn-kv"><span>${esc(label)}</span><strong>${value || '—'}</strong></div>`;
  const chip = s => (s ? `<span class="bn-chip bn-${STATUS_CLASS[s] || 'wait'}">${esc(s)}</span>` : '');
  const s = d.status, c = d.compensation, w = d.work, r = d.records;
  const times = w.flexible ? `Flexible time${w.hoursPerDay ? ` · ${hours(w.hoursPerDay)} a day` : ''}` : w.start ? `${w.end ? `${ampm(w.start)} – ${ampm(w.end)}` : `From ${ampm(w.start)}`}${w.hoursPerDay ? ` · ${hours(w.hoursPerDay)}` : ''}${w.mealBreakMinutes ? ` · ${w.mealBreakMinutes} min meal break` : ''}` : '—';
  const move = m => [m.changes?.position && `Position: ${m.before?.position || '—'} → ${m.changes.position}`, m.changes?.department && `Department: ${m.before?.department || '—'} → ${m.changes.department}`, m.changes?.classification && `Classification: ${m.before?.classification || '—'} → ${m.changes.classification}`, m.changes?.employmentType && `Type: ${m.before?.employmentType || '—'} → ${m.changes.employmentType}`, m.changes?.separationKind].filter(Boolean).map(esc).join('<br>');
  box.innerHTML = `<section class="bn-page em-emp">
    <p class="em-updated">🔄 Synchronized with HR records · last updated ${d.lastUpdated ? `${esc(stamp(d.lastUpdated))}${d.lastUpdatedBy ? ` by ${esc(d.lastUpdatedBy)}` : ''}` : 'not yet'}</p>
    <section class="bn-card"><div class="bn-line-head"><h3>Employment status</h3>${chip(s.status)}</div>
      <div class="bn-grid">${kv('Classification', esc(s.classification) + (s.classification ? '' : ''))}${kv('Employment type', esc(s.employmentType))}${kv('Date hired', esc(day(s.dateHired)))}${kv('Regularization date', esc(day(s.regularizationDate)))}${s.probationEnd ? kv('Probation ends', esc(day(s.probationEnd))) : ''}${kv('Employment end date', esc(s.endDate ? day(s.endDate) : 'Not applicable'))}${s.jobLevel ? kv('Job level', esc(s.jobLevel)) : ''}</div></section>
    <section class="bn-card"><h3>Compensation</h3>
      <div class="bn-grid">${kv('Basic salary', `${peso(c.basicSalary)}${c.basicSalary ? ' <small>/ month</small>' : ''}`)}${kv('Salary rate', esc(c.rateLabel))}${c.dailyRate ? kv('Daily rate', peso(c.dailyRate)) : ''}${c.hourlyRate ? kv('Hourly rate', peso(c.hourlyRate)) : ''}${kv('Effective date', esc(day(c.effectiveDate)))}</div>
      <h4>Allowances</h4>${c.allowances.length ? `<ul class="bn-list">${c.allowances.map(a => `<li><strong>${esc(a.type)}</strong><span>${peso(a.amount)} · ${esc(a.frequency)} · from ${esc(day(a.effectiveDate))}</span></li>`).join('')}</ul>` : '<p class="muted">None.</p>'}</section>
    <section class="bn-card"><h3>Work information</h3>
      <div class="bn-grid">${kv('Department', esc(w.department))}${kv('Position', esc(w.position))}${kv('Immediate supervisor', esc(w.supervisor))}${kv('Work location', esc(w.workLocation))}${kv('Work arrangement', esc(w.arrangement))}${kv('Working hours', esc(times))}${kv('Working days', esc(w.workingDays.join(', ')))}${kv('Rest days', esc(w.restDays.length ? w.restDays.join(', ') : 'None'))}</div></section>
    <section class="bn-card"><h3>Employment records</h3>
      <h4>Employment contract</h4><div class="bn-grid">${kv('Contract start', esc(day(r.contract.start)))}${kv('Contract end', esc(r.contract.end ? day(r.contract.end) : 'No end date'))}${kv('Signed copy', esc(r.contract.onFile ? `On file with HR${r.contract.uploadedAt ? ` (${day(r.contract.uploadedAt)})` : ''}` : 'Not yet on file'))}</div>
      <h4>Employment history</h4>${r.movements.length ? `<ul class="bn-list em-moves">${r.movements.map(m => `<li><div><strong>${esc(m.type)}</strong><span>${move(m) || ''}</span></div><small>${esc(day(m.date))}</small></li>`).join('')}</ul>` : '<p class="muted">No promotions, transfers or other movements yet.</p>'}
      ${r.salaryHistory.length ? `<h4>Salary history</h4><ul class="bn-list">${r.salaryHistory.map(x => `<li><strong>${esc(day(x.date))}</strong><span>${peso(x.before?.monthlySalary)} → ${peso(x.after?.monthlySalary)}</span></li>`).join('')}</ul>` : ''}
      ${r.previousEmployment.length ? `<h4>Previous employment</h4><ul class="bn-list">${r.previousEmployment.map(p => `<li><strong>${esc(p.company)}</strong><span>${esc(p.position || '')}${p.from || p.to ? ` · ${esc(day(p.from))} – ${esc(p.to ? day(p.to) : 'present')}` : ''}</span></li>`).join('')}</ul>` : ''}</section>
    <details class="bn-card em-changes"><summary><h3>Record of changes</h3><span>${d.changes.length}</span></summary>${d.changes.length ? `<ol class="bn-timeline">${d.changes.map(x => `<li><p>${x.changes.map(y => `<strong>${esc(y.field)}</strong>: ${esc(y.from)} → ${esc(y.to)}`).join('<br>')}</p><small>${esc(stamp(x.at))} · by ${esc(x.by)}</small></li>`).join('')}</ol>` : '<p class="muted">No changes recorded yet.</p>'}</details>
    <p class="legend bn-note">This information comes from HR and cannot be edited here. If something is wrong or out of date, tell HR.</p></section>`;
}
