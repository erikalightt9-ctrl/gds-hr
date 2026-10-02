// "Our Culture" — the company values, shown to every signed-in account
// (staff Overview and the employee portal). Text is static, so no escaping is needed.
const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const VALUES = [
  ['Candor & Clarity', 'We say what needs to be said honestly and directly. No half-truths, no silence.',
    '<path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M19 9h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3h-3"/>'],
  ['Do What We Say', 'We don’t promise lightly, but once we commit, we deliver.',
    '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2"/><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a2 2 0 0 0-2.8 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a3.6 3.6 0 0 1 4.6-.4l.4.3a3 3 0 0 0 1.7.5H21"/><path d="M21 6v8h-2"/><path d="m3 13 6 6a1.4 1.4 0 0 0 2-2"/><path d="M3 6h7"/><path d="M3 6v8h2"/>'],
  ['Diversity & Inclusion', 'We turn differences into collaborative strength. Every voice belongs here.',
    '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="9" r="2.2"/><circle cx="19" cy="9" r="2.2"/><path d="M7 20v-2a5 5 0 0 1 10 0v2"/><path d="M1.5 19v-1a3.5 3.5 0 0 1 5-3.2"/><path d="M22.5 19v-1a3.5 3.5 0 0 0-5-3.2"/>'],
  ['Dare for Excellence', 'We take intelligent risks for better result and hold ourselves to the highest standards.',
    '<path d="M9.5 3 11 8.5 16.5 10 11 11.5 9.5 17 8 11.5 2.5 10 8 8.5Z"/><path d="M18 3v4M16 5h4"/><path d="M18.5 15v4M16.5 17h4"/>'],
  ['Seek Truth, Stay Practical', 'We focus on what’s real and what creates genuine value — not noise.',
    '<path d="M12 3v18M7 21h10"/><path d="M5 7h14"/><path d="m5 7-3 6a3 3 0 0 0 6 0Z"/><path d="m19 7-3 6a3 3 0 0 0 6 0Z"/>'],
  ['Grow Together', 'We succeed when our people, clients, and partners succeed alongside us.',
    '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>'],
];

export function cultureSection() {
  return `<section class="culture" aria-labelledby="culture-title">
    <header class="culture-banner">
      <span class="culture-eyebrow">Strength in stewardship</span>
      <p class="culture-motto">“Build on Trust, Backed by Expertise”</p>
    </header>
    <div class="culture-intro">
      <span class="culture-kicker">The foundation</span>
      <h2 id="culture-title">Our Culture</h2>
    </div>
    <ul class="culture-grid">
      ${VALUES.map(([name, text, paths]) => `<li class="culture-value"><span class="culture-icon">${icon(paths)}</span><h3>${name}</h3><p>${text}</p></li>`).join('')}
    </ul>
    <p class="culture-closing">These values are not slogans on a wall. They live in <em>every meeting, every decision,</em> every moment when <em>no one is watching.</em></p>
  </section>`;
}
