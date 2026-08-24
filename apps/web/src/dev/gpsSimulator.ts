// GPS movement simulator — DEV ONLY.
//
// Overrides navigator.geolocation with a fake implementation and shows a
// floating control panel with a mini-map. Draw a route by clicking on the
// mini-map (or load a GPX file), press play, and every watchPosition /
// getCurrentPosition consumer in the app (e.g. useTracking.ts) receives
// interpolated fixes as if the device were moving along the route.
//
// Loaded conditionally from main.tsx: only in dev mode with ?simulate in
// the URL. Never include this module in a production build.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type LatLng = [number, number];

// ---------------------------------------------------------------------------
// Geolocation override
// ---------------------------------------------------------------------------

const watchers = new Map<number, PositionCallback>();
const pendingGets: PositionCallback[] = [];
let nextWatchId = 1;
let lastFix: GeolocationPosition | null = null;

function makeFix(
  pos: LatLng,
  heading: number | null,
  speedMs: number | null,
): GeolocationPosition {
  const coords = {
    latitude: pos[0],
    longitude: pos[1],
    accuracy: 8,
    altitude: null,
    altitudeAccuracy: null,
    heading,
    speed: speedMs,
  } as GeolocationCoordinates;
  return {
    coords,
    timestamp: Date.now(),
    toJSON: () => ({ coords, timestamp: Date.now() }),
  } as GeolocationPosition;
}

function emitFix(fix: GeolocationPosition) {
  lastFix = fix;
  for (const cb of watchers.values()) cb(fix);
  while (pendingGets.length > 0) pendingGets.shift()!(fix);
}

const fakeGeolocation: Geolocation = {
  getCurrentPosition(success: PositionCallback) {
    if (lastFix) {
      const fix = lastFix;
      queueMicrotask(() => success(fix));
    } else {
      pendingGets.push(success);
    }
  },
  watchPosition(success: PositionCallback): number {
    const id = nextWatchId++;
    watchers.set(id, success);
    if (lastFix) {
      const fix = lastFix;
      queueMicrotask(() => {
        if (watchers.has(id)) success(fix);
      });
    }
    return id;
  },
  clearWatch(id: number) {
    watchers.delete(id);
  },
};

