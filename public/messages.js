// Messages: a 💬 button next to the bell (HR screens and the employee portal) opens a side panel with everyone who
// uses the system. Pick a person to chat one-to-one; new messages arrive live and the button shows how many are unread.
// The panel lives outside the page area, so page refreshes do not close it.
let ctx = null, panel = null, openWith = null, unread = 0, loading = false;

export const messagesButton = () => `<span class="msg-wrap"><button class="small icon-button msg-button" data-msg-open aria-label="Messages" title="Messages">💬<span class="bell-count${unread ? '' : ' hidden'}" data-msg-count>${unread > 9 ? '9+' : unread || ''}</span></button></span>`;

const time = iso => {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', ...(today ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) });
};
function paintCount() {
  for (const node of document.querySelectorAll('[data-msg-count]')) { node.textContent = unread > 9 ? '9+' : String(unread || ''); node.classList.toggle('hidden', !unread); }
  for (const b of document.querySelectorAll('[data-msg-open]')) b.setAttribute('aria-label', unread ? `Messages (${unread} unread)` : 'Messages');
}
function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement('aside');
  panel.className = 'msg-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Messages');
  document.body.append(panel);
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('input', e => { if (e.target.matches('[data-msg-search]')) filterList(e.target.value); });
  panel.addEventListener('keydown', e => { if (e.target.matches('[data-msg-text]') && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); } });
  panel.addEventListener('submit', onSend);
  return panel;
}
function filterList(text) {
  const q = text.trim().toLowerCase();
  for (const row of panel.querySelectorAll('[data-msg-person]')) row.hidden = !!q && !row.dataset.search.includes(q);
}
async function showList() {
  const { esc } = ctx; openWith = null;
  const data = await ctx.api('/messages'); unread = data.unread; paintCount();
  panel.innerHTML = `<header class="msg-head"><strong>Messages</strong><button class="small icon-button" data-msg-close aria-label="Close messages">✕</button></header>
    <div class="msg-search"><input type="search" data-msg-search placeholder="Search people" aria-label="Search people"></div>
    <div class="msg-list">${data.contacts.length ? data.contacts.map(c => `<button class="msg-person${c.unread ? ' unread' : ''}" data-msg-person="${esc(c.id)}" data-search="${esc(`${c.name} ${c.username} ${c.role}`.toLowerCase())}">
      <span class="msg-avatar" aria-hidden="true">${esc((c.name.match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase())}</span>
      <span class="msg-who"><strong>${esc(c.name)}</strong><small>${c.last ? `${c.last.mine ? 'You: ' : ''}${esc(c.last.body)}` : esc(c.role)}</small></span>
      <span class="msg-meta">${c.last ? `<small>${esc(time(c.last.at))}</small>` : ''}${c.unread ? `<span class="msg-unread">${c.unread}</span>` : ''}</span></button>`).join('') : '<p class="muted msg-empty">No other users yet.</p>'}</div>`;
}
async function showConversation(id, { keepDraft = false } = {}) {
  const { esc } = ctx; openWith = id;
  const draft = keepDraft ? panel.querySelector('[data-msg-text]')?.value || '' : '';
  const data = await ctx.api(`/messages/${id}`);
  if (openWith !== id) return;
  let day = '';
  const bubbles = data.messages.map(m => {
    const d = new Date(m.at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' });
    const sep = d !== day ? `<p class="msg-day">${esc(d)}</p>` : ''; day = d;
    return `${sep}<div class="msg-bubble ${m.mine ? 'mine' : 'theirs'}"><p>${esc(m.body)}</p><small>${esc(new Date(m.at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }))}${m.mine && m.read ? ' · Seen' : ''}</small></div>`;
  }).join('');
  panel.innerHTML = `<header class="msg-head"><button class="small icon-button" data-msg-back aria-label="Back to people">←</button><span class="msg-title"><strong>${esc(data.contact.name)}</strong><small>${esc(data.contact.role)}</small></span><button class="small icon-button" data-msg-close aria-label="Close messages">✕</button></header>
    <div class="msg-thread" data-msg-thread>${bubbles || '<p class="muted msg-empty">No messages yet. Say hello!</p>'}</div>
    <form class="msg-compose"><textarea data-msg-text rows="2" maxlength="2000" placeholder="Write a message… (Enter to send, Shift+Enter for a new line)" aria-label="Message"></textarea><button class="primary" data-msg-send>Send</button></form>`;
  const box = panel.querySelector('[data-msg-text]'); box.value = draft; box.focus();
  const thread = panel.querySelector('[data-msg-thread]'); thread.scrollTop = thread.scrollHeight;
  await refreshCount();
}
async function onPanelClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.hasAttribute('data-msg-close')) close();
    else if (b.hasAttribute('data-msg-back')) await showList();
    else if (b.dataset.msgPerson) await showConversation(b.dataset.msgPerson);
  } catch (error) { ctx.toast(error.message); }
}
async function onSend(e) {
  e.preventDefault();
  const box = panel.querySelector('[data-msg-text]'), body = box.value.trim(), id = openWith;
  if (!body || !id) return;
  const button = panel.querySelector('[data-msg-send]'); button.disabled = true;
  try { await ctx.api(`/messages/${id}`, { body }); box.value = ''; await showConversation(id); }
  catch (error) { ctx.toast(error.message); }
  finally { const again = panel.querySelector('[data-msg-send]'); if (again) again.disabled = false; }
}
function close() { if (panel) { panel.hidden = true; panel.innerHTML = ''; } openWith = null; }
async function refreshCount() { try { unread = (await ctx.api('/messages/unread')).unread; paintCount(); } catch { /* signed out or offline */ } }

export function initMessages(context) {
  ctx = context;
  document.addEventListener('click', async e => {
    if (!e.target.closest('[data-msg-open]')) return;
    e.preventDefault(); e.stopPropagation();
    ensurePanel();
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    try { await showList(); panel.querySelector('[data-msg-search]')?.focus(); } catch (error) { ctx.toast(error.message); close(); }
  }, true);
  // Page redraws recreate the 💬 button: keep its unread number.
  new MutationObserver(() => { if (document.querySelector('[data-msg-count]')) paintCount(); }).observe(document.querySelector('#app'), { childList: true, subtree: false });
}
// Something arrived (live event): update the number and whatever the panel shows.
export async function messagesChanged() {
  if (loading || !ctx) return; loading = true;
  try {
    if (panel && !panel.hidden && openWith) await showConversation(openWith, { keepDraft: true });
    else if (panel && !panel.hidden) await showList();
    else await refreshCount();
  } catch { /* the next event retries */ } finally { loading = false; }
}
export const messagesSignedIn = () => refreshCount();
export function messagesSignedOut() { close(); unread = 0; paintCount(); }
