# Kartverket — permission request for offline caching of topo tiles

Status: **draft, not yet sent.** Send from a SonoFit address to
`post@kartverket.no`. Until permission is granted, the offline downloader caps
topo tiles at z11 (`src/offline/layers.ts` → `topo.maxDownloadZoom = 11`), which
stays below the Geovekst-restricted z12–20 range, so the app is compliant in the
meantime. Raise the cap only once written permission is on file.

---

**To:** post@kartverket.no
**Subject:** Permission request — offline caching of topo WMTS tiles (z12–18) in a commercial hiking app

Hei,

Jeg utvikler en kommersiell tur- og skredplanleggingstjeneste for Norge
(arbeidstittel «Fjellrute»), og ønsker å avklare vilkårene for én bestemt bruk
av deres topografiske cache-/WMTS-tjeneste før vi lanserer.

(English below — please reply in whichever language is easiest for you.)

We use your topographic web-mercator tiles for live map display:

  https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png

Live display is already covered by the CC BY 4.0 terms and we show "© Kartverket"
in the map attribution throughout the app. Our question concerns a new
**offline** feature.

The feature lets an individual user select a map area and download its tiles into
that user's own device (the browser's local IndexedDB storage) so the map keeps
working with no mobile coverage in the mountains. This is a per-user, personal
offline cache for their own use — we do not build, host, mirror or redistribute a
tile store on our own servers, and the tiles are never shared between users or
served onward.

We understand from your terms of use
(https://www.kartverket.no/en/api-and-data/terms-of-use) that the topo cache/WMS
tiles at zoom levels 12–20 include Geovekst-cooperation data, and that copying
that data, as opposed to displaying it live, requires separate permission from
the licensees. Because of this we have, for now, limited the offline download to
zoom level 11 and below, so no Geovekst-restricted tiles are copied to disk. We
would like to offer offline detail down to about zoom 16, which is where the
feature is genuinely useful for on-the-trail navigation.

Could you please advise:

1. Whether per-user, client-side offline caching of the z12–18 topo tiles for a
   user's own personal use is permitted under the existing terms, or whether it
   requires separate permission or a service agreement.
2. If separate permission is needed, what the process is (including any Geovekst
   licensee contact) and whether there are conditions we should build in
   (attribution wording, cache-lifetime limits, volume expectations, etc.).
3. Whether a written confirmation or agreement is available that we can keep on
   file, since this is a commercial service.

For context on scale: downloads are user-initiated, one region at a time, fetched
at a low concurrency (six parallel requests), and we honour a per-layer zoom cap
so a single download cannot enumerate large tile volumes. We are happy to add any
throttling, attribution or reporting you require.

Attribution today: "© Kartverket" is shown in the live map attribution control
(2D and 3D) and in the app's in-app data-sources dialog and terms of service,
with a link to kartverket.no.

Thank you very much for your help — and for the excellent open map data.

Med vennlig hilsen,
Gilles
SonoFit
contact@fjellrute.no
