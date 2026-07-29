# Fjellrute (RandoNorge) — Deep Dive: What it gives you that ut.no doesn't, and is it worth developing further

*Written 24 July 2026, from a full read of the codebase (`src/`, `worker/`, `migrations/`, `docs/`) and current research on ut.no. This is an engineering and product assessment, not financial or legal advice — the market and revenue figures are estimates you should pressure-test yourself.*

---

## 1. What Fjellrute actually is (from the code, not the pitch)

Fjellrute is a browser-based ski-touring and hiking route **planner and companion** for Norway, built as a React 19 / MapLibre + Leaflet single-page app on a Cloudflare Workers + D1 + R2 backend. It is not a prototype: it is roughly 22,700 lines of TypeScript/JS across ~90 source files, with real auth, a migrated database, edge-cached data proxies, a security review, a legal data-rights audit, and a written go-to-market plan. The engineering is unusually disciplined for a solo project — the runout classifier deliberately *fails safe* (a network error renders as "unknown", never as "safe terrain"), the API proxy is pinned to specific upstream paths so it can't be abused as an open relay, every DB query is parameterized with ownership enforced in SQL, and the whole thing is designed to run inside free tiers.

The core loop that matters: you draw a route directly on the official **Kartverket** topo map, and the app samples government open data *along the line you drew* and pins it to a synced elevation profile — steepness and avalanche runout zones (NVE `Bratthet_med_utlop_2024`), snow depth (seNorge/NVE), weather (MET `locationforecast`), and the Varsom avalanche bulletin for that spot. On top of that sits a genuine 3D terrain view (self-generated Terrarium tiles from Kartverket's national elevation model, with an AWS fallback), offline map packs stored in IndexedDB, live GPS recording with pace/plan-vs-actual review, GPX/TCX/FIT import and export, saved routes, public shareable tour links with profiles, full i18n (Norwegian/English), and a first-run safety disclaimer that points to varsom.no.

The strategic premise is explicit in the launch plan: **FATMAP is dead** (Strava shut it down), and nothing free fills the ski-touring-terrain-planning gap for Norway. Fjellrute aims to be that replacement.

---

## 2. What Fjellrute gives you that ut.no does not

First, an honest correction to the project's own older framing. ut.no has moved on: it *does* now let logged-in users draw their own route and see its length and elevation profile, and it *does* have a toggleable steepness + runout (bratthet/utløpssone) map layer. So "ut.no can't draw routes" and "ut.no has no steepness" are both out of date and should be dropped from the marketing — a knowledgeable topptur user will call it out.

The real, defensible differences are about **integration and depth**, not the existence of individual layers:

| Capability | Fjellrute | ut.no |
|---|---|---|
| Draw route on Kartverket topo | Yes (2D **and** 3D, freehand + eraser) | Yes (2D only, login required) |
| Elevation profile of your route | Yes | Yes |
| Steepness + runout layer | Yes (overlay) | Yes (overlay) |
| **Runout severity sampled *per point along your line*** and shown on the profile | **Yes** (short/medium/long runout classified at every route point, fail-safe) | No — layer is a visual overlay only |
| **Snow depth (seNorge) sampled along the route + as an overlay** | **Yes** | No |
| **Weather forecast (MET) tied to the route** | **Yes** | No (general weather only) |
| **Varsom avalanche bulletin pulled for the route location** | **Yes** | No (must check separately) |
| **3D terrain view** with all overlays draped | **Yes** (Kartverket NDH mesh) | No |
| Live GPS recording + pace + **plan-vs-actual** timeline | **Yes** | Partial (basic trip tracking; no plan-vs-actual scrub) |
| GPX **/ TCX / FIT** import and export | Yes (all three) | GPX-oriented |
| Works with **no app install**, in a mobile browser | Yes | App-first |
| Offline map packs | Yes (capped at z11 pending Kartverket permission) | Yes (app) |
| Public shareable tour link + profile, login-free viewing | Yes | Yes (trip suggestions) |

Where ut.no is clearly ahead and Fjellrute cannot easily match: the **curated content and institutional trust**. ut.no is DNT + NRK, with thousands of editorially-vetted turforslag, the cabin/lodge network, SjekkUT check-ins, protected-area guidance, and a household-name brand. That is its moat, and it is not something a solo dev replicates.

So the one-sentence answer to "what does Fjellrute give you that ut.no doesn't": **it turns the map layers ut.no shows you into data measured along your own drawn line — runout, snow depth, weather and the avalanche bulletin all pinned to your elevation profile — plus a real 3D terrain view, in a no-install web app.** ut.no shows you terrain; Fjellrute analyses *your route through* the terrain. That is the FATMAP-shaped gap, and Fjellrute fills it more completely than ut.no does.

---

## 3. Is it worth developing further?

My assessment: **yes, but conditionally, and the project's own launch plan already frames the condition correctly.** Here is the reasoning, kept honest about both sides.

**The case for continuing.** The three things that usually kill a side project are already handled: the product is *built* (not a someday-idea), the costs are ~150 kr/year (a domain — everything runs on free tiers, verified in `cost-and-limits.md`), and the legal/data footing is audited and commercial-use-clear (`DATA_LICENSES.md`). There is a real, dated demand event — the FATMAP shutdown left a specific, vocal Norwegian audience (topptur skiers) without a tool, and that community congregates in findable Facebook groups and forums, which makes zero-budget distribution actually plausible. The differentiation above is genuine and defensible on the "safety data along your route + 3D" axis. And because the downside is capped at pennies, the expected value of *launching* is strongly positive even if the expected value of *monetizing* is uncertain.

**The case for caution.** This is a seasonal, single-country, narrow niche. Ski touring in Norway is maybe low-hundreds-of-thousands of people, only some fraction plan digitally, and interest collapses May–October. ut.no closing its feature gap (it already added route drawing and the steepness layer) shows the incumbent is moving; if DNT adds snow-depth sampling, much of the differentiation narrows. The revenue math is thin by design — the plan's own viability gate targets ~300 weekly actives and hopes 1–2% convert at 300 kr/yr, which is a few hundred subscribers *at best* and realistically a hobby-scale income, not a business. Safety liability is a real, ongoing tail risk for any avalanche-adjacent tool (well-mitigated here with disclaimers and Varsom links, but never zero). And it is a solo project competing on breadth with an institution — sustainability depends entirely on one person's continued evenings.

**The synthesis.** Worth developing further as: (a) a genuinely useful free public tool that fills a real gap and costs almost nothing to run, and (b) a *test* of whether a premium tier can fund it — but **not** as a bet on meaningful income until the January 2027 viability gate produces evidence. The right posture is exactly the one already written down: ship the free version this season, measure real usage, and only build billing if the numbers clear the gate. Don't invest a single evening in Stripe/MVA plumbing before then.

The single most important caveat, which the code doesn't fix: **development effort is the real currency here, and it's finite.** The question isn't "will it cost money" (it won't) — it's "is the marginal evening better spent finishing Fjellrute than elsewhere?" Through the launch window (now → November) the answer is likely yes because the payoff event is fixed and near. After the January gate, let the data decide.

