// A dropdown with a search box inside it, built over a normal <select data-searchable>. The select stays in the form
// (hidden) and keeps the value, so forms submit as before. The list shows the select's options and group headings; the
// search box sits below the heading named in data-search-group (else at the top) and filters by name or value (ID).
// Keyboard: Enter picks the first match, Escape closes, arrow keys move through the visible options.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function enhanceSelect(select) {
  if (!select || select.dataset.enhanced) return;
  select.dataset.enhanced = '1';
  const group = select.dataset.searchGroup || '', placeholder = select.dataset.searchPlaceholder || 'Search name or ID';
  const box = document.createElement('div');
  box.className = 'ss';
  const search = `<input type="search" class="ss-search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off">`;
  const item = o => `<li role="option" class="ss-option" data-value="${esc(o.value)}" tabindex="-1" aria-selected="${o.selected}">${esc(o.textContent)}</li>`;
  let searchPlaced = false;
  const parts = [...select.children].map(child => {
    if (child.tagName !== 'OPTGROUP') return item(child);
    const here = !searchPlaced && child.label === group;
    if (here) searchPlaced = true;
    return `<li class="ss-group" role="presentation"><span>${esc(child.label)}</span>${here ? search : ''}</li>${[...child.children].map(item).join('')}`;
  });
  box.innerHTML = `<button type="button" class="ss-button" aria-haspopup="listbox" aria-expanded="false"></button>
    <div class="ss-panel" hidden>${searchPlaced ? '' : `<div class="ss-top">${search}</div>`}<ul class="ss-list" role="listbox">${parts.join('')}</ul><p class="ss-none" hidden>No match.</p></div>`;
  select.after(box);
  select.hidden = true;
  const button = box.querySelector('.ss-button'), panel = box.querySelector('.ss-panel'), input = box.querySelector('.ss-search');
  const options = () => [...box.querySelectorAll('.ss-option')], visible = () => options().filter(o => !o.hidden);
  const label = () => { button.textContent = select.selectedOptions[0]?.textContent || ''; };
  const open = () => { panel.hidden = false; button.setAttribute('aria-expanded', 'true'); input.value = ''; filter(); input.focus(); };
  const close = (focus = true) => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); if (focus) button.focus(); };
  const choose = value => {
    select.value = value; label(); close();
    options().forEach(o => o.setAttribute('aria-selected', String(o.dataset.value === value)));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  function filter() {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (const o of options()) o.hidden = words.length > 0 && !words.every(w => `${o.textContent} ${o.dataset.value}`.toLowerCase().includes(w));
    // A heading stays while any of its options shows; the one holding the search box always stays.
    for (const g of box.querySelectorAll('.ss-group')) {
      let next = g.nextElementSibling, any = false;
      while (next && !next.classList.contains('ss-group')) { if (!next.hidden) any = true; next = next.nextElementSibling; }
      g.hidden = !any && !g.contains(input);
    }
    box.querySelector('.ss-none').hidden = visible().length > 0;
  }
  label();
  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  input.addEventListener('input', filter);
  box.addEventListener('click', event => { const o = event.target.closest('.ss-option'); if (o) choose(o.dataset.value); });
  box.addEventListener('keydown', event => {
    const list = visible(), at = list.indexOf(document.activeElement);
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(); }
    else if (event.key === 'Enter' && !panel.hidden) { event.preventDefault(); const pick = at >= 0 ? list[at] : list.find(o => o.dataset.value) || list[0]; if (pick) choose(pick.dataset.value); }
    else if (event.key === 'ArrowDown' && !panel.hidden) { event.preventDefault(); list[Math.min(list.length - 1, at + 1)]?.focus(); }
    else if (event.key === 'ArrowUp' && !panel.hidden) { event.preventDefault(); (at <= 0 ? input : list[at - 1]).focus(); }
  });
  document.addEventListener('click', event => { if (!panel.hidden && !box.contains(event.target)) close(false); });
}

export function enhanceAll(root = document) {
  root.querySelectorAll('select[data-searchable]').forEach(enhanceSelect);
}