Object.defineProperty(navigator, 'geolocation', {
  value: fakeGeolocation,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Route + movement engine
// ---------------------------------------------------------------------------

const EARTH_RADIUS = 6371000;

function haversine(a: LatLng, b: LatLng): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

function bearing(a: LatLng, b: LatLng): number {
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x =
    Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

let route: LatLng[] = [];
let cumulative: number[] = []; // cumulative distance at each route point
let totalLength = 0;
let distanceAlong = 0;
let playing = false;
let speedKmh = 5;

function rebuildDistances() {
  cumulative = [0];
  for (let i = 1; i < route.length; i++) {
    cumulative.push(cumulative[i - 1] + haversine(route[i - 1], route[i]));
  }
  totalLength = cumulative[cumulative.length - 1] ?? 0;
}

function positionAt(dist: number): { pos: LatLng; heading: number | null } {
  if (route.length === 0) return { pos: [0, 0], heading: null };
  if (route.length === 1 || dist <= 0) {
    const h = route.length > 1 ? bearing(route[0], route[1]) : null;
    return { pos: route[0], heading: h };
  }
  if (dist >= totalLength) {
    return {
      pos: route[route.length - 1],
      heading: bearing(route[route.length - 2], route[route.length - 1]),
    };
  }
  let i = 1;
  while (cumulative[i] < dist) i++;
  const segLen = cumulative[i] - cumulative[i - 1];
  const t = segLen > 0 ? (dist - cumulative[i - 1]) / segLen : 0;
  const a = route[i - 1];
  const b = route[i];
  return {
    pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    heading: bearing(a, b),
  };
}

// ---------------------------------------------------------------------------
// Control panel UI
// ---------------------------------------------------------------------------

const panel = document.createElement('div');
panel.style.cssText = [
  'position:fixed', 'bottom:12px', 'left:12px', 'z-index:99999',
  'width:300px', 'background:#1e242b', 'color:#e8eaed',
  'border-radius:10px', 'box-shadow:0 4px 18px rgba(0,0,0,.45)',
  'font:12px/1.4 system-ui,sans-serif', 'overflow:hidden',
].join(';');

panel.innerHTML = `
  <div id="sim-header" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#2a323b;cursor:pointer">
    <strong style="flex:1">GPS Simulator</strong>
    <span id="sim-collapse" style="user-select:none">&#9660;</span>
  </div>
  <div id="sim-body">
    <div id="sim-map" style="height:220px;cursor:crosshair"></div>
    <div style="padding:8px 10px;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:6px">
        <button id="sim-play" style="flex:1">Play</button>
        <button id="sim-reset">Restart</button>
        <button id="sim-clear">Clear</button>
        <button id="sim-gpx">GPX</button>
        <input id="sim-file" type="file" accept=".gpx" style="display:none">
      </div>
      <label style="display:flex;align-items:center;gap:8px">
        Speed
        <input id="sim-speed" type="range" min="1" max="100" value="5" style="flex:1">
        <span id="sim-speed-label" style="min-width:52px;text-align:right">5 km/h</span>
      </label>
      <div id="sim-status" style="color:#9aa0a6">Click the map to draw a route.</div>
    </div>
  </div>
`;
document.body.appendChild(panel);

const $ = <T extends HTMLElement>(id: string) =>
  panel.querySelector<T>(`#${id}`)!;

const playBtn = $<HTMLButtonElement>('sim-play');
const statusEl = $('sim-status');
const speedLabel = $('sim-speed-label');

for (const btn of panel.querySelectorAll('button')) {
  btn.style.cssText +=
    ';background:#3b4552;color:#e8eaed;border:none;border-radius:6px;padding:5px 8px;cursor:pointer';
}

// Mini-map
const map = L.map($('sim-map'), { attributionControl: false }).setView(
  [61.5, 8.6],
  5,
);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
}).addTo(map);

const routeLine = L.polyline([], { color: '#4c8dff', weight: 3 }).addTo(map);
const waypointLayer = L.layerGroup().addTo(map);
const posMarker = L.circleMarker([0, 0], {
  radius: 7,
  color: '#fff',
  weight: 2,
  fillColor: '#e5484d',
  fillOpacity: 1,
}).addTo(map);
posMarker.setStyle({ opacity: 0, fillOpacity: 0 });

function redrawRoute() {
  routeLine.setLatLngs(route);
  waypointLayer.clearLayers();
  for (const p of route) {
    L.circleMarker(p, {
      radius: 3,
      color: '#4c8dff',
      fillColor: '#4c8dff',
      fillOpacity: 1,
    }).addTo(waypointLayer);
  }
}

function updateStatus() {
  if (route.length === 0) {
    statusEl.textContent = 'Click the map to draw a route.';
    return;
  }
  const { pos } = positionAt(distanceAlong);
  const pct = totalLength > 0 ? (distanceAlong / totalLength) * 100 : 0;
  statusEl.textContent =
    `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}  ·  ` +
    `${(distanceAlong / 1000).toFixed(2)} / ${(totalLength / 1000).toFixed(2)} km (${pct.toFixed(0)}%)`;
}

function emitCurrent() {
  if (route.length === 0) return;
  const { pos, heading } = positionAt(distanceAlong);
  posMarker.setLatLng(pos);
  posMarker.setStyle({ opacity: 1, fillOpacity: 1 });
  emitFix(makeFix(pos, heading, playing ? speedKmh / 3.6 : 0));
  updateStatus();
}

// Interactions
map.on('click', (e: L.LeafletMouseEvent) => {
  route.push([e.latlng.lat, e.latlng.lng]);
  rebuildDistances();
  redrawRoute();
  if (route.length === 1) emitCurrent();
  updateStatus();
});

playBtn.addEventListener('click', () => {
  if (route.length < 2) {
    statusEl.textContent = 'Need at least 2 points to move.';
    return;
  }
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  emitCurrent();
});

$('sim-reset').addEventListener('click', () => {
  distanceAlong = 0;
  emitCurrent();
});

$('sim-clear').addEventListener('click', () => {
  route = [];
  distanceAlong = 0;
  totalLength = 0;
  playing = false;
  playBtn.textContent = 'Play';
  redrawRoute();
  posMarker.setStyle({ opacity: 0, fillOpacity: 0 });
  updateStatus();
});

$<HTMLInputElement>('sim-speed').addEventListener('input', (e) => {
  speedKmh = Number((e.target as HTMLInputElement).value);
  speedLabel.textContent = `${speedKmh} km/h`;
});

$('sim-gpx').addEventListener('click', () => $<HTMLInputElement>('sim-file').click());

$<HTMLInputElement>('sim-file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const pts = doc.querySelectorAll('trkpt, rtept');
  const parsed: LatLng[] = [];
  for (const pt of pts) {
    const lat = Number(pt.getAttribute('lat'));
    const lon = Number(pt.getAttribute('lon'));
    if (Number.isFinite(lat) && Number.isFinite(lon)) parsed.push([lat, lon]);
  }
  if (parsed.length === 0) {
    statusEl.textContent = 'No track points found in GPX.';
    return;
  }
  route = parsed;
  distanceAlong = 0;
  rebuildDistances();
  redrawRoute();
  map.fitBounds(routeLine.getBounds(), { padding: [16, 16] });
  emitCurrent();
  (e.target as HTMLInputElement).value = '';
});

$('sim-header').addEventListener('click', () => {
  const body = $('sim-body');
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  $('sim-collapse').innerHTML = hidden ? '&#9660;' : '&#9650;';
  if (hidden) map.invalidateSize();
});

// ---------------------------------------------------------------------------
// Tick loop: emit a fix once per second, like a real GPS
// ---------------------------------------------------------------------------

let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  if (route.length === 0) return;
  if (playing) {
    distanceAlong += (speedKmh / 3.6) * dt;
    if (distanceAlong >= totalLength) {
      distanceAlong = totalLength;
      playing = false;
      playBtn.textContent = 'Play';
    }
  }
  emitCurrent();
}, 1000);

console.info(
  '[gps-simulator] navigator.geolocation is now simulated. ' +
    'Draw a route on the mini-map or load a GPX file, then press Play.',
);
