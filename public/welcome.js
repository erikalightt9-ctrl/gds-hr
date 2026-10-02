// Sign-in welcome: the dragon mascot (unaltered brand artwork) shaking hands with an employee,
// plus a short company-culture summary. Animation lives in theme.css (CSP blocks inline styles).
// The GDS dragon mascots shaking hands: brand artwork supplied by GDS, used unaltered.
// Motion (rise in, handshake bob, nod, idle float) is in theme.css; CSP blocks inline styles.
export function welcomeScene() {
  return `<figure class="welcome-scene">
    <img class="welcome-handshake" src="/welcome-handshake.webp" width="1405" height="991" alt="Two GDS dragon mascots, one in a suit and one in the GDS red polo, shaking hands in welcome" decoding="async">
  </figure>`;
}

// "Our Company Culture": one card per core value. Each card is a native <details> so it opens
// with a click, tap, Enter or Space without script; sharing a name keeps one value open at a time.
const ICON = {
  candor: '<path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M19 9h1a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v3l-4-3h-3"/>',
  promise: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
  people: '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="9" r="2"/><circle cx="19" cy="9" r="2"/><path d="M7 20v-2a5 5 0 0 1 10 0v2"/><path d="M2 20v-1a3 3 0 0 1 4-2.8"/><path d="M22 20v-1a3 3 0 0 0-4-2.8"/>',
  spark: '<path d="M9 3v4M9 15v4M3 11h4M11 11h4"/><path d="M9 7c0 2.2 1.8 4 4 4-2.2 0-4 1.8-4 4 0-2.2-1.8-4-4-4 2.2 0 4-1.8 4-4Z"/><path d="M18 3v3M16.5 4.5h3M18 15v3M16.5 16.5h3"/>',
  scales: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0Z"/><path d="m19 7-3 7a3 3 0 0 0 6 0Z"/>',
  growth: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
};
const VALUES = [
  ['candor', 'Candor & Clarity', 'We say what needs to be said honestly and directly. No half-truths, no silence.'],
  ['promise', 'Do What We Say', "We don't promise lightly, but once we commit, we deliver."],
  ['people', 'Diversity & Inclusion', 'We turn differences into collaborative strength. Every voice belongs here.'],
  ['spark', 'Dare for Excellence', 'We take intelligent risks for better results and hold ourselves to the highest standards.'],
  ['scales', 'Seek Truth, Stay Practical', "We focus on what's real and what creates genuine value, not noise."],
  ['growth', 'Grow Together', 'We succeed when our people, clients and partners succeed alongside us.'],
];
const icon = key => `<svg class="culture-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[key]}</svg>`;

export function welcomeCulture() {
  return `<section class="welcome-culture" aria-labelledby="culture-title">
    <p class="welcome-motto">“Build on Trust, Backed by Expertise”</p>
    <h2 id="culture-title" class="culture-title">Our Company Culture</h2>
    <p class="culture-hint">Select a value to read what it means at GDS.</p>
    <div class="culture-cards">${VALUES.map(([key, name, meaning]) => `<details class="culture-card" name="culture">
      <summary>${icon(key)}<span class="culture-name">${name}</span><span class="culture-chevron" aria-hidden="true"></span></summary>
      <p>${meaning}</p>
    </details>`).join('')}</div>
    <p class="culture-close">These values are not slogans on a wall. They live in every meeting, every decision, every moment when no one is watching.</p>
  </section>`;
}
