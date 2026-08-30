// MET Norway's sky symbols and the wind-direction arrow, for React Native.
//
// The phone's half of apps/web/src/components/WeatherIcons.tsx, and the only
// part of Phase 3 that is not a straight port — because the web's version is
// `<img src="/weather-icons/{code}.svg">` and React Native has no `img`, no
// path-relative URLs, and no SVG support in its own `Image`.
//
// WHERE THE ARTWORK COMES FROM. The 84 files under apps/web/public/, fetched
// over the network from the Worker that serves them, addressed through core's
// `apiUrl` exactly as the forecast itself is. They are NOT bundled into the
// app, and that was the choice with an argument on both sides:
//
//   Bundling means committing the set a second time (Metro cannot reach across
//   into apps/web/public, so they would have to be copied into apps/mobile/
//   assets/) and adding react-native-svg-transformer plus a Metro config to
//   turn .svg imports into components. Two copies of an asset set is the same
//   failure mode as two copies of a formatter, one directory further out, and
//   MET revises this artwork.
//
//   Fetching means the sky column is blank with no connection. That sounds
//   worse than it is: with no connection there is no forecast either, so the
//   column has nothing to sit beside. The rows that would lose their icon are
//   rows that do not exist.
//
// Offline tiles are Phase 5, and when there is a tile store on the phone this
// is the second thing that should go into it — 440 KB, downloaded once.
//
// WHY NOT SvgUri, which is react-native-svg's own component for exactly this.
// It fetches per mounted instance and caches nothing. A day of forecast is
// about twenty-four rows drawn from maybe five distinct symbols, so SvgUri
// would open twenty-four connections to fetch five documents, on a mobile
// connection, every time the user picks a different day. `SvgXml` plus the
// module-level cache below fetches each code once per app run. This is asset
// plumbing rather than logic — there is nothing here for apps/web to share —
// which is why it is allowed to live in apps/mobile under the plan's one rule.

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Path, SvgXml } from 'react-native-svg';
import { apiUrl } from '@fjellrute/core/net/base';

/**
 * Fetched symbol documents, keyed by MET symbol code.
 *
 * Module scope, so it survives every unmount and remount of the weather card —
 * which happens on every open and close of the sheet, since the sheet mounts
 * its children only while expanded. A cache scoped to the component would be
 * emptied precisely when it was about to be useful.
 *
 * Two maps rather than one, because "not fetched" and "being fetched" are
 * different answers and collapsing them is how twenty-four rows mounting in the
 * same frame each start their own request. A code that has already failed is
 * cached as `null`, so a symbol MET has and this app does not is asked for once
 * rather than on every render.
 */
const documents = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

function loadSymbol(code: string): Promise<string | null> {
  const cached = documents.get(code);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inFlight.get(code);
  if (existing) return existing;

  // `apiUrl` is what makes this work on a device at all: the path alone is what
  // the web uses and React Native's fetch rejects a URL with no host. The app
  // installs the Worker's origin at startup (src/auth/client.ts), and these
  // files are served by the same Worker as everything else.
  const request = fetch(apiUrl(`/weather-icons/${code}.svg`))
    .then((res) => (res.ok ? res.text() : null))
    .catch(() => null)
    .then((xml) => {
      documents.set(code, xml);
      inFlight.delete(code);
      return xml;
    });
  inFlight.set(code, request);
  return request;
}

interface SymbolProps {
  code: string | null;
  size?: number;
}

/**
 * One sky symbol, or a box of the right size where one would be.
 *
 * The placeholder is not a nicety. This sits in a row of fixed-width columns,
 * and a symbol that renders nothing at all lets the temperature slide left into
 * its space and then jump back when the document arrives — visible as the whole
 * table twitching while a day loads.
 */
export function WeatherSymbol({ code, size = 26 }: SymbolProps) {
  // STATE CARRIES THE CODE IT BELONGS TO, not just the document. The obvious
  // shape — a `string | null` of XML, cleared in the effect when `code` changes
  // — needs a synchronous `setXml(null)` in the effect body to avoid painting
  // yesterday's symbol against today's row, and a synchronous setState inside
  // an effect is a cascading render (react-hooks/set-state-in-effect flags it,
  // and it is right to). Pairing the document with its code means a stale one
  // is simply not selected below, so nothing has to be cleared and the effect
  // only ever writes from its own callback.
  //
  // Seeded from the cache so an already-fetched symbol paints on the first
  // frame. Without that, the second day the user opens flickers exactly like
  // the first, despite every byte of it already being in memory.
  const [loaded, setLoaded] = useState<{ code: string; xml: string } | null>(
    () => {
      const cached = code ? documents.get(code) : null;
      return code && cached ? { code, xml: cached } : null;
    },
  );

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    void loadSymbol(code).then((doc) => {
      // Picking another day while a symbol is in flight is ordinary, not an
      // edge case: the fetch resolves against a row that has been recycled.
      if (!cancelled && doc) setLoaded({ code, xml: doc });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const xml = code && loaded?.code === code ? loaded.xml : null;

  if (!xml) return <View style={{ width: size, height: size }} />;

  return (
    // width/height override the document's own attributes — these files carry a
    // viewBox and no intrinsic size, which is what lets one document serve both
    // the 26pt table icon and anything larger later.
    <SvgXml xml={xml} width={size} height={size} />
  );
}

/**
 * The wind-direction arrow, pointing right (east) at rest.
 *
 * A hand-written copy of the web's, and the one icon in this file that is not
 * fetched, because it is nine numbers rather than a document. Rotation is the
 * caller's job and the angle is core's `windArrowRotation` — the arithmetic
 * that turns MET's "wind is coming FROM" into "the arrow points where it is
 * going TO" is a genuine piece of logic and lives in weather/format.ts, shared
 * with the web and the printed briefing.
 */
export function WindArrowIcon({
  size = 14,
  color,
}: {
  size?: number;
  color: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3 12 H17 M13 7 L18 12 L13 17"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
