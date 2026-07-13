# Fjellrute — Zero-Budget Launch Plan

*Solo-dev go-to-market plan, written 13 July 2026. Target: public launch to the Norwegian ski touring community in early November 2026, timed to the start of topptur season and the first avalanche bulletins. Total cash outlay before revenue: roughly one domain (~100–150 kr/year). Everything else is time.*

---

## The pitch (use this everywhere, word for word)

**Norwegian:** «Planlegg topptur på ekte Kartverket-kart med bratthet, utløpssoner og sanntids snødybde — gratis.»

**English:** "Plan ski touring routes on real Kartverket topo maps with avalanche steepness, runout zones and live snow depth — free."

Why this works: FATMAP is gone (shut down by Strava), and nothing free fills the gap for Norway. UT.no doesn't draw routes over steepness. Norgeskart has no snow data. Varsom shows danger but doesn't plan. Fjellrute is the only tool that combines all of it in one planner. That is the entire story — resist the urge to list features instead.

## Guiding principles

1. **Free until proven.** No paywall at launch. The viability gate (see Metrics) decides whether premium ever gets built.
2. **The season is the marketing calendar.** Interest in steepness maps spikes when the first bulletins drop (~late November). Everything before then is preparation; the loud push happens in the Oct 26 – Nov 22 window.
3. **Ship the honest version.** Solo dev, free tool, built because FATMAP died. That framing is your biggest asset in every community post — lead with it, never sound like a startup.
4. **One hour a day is enough.** The plan below assumes evenings/weekends effort, not full-time.

---

## Phase 1 — Foundation (Mon 13 Jul → Sun 9 Aug, weeks 1–4)

Goal: remove every legal, data and infrastructure blocker so nothing can force a takedown or surprise bill later.

**Week 1 (Jul 13–19) — Data rights audit.** Confirm commercial-use terms and rate limits for every upstream source: Kartverket tiles (CC-BY 4.0 — attribution required, commercial use OK, but check the tile-service usage policy specifically, not just the data license), MET/api.met.no (free incl. commercial, requires the User-Agent your Worker already stamps + attribution, 20 req/s soft limit), NVE bratthet/utløp (NLOD license — verify), seNorge/xgeo snow grids (met/NVE — verify). Write the answers into `docs/DATA_LICENSES.md` with links. Add visible attribution in the app footer/map corner now. This is the single most important week in the plan — everything else builds on it.

**Week 2 (Jul 20–26) — Domain, analytics, safety.** Buy the domain (fjellrute.no via Domeneshop/one.com, ~150 kr/yr — the only mandatory spend). Point Cloudflare at it. Enable Cloudflare Web Analytics (free, no cookie banner needed). Strengthen the safety framing: a first-run disclaimer modal ("planning aid — not a substitute for avalanche training, judgment, or the Varsom bulletin") plus a persistent link to varsom.no whenever steepness/runout layers are on. Review the existing ToS files against this.

