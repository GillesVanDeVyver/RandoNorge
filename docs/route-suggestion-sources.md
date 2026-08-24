# Suggested routes — where the route data can come from

Research note, 2026-08-22. Companion to `docs/DATA_LICENSES.md` and
`docs/parking-data-sources.md`: the same three questions asked of a new dataset
(does it permit commercial use, what attribution, what service policy), plus the
two that decide whether the feature is worth building — does the data actually
contain the routes Fjellrute's users want, and does taking it change Fjellrute's
licence posture.

The question that prompted it: **can we take routes from ut.no and ship them as
suggested routes, the way ut.no does?** The short answer is no, and the useful
part of this document is not the no but what sits behind it — because the route
*geometry* for a large share of what ut.no shows is available elsewhere as open
data, and what is not available is exactly the part that makes ut.no ut.no.

`docs/parking-data-sources.md` §6 already reached the same conclusion from the
other direction, when Nasjonal Turbase was evaluated as a parking source and
rejected as "avoid until the licence is in writing." Nothing found since changes
that. This document extends it from parking to routes and prices the alternative.

**Verification status.** UT.no's *brukervilkår* and the Nasjonal Turbase licence
page could not be read directly on 2026-08-22 — hjelp.ut.no returned HTTP 403 to
the tooling available here — so the characterisation of both below is carried
forward from `parking-data-sources.md` §6, which read them on 2026-08-20, plus
search-index summaries. **Both should be re-read by hand and quoted verbatim into
this document before any decision is acted on**, because the whole argument turns
on their exact wording. Everything stated about Turrutebasen was read from
Geonorge's own metadata record and product sheet on 2026-08-22 and is marked
where it is inference rather than a quoted field.

Not legal advice. The database-right question in particular is one for a
Norwegian IP lawyer, and this document exists to make that conversation short and
specific rather than to substitute for it.

---

## 1. Why ut.no is closed, in two layers that disagree with each other

The two layers have to be kept apart, because conflating them is how a project
talks itself into a bad decision.

**The website.** UT.no's *brukervilkår*, covering "UT.no og tilhørende
tjenester," say content is for personal use, that commercial use is not
permitted, and that automated collection of content for commercial use is
prohibited. Fjellrute is a commercial service — that is the first line of
`DATA_LICENSES.md` and the whole premise of `Pricing-and-Tier-Plan.md`. Scraping
turforslag off ut.no and shipping them is therefore a breach of those terms on
its face, and it is a breach committed by a direct competitor, which is the worst
available posture for arguing about it later.

**The database underneath.** Nasjonal Turbase (NTB) is DNT's platform for
collecting and publishing friluftsliv data, and its own documentation states that
the data licence for all data types was changed to Creative Commons 4.0 and that
the data is freely available for reuse in other applications and services.

Those two statements cannot both govern the same bytes for a paying product, and
the contradiction is not resolvable by picking the one we prefer. Two further
facts close the gap in the unhelpful direction:

- A CC licence on NTB data would not license the ut.no *website*. It would
  license data obtained *from NTB*. Harvesting the front end is a different act
  with a different counterparty, and the ToS above is the contract that governs
  it.
