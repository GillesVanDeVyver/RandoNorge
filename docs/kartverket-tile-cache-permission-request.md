# Kartverket — permission request for offline caching of topo tiles

Status: **a shortened Norwegian version of the letter below was sent
2026-07-21 from `Fjellrute@gmail.com`. No reply.** The follow-up at the end of
this file is the next thing to send. `docs/kartverket-permission-log.md` records
what went out and how it differed from this draft.

Until permission is granted, the offline downloader caps topo tiles at z11
(`packages/core/src/offline/layers.ts` → `topo.maxDownloadZoom = 11`), which
stays below the Geovekst-restricted z12–20 range, so the app is compliant in the
meantime. Raise the cap only once written permission is on file.

**This is Phase 0c of the mobile build plan, and it is the one item there with a
reply time nobody here controls.** Offline maps are both a headline mobile
feature and a premium-tier feature, and at a z11 cap they are close to worthless
for navigating a ski tour — so Phase 5 of that plan is blocked on the answer
below, not on any code. Send it before starting Phase 1; three weeks of waiting
should overlap the work, not follow it.

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
that user's own device — the browser's local IndexedDB storage in our web app,
and, in the mobile app we are now building, a local file on the phone read only
by that app. This is a per-user, personal offline cache for their own use — we do
not build, host, mirror or redistribute a tile store on our own servers, and the
tiles are never shared between users or served onward. The mobile app requests
each tile from your service exactly as the web app does; the only difference is
where the copy on that user's own device is kept.

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

---

## Follow-up — ready to send

Send as a reply on the original 2026-07-21 thread if that mailbox still has it,
so the history travels with it; otherwise as a new mail with the same subject
prefixed «Purring». Either way, send it from a `fjellrute.no` address and say
so, since the original went from a Gmail account. Then fill in
`docs/kartverket-permission-log.md`.

**To:** post@kartverket.no
**Subject:** Purring — tillatelse til offline-lagring av topografiske fliser (sone 12–18), henvendelse 21. juli 2026

Hei,

Jeg sendte henvendelsen nedenfor til post@kartverket.no 21. juli 2026, men har
ikke mottatt svar. Jeg purrer høflig, siden spørsmålet må avklares før lansering
og jeg ikke ønsker å bygge funksjonen på en antakelse. (Merk: den opprinnelige
henvendelsen ble sendt fra Fjellrute@gmail.com; denne adressen er vår
virksomhetsadresse, og svar kan gjerne gå hit.)

Kort om saken: vi bruker deres topografiske WMTS-fliser til live kartvisning i en
kommersiell tur- og skredplanleggingstjeneste, med «© Kartverket» i
kartattribusjonen. Vi ønsker å la den enkelte brukeren laste ned et selvvalgt
kartområde til sin egen enhet, slik at kartet virker uten mobildekning. Flisene
lagres kun lokalt hos brukeren, hentes fra tjenesten deres på samme måte som ved
live visning, og deles aldri mellom brukere eller videreformidles fra våre
servere.

**Vi har i dag begrenset nedlastingen til sone 11 og lavere**, altså under det
Geovekst-begrensede området sone 12–20, nettopp for å være innenfor vilkårene
mens vi venter på svar. Vi ønsker å tilby offline-detaljer ned til omtrent sone
16, som er der funksjonen blir reelt nyttig underveis på tur.

Jeg vil være takknemlig for svar på tre punkter:

1. Er offline-lagring hos den enkelte brukeren, til brukerens eget bruk, av
   topografiske fliser i sone 12–18 tillatt under gjeldende vilkår, eller krever
   det særskilt tillatelse eller egen avtale?
2. Dersom særskilt tillatelse er nødvendig: hva er fremgangsmåten, hvem hos
   Geovekst-lisensinnehaverne bør vi kontakte, og finnes det vilkår vi bør bygge
   inn fra starten — formulering av attribusjon, levetid for lokal cache,
   forventet volum?
3. Kan vi få en skriftlig bekreftelse eller avtale å ha på fil? Tjenesten er
   kommersiell, og vi trenger å kunne dokumentere grunnlaget.

Om omfanget: nedlasting starter alltid av brukeren, ett område om gangen, med
lav samtidighet (seks parallelle forespørsler) og et tak per kartlag, slik at én
nedlasting ikke kan hente store flisvolum. Vi legger gjerne inn ytterligere
begrensning, attribusjon eller rapportering dersom dere ønsker det.

Dersom denne henvendelsen hører til en annen avdeling, er jeg takknemlig om den
videreformidles — eller om dere gir meg riktig kontaktpunkt. Et saksnummer vil
også være nyttig for videre oppfølging.

Takk for hjelpen, og for de utmerkede åpne kartdataene.

Med vennlig hilsen,
Gilles Van De Vyver
SonoFit
contact@fjellrute.no

*(Original henvendelse av 21. juli 2026 følger nedenfor.)*