---

## 4. Recommended roadmap

The launch plan is already strong and I'd largely follow it. Below is a prioritized cut, biased toward "highest impact per solo-dev hour," with a few code-level items the deep dive surfaced.

**Now → launch (protect the differentiation, remove blockers).**
The highest-leverage product work is anything that widens the gap ut.no can't quickly copy. Prioritize, in order: (1) make the *route-sampled safety data* the hero of the UI and every screenshot — the runout/snow/weather/Varsom pinned to the profile is the whole story, so it must be the first thing a new user sees, not buried; (2) polish the 3D view, since it is the visual hook and the intended premium anchor; (3) nail the 30-second first-route mobile experience, because launch traffic will be 70%+ mobile from Facebook. On the housekeeping side, close the two open security items still noted as "accepted in git history" only if you ever open-source or hand off the repo, and land the Kartverket z12+ offline-caching permission (one-line `maxDownloadZoom` change when granted) so offline 3D looks crisp.

**Correct the positioning before you post.** Rewrite the pitch away from "ut.no can't draw routes / has no steepness" (both now false) toward "the only tool that measures runout, snow depth, weather and Varsom *along your drawn line*, in 3D, free." Lead with FATMAP, not a feature list — the plan already says this; just make sure the comparison claims are current so a topptur expert can't discredit the launch in the comments.

**Launch season (Oct–Nov 2026).** Run the founding-users program and the channel-by-channel community push as written. The founding cohort of guides/instructors doubles as your safety review and your credibility — that's the best-designed part of the plan; keep it. Ship at least one premium-destined feature (saved-route sync) behind an `is_founder` flag so there's something to test, with no billing code.

**January 2027 gate — decide, don't drift.** Hold the line on the viability gate (≥300 WAU, ≥25% week-2 return). If it passes, turn on Stripe with 3D + sync + offline as the paid tier at ~300 kr/yr and grandfather the founding users publicly. If it fails, leave it running free (costs are pennies), keep the SEO pages, and consider open-sourcing for goodwill rather than shutting it. Either way, **don't build billing before the gate.**

**Deferred / only if the gate passes.** Offline map packs beyond z11, bulk GPX export, custom overlays, and historical winter imagery are all correctly parked as future premium depth. The one structural engineering item to keep in your back pocket is serving terrain tiles so Cloudflare's edge cache can answer them *without* invoking the Worker — irrelevant at launch scale, but the right lever if a Show HN spike ever threatens the 100k/day Worker-request free tier.

---

## 5. Bottom line

Fjellrute is a well-built, legally-clean, cheap-to-run tool that fills a real and specific gap FATMAP left behind, and it does something ut.no genuinely does not: it analyses *your route* against runout, snow, weather and the avalanche bulletin, and shows it in 3D. It is worth finishing and launching this season because the cost is trivial and the demand window is real and dated. It is *not* yet worth treating as a business — the honest expected outcome is a valued free niche tool with a small, possibly hobby-scale premium income, and the January 2027 gate is the right, already-planned place to let real usage settle that question. Ship the free version, protect the "data-along-your-line + 3D" differentiation, correct the now-outdated ut.no comparison in the messaging, and don't write a line of billing code until the numbers earn it.
