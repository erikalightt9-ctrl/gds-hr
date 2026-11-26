// Employee portal: My Benefits (Nov 24, 2026). Read-only: government contributions with their payment records, HMO
// coverage, allowances and the history of every change. HR and Finance keep the records.
const VIEWS = [['contributions', 'Contributions'], ['hmo', 'HMO'], ['allowances', 'Allowances'], ['history', 'History']];
const peso = v => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = m => new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const day = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const stamp = iso => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATUS_CLASS = { Verified: 'ok', Paid: 'ok', 'Remitted (recorded sheet)': 'ok', Active: 'ok', Pending: 'wait', Suspended: 'wait', Expired: 'off', Cancelled: 'off', Ended: 'off' };

export function createPortalBenefits({ api, esc }) {
  let view = 'contributions';
  const chip = status => `<span class="bn-chip bn-${STATUS_CLASS[status] || 'wait'}">${esc(status)}</span>`;
  const row = (label, value) => `<div class="bn-kv"><span>${esc(label)}</span><strong>${value}</strong></div>`;

  function contributions(list) {
    if (!list.length) return '<p class="muted bn-empty">No contribution records yet. They appear once a month\'s payroll is final.</p>';
    const year = String(new Date().getFullYear()), ytd = agency => list.filter(c => c.agency === agency && c.month.startsWith(year)).reduce((s, c) => s + c.employeeShare, 0);
    const totals = `<div class="bn-totals">${[['sss', 'SSS'], ['philhealth', 'PhilHealth'], ['pagibig', 'Pag-IBIG']].map(([k, n]) => `<div><span>${n} ${year}</span><strong>${peso(ytd(k))}</strong><small>your share</small></div>`).join('')}</div>`;
    const months = [...new Set(list.map(c => c.month))];
    return totals + months.map(m => `<section class="bn-card"><h3>${esc(monthName(m))}</h3>${list.filter(c => c.month === m).map(c => `<div class="bn-line">
      <div class="bn-line-head"><strong>${esc(c.agencyName)}</strong>${chip(c.status)}</div>
      <div class="bn-grid">${row('Your share', peso(c.employeeShare))}${row('Employer share', peso(c.employerShare))}${row('Payment date', esc(day(c.paymentDate)))}${row('Reference no.', esc(c.reference || '—'))}</div>
      ${c.proof ? `<a class="bn-proof" href="/api/me/benefits/files/${esc(c.proof.id)}" target="_blank" rel="noopener">📄 Proof of payment: ${esc(c.proof.name)}</a>` : ''}</div>`).join('')}</section>`).join('');
  }
  function hmo(h) {
    if (!h) return '<p class="muted bn-empty">No HMO coverage on record. HR records your HMO membership here once it is enrolled.</p>';
    return `<section class="bn-card"><div class="bn-line-head"><h3>${esc(h.provider)}</h3>${chip(h.status)}</div>
      <div class="bn-grid">${row('Membership no.', esc(h.memberNo))}${row('Plan', esc(h.plan))}${h.planId ? row('Plan ID', esc(h.planId)) : ''}${h.rank ? row('Rank classification', esc(h.rank)) : ''}${h.benefitLimit !== undefined && h.benefitLimit !== '' ? row(`${esc(h.benefitType || 'Benefit')} limit`, peso(h.benefitLimit)) : ''}${row('Coverage start', esc(day(h.startDate)))}${row('Expiration', esc(day(h.endDate)))}</div>
      ${h.coverage ? `<p class="bn-text"><span>Coverage details</span>${esc(h.coverage)}</p>` : ''}
      <h4>Covered dependents</h4>${h.dependents?.length ? `<ul class="bn-list">${h.dependents.map(d => `<li><strong>${esc(d.name)}</strong><span>${esc(d.relationship)}${d.memberNo ? ` · ${esc(d.memberNo)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">None.</p>'}
      <p class="bn-meta">Last updated ${esc(stamp(h.updatedAt))} by ${esc(h.updatedBy)}</p></section>`;
  }
  function allowances(list) {
    if (!list.length) return '<p class="muted bn-empty">No allowances on record.</p>';
    return list.map(a => `<section class="bn-card"><div class="bn-line-head"><h3>${esc(a.type)}</h3>${chip(a.status)}</div>
      <div class="bn-grid">${row('Approved amount', peso(a.amount))}${row('Frequency', esc(a.frequency))}${row('Effective', esc(day(a.effectiveDate)))}${row('Until', esc(a.endDate ? day(a.endDate) : 'No end date'))}</div>
      ${a.eligibility ? `<p class="bn-text"><span>Eligibility</span>${esc(a.eligibility)}</p>` : ''}
      <h4>Payment history</h4>${a.payments?.length ? `<ul class="bn-list">${[...a.payments].reverse().map(p => `<li><strong>${peso(p.amount)}</strong><span>${esc(day(p.date))}${p.reference ? ` · ref. ${esc(p.reference)}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No payments recorded yet.</p>'}</section>`).join('');
  }
  function history(items) {
    if (!items.length) return '<p class="muted bn-empty">Nothing recorded yet.</p>';
    return `<ol class="bn-timeline">${items.map(h => `<li><span class="bn-tag bn-tag-${esc(h.category.toLowerCase())}">${esc(h.category)}</span><p>${esc(h.text)}</p><small>${esc(stamp(h.at))} · by ${esc(h.by)}</small></li>`).join('')}</ol>`;
  }
  function draw(box, data) {
    const body = { contributions: () => contributions(data.contributions), hmo: () => hmo(data.hmo), allowances: () => allowances(data.allowances), history: () => history(data.history) }[view]();
    box.innerHTML = `<section class="bn-page"><div class="tabs sub-tabs bn-tabs">${VIEWS.map(([id, label]) => `<button type="button" data-bn-view="${id}" class="${id === view ? 'active' : ''}">${label}</button>`).join('')}</div>
      ${body}<p class="legend bn-note">Records are kept by HR and Finance and cannot be changed here. If something is missing or wrong, tell HR.</p></section>`;
    box.querySelector('.bn-tabs').onclick = event => { const b = event.target.closest('[data-bn-view]'); if (b && b.dataset.bnView !== view) { view = b.dataset.bnView; draw(box, data); } };
  }
  async function fill(box) {
    box.innerHTML = '<div class="loading">Loading…</div>';
    try { draw(box, await api('/me/benefits')); } catch (error) { box.innerHTML = `<div class="notice">${esc(/not found/i.test(error.message) ? 'My Benefits will be available after the HR server restarts.' : error.message)}</div>`; }
  }
  return { fill };
}