- **NTB has since closed open access to the data**, citing changes to its
  technical systems. So the route the CC statement implied is not simply standing
  open to be walked through. (Verification status: this is from a search-index
  summary of the NTB help article, not from the article read directly — confirm
  before relying on it, and note that "closed" may mean "now requires an
  application" rather than "gone.")

The practical read: the only version of "get DNT data" that is safe is a written
statement from DNT naming Fjellrute as a commercial service, filed the way the
pending Kartverket tile-cache request is filed in `DATA_LICENSES.md` §1. Not a
forum post, not a help-centre paragraph, not an inference from a licence badge.

## 2. What is actually protected, which is not what people assume

Worth being precise, because the intuitive model ("a GPS track is just facts, so
it's free") is right about copyright and wrong about the thing that would
actually be enforced.

**Geometry, as copyright.** A route as an ordered list of coordinates has thin
copyright at best. A single polyline is close to unprotectable as an original
work. This is the part of the intuition that holds, and it is not where the
exposure is.

**Geometry, as database right.** Norway implements the EEA *sui generis* database
right (katalogvernet, åndsverkloven), which protects substantial extraction from
a database **regardless of whether any individual record is original**, where the
maker has made a substantial investment in obtaining, verifying or presenting the
contents. DNT's investment in NTB is not in dispute. Ingesting thousands of
turforslag is unambiguously substantial extraction, and the OSMF's own
substantiality guideline — cited in `parking-data-sources.md` for the parking
case — draws its line at roughly a hundred features, with repeated small
extractions aggregating. This is the real exposure and it does not care that a
polyline is not creative.

**The editorial layer.** Titles, route descriptions, difficulty write-ups, season
notes and photographs are plainly copyrighted works. They are also the entire
reason a turforslag is worth more than a line on a map. Copying them is not a
close question.

**Third-party rights, which limit even DNT.** Turforslag on ut.no are contributed
by member associations and by individual users under ut.no's own publishing
terms. DNT's ability to sublicense that content onward to a commercial third
party is bounded by what those contributors granted it. So even a friendly DNT
may not be *able* to give blanket permission over the editorial layer, however
willing. Any written agreement should say explicitly which content it covers.

**What is not infringement.** Linking out to an ut.no turforslag is not copying.
A pin on the map with a name and an outbound link is a different legal act from
ingesting the record. Thin, but free, and worth keeping in the design space —
see §5.

## 3. The candidates

| Source | Licence | Commercial | Coverage | Has editorial content? | Delivery |
| --- | --- | --- | --- | --- | --- |
| **Turrutebasen** (Kartverket, Nasjonal database for tur- og friluftsruter) | Åpne data; see §4 caveat | Yes | Landsdekkende, marked routes only | No — geometry + admin attributes | Geonorge download (incl. **GPX**), WMS, Atom |
| Nasjonal Turbase (DNT) | Contradictory; open access closed | **Unclear → treat as no** | Good, incl. editorial | Yes | API, access now restricted |
| ut.no (the website) | Personal, non-commercial | **No** | Best | Yes | Scraping only — do not |
| OpenStreetMap routes/paths | ODbL 1.0 (share-alike) | Yes, with share-alike | Very good for stier | Partial (names, sac_scale) | Geofabrik extract |
| Fjellrute users' own public tours | Ours, under our ToS | Yes | Zero today, grows | Yes, if we ask for it | Already built |

### Turrutebasen — the one that is actually open

Kartverket's Nasjonal database for tur- og friluftsruter is a *landsdekkende*
dataset of fotruter, skiløyper, sykkelruter, andre ruter and tilretteleggingstiltak
i friluftslivsområder. Owner is Kartverket (Grunndataavdelingen). Updated
**weekly**. Distributed through Geonorge as FGDB, GML, **GPX**, PostGIS and SOSI,
with a WMS at `https://wms.geonorge.no/skwms1/wms.friluftsruter2` and Atom feeds
per format.

GPX as a first-class distribution format matters more than it sounds: Fjellrute
already has GPX import (`packages/core/src/routes/`), so the ingest path for evaluation is
hours, not days.

Data capture is largely *innmeldinger* from lag, foreninger og privatpersoner via
Kartverket's "Rett i kartet" service, then controlled and assessed manually
against FKB and N50. So it is crowd-sourced at the edge but curated by the
mapping authority — a materially different risk profile from raw OSM, and one
that sits much closer to the "all our other sources are official" tone the
parking note worried about losing.

**Critically, DNT is one of the natural upstream contributors.** DNT's local
associations mark roughly 22,000 km of summer routes and 4,300 km of winter
routes, and DNT is named as a data source for the national database alongside
kommuner and fylker. If that network is in fact delivered into Turrutebasen, then
**a large share of the route geometry visible on ut.no is available to us as open
data, from Kartverket, with no DNT conversation at all.** That is the single most
important claim in this document and it is exactly the one that has not been
measured — see the gate in §4.

**The structural limitation, and it lands directly on our core audience.** The
product sheet defines a *rute* as something that "skal være merket/skiltet og ha
et forvaltningsregime" — marked or signposted, with someone responsible for it. A
topptur line up a north face is none of those things. Turrutebasen's *skiløyper*
are prepared and marked winter trails, not ski-touring ascents. So the dataset is
likely strong for summer hiking suggestions and for the DNT hut-to-hut network,
and likely close to empty for the topptur audience that
`Fjellrute-vs-UTno-Deep-Dive.md` identifies as the FATMAP-shaped gap and the
reason the product exists.

That is not a reason to skip it. It is a reason to be honest that "suggested
routes from Turrutebasen" is a *summer* feature and a *DNT-network* feature, and
to stop expecting it to serve the winter proposition.

### OpenStreetMap — same trade as parking, already analysed

Norwegian *stier* are well mapped in OSM, often with `sac_scale`, `trail_visibility`
and names. The licence analysis is already done in `parking-data-sources.md` and
the conclusions transfer without change: ODbL share-alike, a national extract is
unambiguously substantial, the Horizontal Map Layers guideline means mixing OSM
routes with non-OSM routes for the same feature type pulls everything into
share-alike, and the `source` discriminator has to be a *partition* rather than a
blend.

One thing does **not** transfer and it is the important one. For parking, the
share-alike obligation landed on a table with no commercial value. For routes, it
would land on the feature type closest to Fjellrute's actual product. A published
ODbL derivative database of routes is a much bigger giveaway than a published
list of car parks, and if user-submitted routes ever share that feature type, the
guideline reaches them too. **Do not put OSM routes and Turrutebasen routes in
the same feature type.** If OSM routes are ever wanted, they need their own
regional partition, decided deliberately.

### Users' own tours — the one nobody else can copy

Fjellrute already has public shareable tour links with profiles. Routes drawn by
our own users, published under our own ToS, are the only route corpus that is
unambiguously ours to surface, grows with usage rather than costing money, and
cannot be replicated by ut.no. The cost is that it is empty on day one, which
makes it a compounding asset rather than a launch feature.

If this is wanted, the ToS change that permits surfacing a user's public tour as
a suggestion is cheap to make *now* and awkward to make later. Note the
`TERMS_VERSION` judgement recorded at the foot of `DATA_LICENSES.md`: this one is
a genuine change to what the user is agreeing to, not a disclosure, so it *would*
require a version bump and a re-acceptance pass. Better bundled with the next
substantive ToS change than done alone.

## 4. The licence field says something slightly different from what we assumed

`parking-data-sources.md` §5 refers to Turrutebasen as "CC BY 4.0 via Geonorge."
Read directly on 2026-08-22, the Geonorge metadata record does **not** name CC BY
4.0. It carries:

- `AccessConstraints`: "Åpne data"
- `UseConstraints`: "Lisens"
- `UseConstraintsText`: "Åpne data. Datafangsten baserer seg stort sett på
  innmeldinger fra lag, foreninger og privatpersoner via karttjenesten 'Rett i
  kartet'."
- `OtherConstraintsLink`:
  `http://inspire.ec.europa.eu/metadata-codelist/ConditionsApplyingToAccessAndUse/noConditionsApply`

INSPIRE's `noConditionsApply` is *more* permissive than CC BY 4.0, not less, and
Kartverket's general terms of use are CC BY 4.0 — so the practical answer is
almost certainly "open, commercial use fine, credit © Kartverket," which is a
posture Fjellrute already holds and already displays in four surfaces. But the
metadata record is internally a little loose (`UseConstraints: Lisens` without
naming one, alongside `noConditionsApply`), and the correction belongs on record
rather than being smoothed over: **we inferred CC BY 4.0 from Kartverket's
site-wide terms; the dataset's own metadata says open data with no conditions.**
Either way commercial use is permitted. Attribution should be given regardless,
because it costs one string and it is what the general terms ask for.

Fix `parking-data-sources.md` §5's parenthetical when this is confirmed.

## 5. The gate: a coverage test, before any code

Same shape as the parking gate, and for the same reason — the tempting reading
(Turrutebasen has the DNT network, so it replaces ut.no's geometry) is a
hypothesis, and three spot checks would not settle it.

Download the Turrutebasen GPX/FGDB extract for two contrasting fylker — one
DNT-dense (Innlandet, for Jotunheimen and Rondane) and one topptur-dense
(Troms, for Lyngen, or Møre og Romsdal for Sunnmørsalpene). Then ask, for a list
of 25–30 named tours a Fjellrute user would plausibly plan:

1. **Summer, DNT network.** Take 15 well-known ut.no turforslag on marked routes
   — Besseggen, Romsdalseggen, Trolltunga, the Jotunheimen hut-to-hut legs. Is
   there a Turrutebasen route within tolerance of each? This measures the claim
   in §3 and it is the whole reason to build the feature.
2. **Winter, topptur.** Take 15 classic toppturer — Store Blåmann, Blåbærfjellet,
   Slogen, Kolåstinden, Storebjørn. Is there anything at all? Expect close to
   zero; the value of running it is that "close to zero" is then a measured fact
   rather than my guess, and it decides whether suggested routes ship as a
   summer-only feature.
3. **Attribute completeness on the hits.** Turrutebasen carries at minimum
   `rutetype`, registreringsdato and vedlikeholdsansvarlig. Whether it carries a
   route *name*, a *gradering* (difficulty), season or `merking` status per
   feature was **not verified** — the current product specification PDF was not
   read. This matters a great deal: N50 parking failed partly because 259 objects
   had no name between them, and a suggested route with no name is not a
   suggestion. Read the objektkatalog, then count non-null names and graderinger
   on the hits from (1).

Two numbers come out: how much of ut.no's *geometry* Turrutebasen gives us for
free, and whether the records are rich enough to present without writing our own
copy for every one. Budget half a day, same as the parking gate. The result
belongs in this document.

## 6. What "suggested routes" should probably mean for Fjellrute

Worth separating the legal answer from the product answer, because the product
answer is the more interesting one and it survives even if the gate fails.

Copying ut.no's model means competing with DNT at the thing DNT is best at:
editorially-vetted turforslag backed by an institution, a hut network, and
decades of volunteer marking. `Fjellrute-vs-UTno-Deep-Dive.md` §2 already
concluded that is their moat and not replicable by a solo developer. Shipping a
thinner version of their own feature, built out of their own data, would be
strategically weak even if it were legal.

The differentiation that document identifies is that Fjellrute measures data
*along the drawn line* — runout severity per point, snow depth, weather, the
Varsom bulletin, all pinned to the elevation profile. That machinery does not
care whether the line was drawn by a user or loaded from a file. So the version
of "suggested routes" that plays to the existing strength is: **take open
geometry, run it through the analysis we already have, and let the computed brief
be the description.** "1,240 m ascent, 38 minutes above 30°, two medium-runout
crossings at km 3.1 and km 4.4, snow depth 140 cm at the top" is not something
ut.no can write, it requires no editorial labour, it regenerates itself when
conditions change, and it is a better reason to pick a tour in winter than a
paragraph of prose. It also turns the seasonality problem around: a suggestion
whose text is a live snow-and-avalanche brief has a reason to be re-read every
week.

That framing also means the gate's likely failure on toppturer matters less than
it first appears. If Turrutebasen has the summer network and nothing in Lyngen,
the honest product is Turrutebasen-backed suggestions for summer plus
user-contributed toppturer for winter — and the winter corpus is exactly the one
worth owning.

## 7. Recommendation

Do not take anything from ut.no. Not the geometry, not the descriptions, not by
scraping and not by API without a signed statement. The legal exposure is the
database right rather than copyright, it is real, and the reputational exposure
is worse: the launch audience in
`Fjellrute-Launch-Plan.md` is small Norwegian Facebook groups where a DNT
complaint would become the story about the product.

Evaluate Turrutebasen against the gate in §5 before writing any code. It is open,
commercial-use-clear, national, weekly, ships GPX, and requires no new legal
conversation with anyone.

Leave Nasjonal Turbase alone unless the gate shows Turrutebasen missing something
specific and valuable that only DNT has. If it does, open the conversation
properly — written, naming Fjellrute as a commercial service, and explicit about
whether it covers the editorial layer as well as the geometry, given the
third-party contributor limit in §2.

Keep OSM routes out of the same feature type as anything else, permanently.

## 8. Open action items

Re-read UT.no's brukervilkår and the NTB licence article by hand and quote the
operative clauses verbatim into §1. The 403 above means this document currently
argues from a two-day-old secondhand reading of the two texts the whole argument
rests on.

Confirm whether NTB open access is closed, restricted, or merely
re-registration-gated, and record the date.

Run the §5 coverage gate. Nothing else here should be acted on first.

Read the current Tur- og friluftsruter produktspesifikasjon and objektkatalog and
record the actual attribute list — specifically whether `rutenavn` and a
difficulty `gradering` exist per feature.

Correct the "CC BY 4.0 via Geonorge" parenthetical in
`parking-data-sources.md` §5 per §4 above.

Get a Norwegian IP lawyer's view on the database right before any third-party
route ingest ships, and put the question narrowly: does substantial extraction
from NTB expose a Norwegian commercial service under katalogvernet, and does it
matter that the extraction is via a public website rather than an API. The OSMF
answers ODbL questions free at legal-questions@osmfoundation.org, but there is no
equivalent free desk for this one.

Decide whether public user tours should be surfacable as suggestions, and if so
fold the ToS change into the next `TERMS_VERSION` bump rather than paying for a
re-acceptance pass on its own.

## Sources

- UT.no brukervilkår (non-commercial clause): https://hjelp.ut.no/hc/no/articles/360003958100-Brukervilk%C3%A5r-for-UT-no-og-tilh%C3%B8rende-tjenester
- Om Nasjonal Turbase (NTB), licence statement: https://hjelp.ut.no/hc/no/articles/360011064359-Om-Nasjonal-Turbase-NTB
- Nasjonal Turbase: http://www.nasjonalturbase.no/
- NTB developer portal: https://developer.nasjonalturbase.no/
- Turrutebasen dataset, Geonorge register: https://register.geonorge.no/det-offentlige-kartgrunnlaget/tur-og-friluftsruter/d1422d17-6d95-4ef1-96ab-8af31744dd63
- Turrutebasen metadata record (constraints fields quoted in §4): https://kartkatalog.geonorge.no/metadata/tur-og-friluftsruter/d1422d17-6d95-4ef1-96ab-8af31744dd63
- Produktark, Nasjonal database for tur- og friluftsruter: https://register.geonorge.no/data/documents/Produktark_Nasjonal%20database%20for%20tur-%20og%20friluftsruter_v1_produktark-nasjonal-database-for-tur-og-friluftsruter_.pdf
- Tur- og friluftsruter produktspesifikasjoner: https://register.geonorge.no/register/versjoner/produktspesifikasjoner/kartverket/tur-og-friluftsruter
- Rett i kartet, tur- og friluftsruter: https://www.rettikartet.no/turogfriluftsruter.html
- Kartverket friluftsliv data: https://www.kartverket.no/en/api-and-data/friluftsliv
- Kartverket terms of use: https://www.kartverket.no/api-og-data/vilkar-for-bruk
- ODbL substantiality guideline: https://osmfoundation.org/wiki/Licence/Community_Guidelines/Substantial_-_Guideline
- Horizontal Map Layers guideline: https://osmfoundation.org/wiki/Licence/Community_Guidelines/Horizontal_Map_Layers_-_Guideline
