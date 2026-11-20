import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, saveRecord } from '../src/service.mjs';
import { completeState, admin } from './helpers.mjs';
import { rulesView, rulesViewText } from '../public/rules-view.js';

const hr = { id: 'hr-1', username: 'hr1', role: 'hr', displayName: 'Salustiana Tower' };

test('an approved rules version is locked, names the approver, and is not also a draft', () => {
  const store = new Store(':memory:');
  try {
    const state = completeState();
    state.rules[0] = { ...state.rules[0], approvedBy: '', basis: 'Draft entered 2026-10-01 for HR/accountant review before approval.' };
    store.write(state);
    const draft = store.read().rules[0];
    assert.equal(rulesView(draft).status, 'Draft');
    assert.equal(rulesView(draft).save, true);
    assert.throws(() => saveRecord(store, hr, 'rules', { ...draft, approvedBy: 'approve' }), /draft legal basis/);
    assert.equal(store.read().rules[0].basis, draft.basis, 'the refused approval did not rewrite the draft');
    const basis = 'Company payroll policy, confirmed for use. Rates are unchanged from the template.';
    const approved = saveRecord(store, hr, 'rules', { ...draft, basis, approvedBy: 'approve' });
    assert.equal(approved.approvedBy, 'Salustiana Tower');
    assert.equal(approved.approvedByUserId, 'hr-1');
    assert.ok(approved.approvedAt);
    assert.equal(approved.id, draft.id);
    assert.equal(approved.ordinaryOT, draft.ordinaryOT);
    assert.equal(approved.regular, draft.regular);
    const shown = rulesViewText(approved);
    assert.match(shown, /Status: Approved/);
    assert.match(shown, /Version: r1/);
    assert.match(shown, /Salustiana Tower/);
    assert.equal(/\bDraft\b/.test(shown), false);
    assert.equal(rulesView(approved).save, false);
    assert.equal(rulesView(approved).approve, false);
    assert.throws(() => saveRecord(store, hr, 'rules', { ...approved, ordinaryOT: 1.5, approvedBy: 'approve' }), /cannot be edited/);
    assert.throws(() => saveRecord(store, hr, 'rules', { ...approved, approvedBy: '' }), /cannot be edited/);
    assert.equal(store.read().rules[0].ordinaryOT, draft.ordinaryOT);
    const next = saveRecord(store, hr, 'rules', { ...approved, id: 'r2', effectiveDate: '2026-12-01', approvedBy: '', basis });
    assert.equal(next.approvedBy, '');
    assert.equal(store.read().rules.find(r => r.id === 'r1').approvedBy, 'Salustiana Tower');
    const audit = store.audit().find(a => a.kind === 'rules' && a.action === 'update' && a.after?.approvedBy === 'Salustiana Tower');
    assert.ok(audit);
    assert.equal(audit.actorName, 'Salustiana Tower');
    assert.equal(audit.actorUserId, 'hr-1');
    assert.throws(() => saveRecord(store, { username: 'contribution-timing-update', role: 'admin' }, 'rules', { ...next, approvedBy: 'approve' }), /named person/);
  } finally { store.close(); }
});

test('a payroll preview keeps the rules version that was effective, after a later version is approved', () => {
  const store = new Store(':memory:');
  try {
    store.write(completeState());
    const before = preview(store, '2026-09-01', '2026-09-15');
    const current = store.read().rules[0];
    saveRecord(store, admin, 'rules', { ...current, id: 'later', effectiveDate: '2026-10-01', ordinaryOT: 1.5, approvedBy: 'approve', basis: 'Later policy. Rates for September stay on the earlier version.' });
    const after = preview(store, '2026-09-01', '2026-09-15');
    assert.equal(after.ruleId, before.ruleId);
    assert.equal(after.rows[0].gross, before.rows[0].gross);
    assert.equal(store.read().rules.find(r => r.id === 'later').ordinaryOT, 1.5);
    assert.equal(store.read().rules.find(r => r.id === before.ruleId).ordinaryOT, current.ordinaryOT);
  } finally { store.close(); }
});
