// Makes GDS HR installable as a home-screen app and offers the install once per month.
// Android/desktop Chrome get a one-tap Install button; iPhone Safari gets the Share → Add to Home Screen steps.
const DISMISS_KEY = 'gds-hr-install-dismissed';
const DISMISS_DAYS = 30;

const installed = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
function recentlyDismissed() {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_DAYS * 864e5; } catch { return false; }
}
function rememberDismissal() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage unavailable: the banner may show again */ }
}

function showBanner(message, action) {
  if (document.querySelector('.install-banner')) return;
  const banner = document.createElement('aside');
  banner.className = 'install-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Install the GDS HR app');
  banner.innerHTML = `<img src="/icons/icon-192.png" alt="" width="44" height="44"><div class="install-copy"><strong>Install GDS HR</strong><span>${message}</span></div>${action ? '<button class="primary small" data-install-now>Install</button>' : ''}<button class="small install-close" data-install-close aria-label="Not now">Not now</button>`;
  banner.addEventListener('click', async event => {
    if (event.target.closest('[data-install-close]')) { rememberDismissal(); banner.remove(); }
    if (event.target.closest('[data-install-now]') && action) { banner.remove(); await action(); }
  });
  document.body.append(banner);
}

let deferredPrompt = null, signedIn = false;
export function setupInstall() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(error => console.warn('GDS HR offline support unavailable:', error.message));
  }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; if (signedIn) offerInstall(); });
}
// Called once someone is signed in, so the prompt never covers the sign-in form.
export function offerInstall() {
  signedIn = true;
  if (installed() || recentlyDismissed()) return;
  if (deferredPrompt) {
    const prompt = deferredPrompt;
    showBanner('Open attendance, leave and payslips from your home screen.', async () => {
      prompt.prompt(); deferredPrompt = null;
      const choice = await prompt.userChoice;
      if (choice.outcome !== 'accepted') rememberDismissal();
    });
  } else if (isIos()) showBanner('Tap the Share button <span aria-hidden="true">⬆︎</span>, then <b>Add to Home Screen</b>.', null);
}
