// Offline-maps testing helper — DEV ONLY.
//
// There's no service worker, so you can't just reload the page offline. This
// panel lets you toggle a *simulated* offline mode that only affects map tiles:
// downloaded areas keep rendering from IndexedDB while everything uncached
// blanks out, exactly like being out of coverage — without cutting real
// network (weather, elevation, geocoding keep working) and without DevTools.
//
// Loaded conditionally from main.tsx: only in dev mode with ?offline in the
// URL. Never include this module in a production build.
//
// Toggle with the panel button or the keyboard shortcut Shift+O.

import { setForcedOffline } from '../offline/networkMode';
import { getRegions } from '../offline/db';

let offline = false;

// ---------------------------------------------------------------------------
// Panel UI (bottom-right, to clear the GPS simulator's bottom-left panel)
// ---------------------------------------------------------------------------

const panel = document.createElement('div');
panel.style.cssText = [
  'position:fixed', 'bottom:12px', 'right:12px', 'z-index:99999',
  'width:260px', 'background:#1e242b', 'color:#e8eaed',
  'border-radius:10px', 'box-shadow:0 4px 18px rgba(0,0,0,.45)',
  'font:12px/1.4 system-ui,sans-serif', 'overflow:hidden',
].join(';');

panel.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#2a323b">
    <strong style="flex:1">Offline Simulator</strong>
    <span id="off-dot" style="width:10px;height:10px;border-radius:50%;background:#2ecc71"></span>
  </div>
  <div style="padding:10px;display:flex;flex-direction:column;gap:8px">
    <button id="off-toggle">Go offline (Shift+O)</button>
    <div id="off-status" style="color:#9aa0a6">Online — tiles load from network.</div>
    <div id="off-regions" style="color:#9aa0a6"></div>
  </div>
`;
document.body.appendChild(panel);

const $ = <T extends HTMLElement>(id: string) =>
  panel.querySelector<T>(`#${id}`)!;

const toggleBtn = $<HTMLButtonElement>('off-toggle');
const statusEl = $('off-status');
const dot = $('off-dot');
const regionsEl = $('off-regions');

toggleBtn.style.cssText +=
  ';background:#3b4552;color:#e8eaed;border:none;border-radius:6px;padding:6px 8px;cursor:pointer;font:inherit';

function render() {
  setForcedOffline(offline);
  dot.style.background = offline ? '#e5484d' : '#2ecc71';
  toggleBtn.textContent = offline
    ? 'Go online (Shift+O)'
    : 'Go offline (Shift+O)';
  statusEl.textContent = offline
    ? 'Offline — downloaded areas stay in colour; the rest turns black & white.'
    : 'Online — tiles load from network.';
}

function toggle() {
  offline = !offline;
  render();
}

toggleBtn.addEventListener('click', toggle);

window.addEventListener('keydown', (e) => {
  // Shift+O, ignoring key repeats and typing in inputs.
  if (
    e.shiftKey &&
    (e.key === 'O' || e.key === 'o') &&
    !e.repeat &&
    !(e.target instanceof HTMLInputElement) &&
    !(e.target instanceof HTMLTextAreaElement)
  ) {
    e.preventDefault();
    toggle();
  }
});

// Show what's currently downloaded so it's obvious which areas should survive.
async function refreshRegions() {
  try {
    const regions = await getRegions();
    if (regions.length === 0) {
      regionsEl.textContent =
        'No areas downloaded yet — download one, then go offline.';
      return;
    }
    const bytes = regions.reduce((sum, r) => sum + r.bytes, 0);
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    regionsEl.textContent = `${regions.length} area(s) cached · ${mb} MB`;
  } catch {
    regionsEl.textContent = 'IndexedDB unavailable in this browser.';
  }
}
refreshRegions();
// Cheap poll so the count updates after a download without extra plumbing.
setInterval(refreshRegions, 3000);

// Start offline immediately if the URL asks for it (?offline=1 / ?offline=start).
const initial = new URLSearchParams(location.search).get('offline');
if (initial && initial !== '' && initial !== '0' && initial !== 'false') {
  offline = true;
}
render();

console.info(
  '[offline-simulator] Toggle simulated offline with the panel button or ' +
    'Shift+O. Only downloaded map tiles render while offline.',
);