**Week 3 (Jul 27 – Aug 2) — GDPR + accounts hygiene.** You store accounts in D1, so: privacy policy page (what's stored, where — Cloudflare EU jurisdiction note), account deletion that actually deletes, e-mail only used for verification. Keep it short and honest; a solo-dev privacy page can be one screen.

**Week 4 (Aug 3–9) — Business shell (optional, free).** Register an enkeltpersonforetak (free at Brønnøysund) or decide to defer until first revenue — no MVA obligations until 50 000 kr turnover. *(Not legal/tax advice — verify with Skatteetaten/Altinn.)* Set up a dedicated e-mail (hei@fjellrute.no) and a feedback channel: a simple in-app "Tilbakemelding" link to a form or mailto is enough.

## Phase 2 — Product polish (Mon 10 Aug → Sun 13 Sep, weeks 5–9)

Goal: close the gap your own UI plan identified — "capable hobby project" → "product someone would pay for" — plus the two features that make sharing possible.

**Weeks 5–7 (Aug 10–30) — Alpine Glass UI.** Execute the phased roadmap in `UI-Premium-Plan.md`: one accent color, one button system, unified glass surfaces, tabular numerals, replace `window.confirm()`, focus rings. Do the token system first; the rest follows cheaply.

**Week 8 (Aug 31 – Sep 6) — Shareability features.** These two features *are* marketing: (1) **shareable route links** — a route URL someone can post in a Facebook group is your viral loop; (2) **GPX export/import** — the community's lingua franca, and the #1 thing FATMAP refugees will test first. Saved routes for logged-in users if time allows (the D1 schema comment says this is already the next step).

**Week 9 (Sep 7–13) — Onboarding + mobile.** Empty state ("Tegn en rute for å begynne"), a 30-second first-route experience, and a full pass on phone-width layout — community traffic will be 70%+ mobile from Facebook.

## Phase 3 — Soft launch and seeding (Mon 14 Sep → Sun 25 Oct, weeks 10–15)

Goal: 20–50 real users quietly, brutal feedback, zero fanfare. Bugs found now don't happen during the November spike.

**Week 10 (Sep 14–20) — Private beta.** Personally invite 10–20 people: friends who tour, your local DNT chapter, one or two avalanche course instructors (NF-kursholdere), anyone from skredkurs communities you can reach. Ask each for one thing: "plan the tour you actually did last winter and tell me where the app lied to you."

**Weeks 11–12 (Sep 21 – Oct 4) — Iterate on beta feedback.** Fix what they hit. Watch analytics for drop-off points. If beta users don't return for a second session, find out why before going loud — that answer is worth more than any feature.

**Week 13 (Oct 5–11) — Content groundwork (free SEO).** Two or three plain pages on the domain: "Slik leser du bratthetskart" (how to read steepness maps), "FATMAP er borte — alternativer for Norge", and a landing page that shows the map immediately. These pages compound for years and cost nothing.

**Week 14 (Oct 12–18) — Prepare launch materials.** Write the launch posts (templates below), record a 30–60 s screen capture of drawing a route with the steepness overlay + snow profile (free: OBS/Kap), take 3–4 clean screenshots. Prepare a Show HN draft.

**Week 15 (Oct 19–25) — International warm-up.** Post **Show HN** on Hacker News (Tue–Thu morning US time): "Show HN: I built a free avalanche-terrain route planner for Norway after FATMAP shut down." HN loves solo-dev + open-data + maps. This is deliberately *before* the Norwegian push: it stress-tests the Worker under load and any feedback improves the real launch. Optionally Product Hunt the same week.

## Phase 4 — Norwegian launch (Mon 26 Oct → Sun 22 Nov, weeks 16–19)

Goal: become the tool the topptur community recommends to each other this season. One channel at a time — each post gets your full attention in the comments for 48 h.

**Week 16 (Oct 26 – Nov 1) — Reddit.** r/norge (check self-promo rules; frame as "jeg har laget…" story) and r/Backcountry ("free slope-angle planner for Norway"). Respond to every comment.

**Week 17 (Nov 2–8) — Facebook, the main event.** Post in the big groups, spaced out, personalized per group: *Toppturer i Norge*, *Topptur og randonee*, regional topptur groups (Tromsø, Romsdal, Lyngen, Sunnmøre), *Fjellforum*. Use the launch-post template below; always include the video/screenshots and end with a question ("hva mangler for at du ville brukt dette?"). Never post the same text twice — groups notice.

**Week 18 (Nov 9–15) — Instructors and guides outreach.** E-mail/DM 10–15 avalanche course instructors and guide companies: free tool, would love their expert criticism, happy to add what courses need. One instructor demoing Fjellrute in a skredkurs is worth a thousand impressions, and their feedback de-risks the safety framing.

**Week 19 (Nov 16–22) — Press and communities.** Tip Friflyt.no and UTE Magasinet ("norsk utvikler lager gratis erstatning for FATMAP"), post in Friflyt forum, and answer any "what do people use since FATMAP died?" thread you can find (Reddit, FB, forums) — helpfully, with the link.

## Phase 5 — Measure, decide, monetize (Nov 23 → year end, weeks 20+)

**Weeks 20–23 — Watch and fix.** The first bulletin weekends are your peak. Fix bugs same-day, thank people publicly, keep a public "nylig lagt til" changelog — visible momentum keeps community goodwill.

**Viability gate (evaluate Jan 1, 2027):**

| Signal | Keep going / build premium | Reassess |
|---|---|---|
| Weekly active users | ≥ 300 | < 100 |
| Week-2 return rate | ≥ 25 % | < 10 % |
| Routes drawn/week | ≥ 500 | < 100 |
| Unsolicited recommendations spotted | yes, recurring | none |

**If the gate passes — freemium in Jan–Feb 2027 (still peak season):** core planning stays free forever (trust + word of mouth is the moat). Premium at **59 kr/mnd or 490 kr/år** via Stripe (no fixed cost, ~2–3 % + fee per transaction): saved-route sync across devices, offline/print map packs, bulk GPX, custom overlays, maybe 3D later. Target: 1–2 % of actives convert. 100 subscribers ≈ 49 000 kr/yr — right at the MVA threshold, which is when the enkeltpersonforetak paperwork must be fully in order.

**If the gate fails:** costs are ~150 kr/yr, so nothing forces a shutdown. Leave it running, keep the SEO pages, retry next season with what you learned — or open-source it for goodwill.

---

## Launch post templates

**Facebook (Norwegian) — adapt per group:**

> Hei! Jeg er en utvikler fra [sted] som savnet FATMAP etter at det ble lagt ned, så jeg har brukt det siste året på å bygge et gratis alternativ for Norge: **Fjellrute** (fjellrute.no).
>
> Du tegner ruta rett på Kartverket-kartet og ser bratthet og utløpssoner fra NVE, snødybde fra seNorge langs hele ruta, og høydeprofil — alt i ett. Eksport til GPX funker.
>
> Helt gratis, ingen app å installere, funker i nettleseren på mobil. Jeg lager dette alene og vil gjerne ha ærlige tilbakemeldinger: hva mangler for at du ville brukt det til neste topptur?
>
> (Og selvsagt: dette er et planleggingsverktøy — sjekk alltid varsom.no og bruk egen vurdering i terrenget.)

**Show HN (English):**

> Show HN: Fjellrute – free avalanche-terrain route planner for Norway (FATMAP alternative)
>
> When Strava shut down FATMAP, ski tourers in Norway lost the only good tool for planning routes against slope angle. I built a free replacement on open government data: Kartverket topo maps, NVE steepness/runout overlays, seNorge snow depth sampled along your drawn route, with a synced elevation profile. React + MapLibre on Cloudflare Workers/D1, running entirely on free tiers. Would love feedback on the route-drawing UX.

**Instructor/guide outreach (Norwegian, short):**

> Hei [navn], jeg har laget et gratis planleggingsverktøy for topptur (fjellrute.no) med NVE-bratthet og snødybde langs ruta. Siden du holder skredkurs lurte jeg på om du ville tatt en kikk — jeg vil heller høre hva som er galt fra en fagperson nå enn fra en bruker i vinter. Alt av innspill mottas med takk, og verktøyet forblir gratis for kursbruk.

## Risk checklist

- **Upstream API terms/limits** — resolved in week 1; cache aggressively at the edge (already doing this) so a traffic spike never hammers MET/NVE.
- **Traffic spike costs** — Workers free tier is 100k req/day; HN front page can exceed that. Workers Paid is $5/mo — the one spend worth pre-approving for launch week only.
- **Safety liability** — disclaimer modal + ToS + persistent Varsom link (weeks 2–3); never market it as a safety tool, always as a planning tool.
- **Community backlash ("another app that gets people killed")** — pre-empt by shipping the Varsom integration and humble framing; the instructor outreach in week 18 is also insurance here.
- **Burnout** — the plan is deliberately ~1 h/day; if a week slips, slip the whole plan a week rather than skipping the beta phase.
