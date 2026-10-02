// Sign-in welcome: the dragon mascot (unaltered brand artwork) shaking hands with an employee,
// plus a short company-culture summary. Animation lives in theme.css (CSP blocks inline styles).
// The GDS dragon mascots shaking hands: brand artwork supplied by GDS, used unaltered.
// Motion (rise in, handshake bob, nod, idle float) is in theme.css; CSP blocks inline styles.
export function welcomeScene() {
  return `<figure class="welcome-scene">
    <img class="welcome-handshake" src="/welcome-handshake.webp" width="1405" height="991" alt="Two GDS dragon mascots, one in a suit and one in the GDS red polo, shaking hands in welcome" decoding="async">
  </figure>`;
}

// Brief, scannable version of "Our Culture" (full statement appears after sign-in).
const VALUES = [
  ['Candor & Clarity', 'Honest and direct, no half-truths.'],
  ['Do What We Say', 'We commit carefully, then deliver.'],
  ['Diversity & Inclusion', 'Every voice belongs here.'],
  ['Dare for Excellence', 'Smart risks, highest standards.'],
  ['Seek Truth, Stay Practical', 'Real value, not noise.'],
  ['Grow Together', 'We succeed when our people do.'],
];

export function welcomeCulture() {
  return `<div class="welcome-culture">
    <p class="welcome-motto">“Build on Trust, Backed by Expertise”</p>
    <ul>${VALUES.map(([name, line]) => `<li><strong>${name}</strong><span>${line}</span></li>`).join('')}</ul>
  </div>`;
}
