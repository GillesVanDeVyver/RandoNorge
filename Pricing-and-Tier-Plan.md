# Fjellrute — Free vs Premium Tiering, Pricing & Launch Strategy

*Based on a full audit of the codebase (src/, worker/, migrations/, docs/) and market research, July 2026.*
*Decisions: 3D terrain view is premium; price is 300 kr/yr.*

---

## 1. Guiding principles (derived from the code and the launch plan)

1. **Safety data stays free, forever.** Steepness, runout, snow depth, and Varsom warnings are the reason people will trust Fjellrute. Paywalling safety information for backcountry skiers is both an ethical and a reputational risk. The 2D map gives full access to all of it.
2. **Free tier = the growth loop.** Anything that brings new users in or spreads links stays free.
3. **Premium = convenience, depth, and the premium view.** Charge for things power users do repeatedly: storing, recording, comparing, going offline — and the immersive 3D experience.
4. **Premium never takes anything away.** Features that launch free stay free for existing behavior; limits (route cap, 3D) are announced from day one so there is no bait-and-switch.
5. **3D as premium doubles as cost control.** Terrain tiles (R2 storage + Worker requests) are the single biggest infrastructure cost lever in docs/cost-and-limits.md. Gating 3D means paying users fund the exact resource they consume.

---

## 2. Tier split

### FREE tier (the "trust core" + growth loop)

| Feature | Why free |
|---|---|
| Route drawing, eraser, editing on Kartverket topo (2D) | The product's core promise |
| Steepness + runout overlay (NVE) | Safety — never paywall |
| Snow depth overlay (seNorge) | Safety — never paywall |
| Elevation profile + route stats (distance, ascent, max slope) | Core planning value |
| Weather forecast (MET) + Varsom avalanche warning | Safety — never paywall |
| 2D map, search, locate, fullscreen | Table stakes |
| Guest mode (plan without account) | Zero-friction acquisition |
| GPX/FIT/TCX import, single GPX export | Interop = adoption. Never lock people's data in |
| Save routes — **up to 10** | Enough to get hooked; the cap is a conversion trigger |
| **Viewing public/shared tours** (new feature) | SEO + viral loop — every shared link is free marketing. Must be free and login-free |
| **Publishing/sharing your own tours** (new feature) | Free publishing = content flywheel. Creators produce the catalog that attracts new users |

### PREMIUM tier ("Fjellrute Pro" / "Fjellrute+") — 300 kr/yr

| Feature | Why premium |
|---|---|
| **3D terrain view** (Kartverket NDH mesh, all overlays draped) | The wow feature and the FATMAP replacement — FATMAP itself charged ~$30/yr for exactly this. Also the biggest cost driver (R2 terrain tiles), so subscribers fund what they use |
| **Unlimited saved routes** (library beyond 10) | Classic freemium cap; hits exactly the power users |
| **Live GPS navigation + activity recording** | High ongoing value, used on every tour; the "companion in the field" upgrade |
| **Activity log / completed-tours archive** | "Your season's memory"; pairs with recording |
| **Plan vs. actual comparison** (timeline scrubbing) | Delightful power feature, already built, clearly "pro" |
| **Offline map packs** (planned) | The #1 premium feature in every competitor |
| **Bulk GPX export** (planned) | Guide/instructor feature |
| **Custom overlays** (planned) | Niche pro/guide feature |
| **Historical winter imagery** (planned) | Nice-to-have depth |

**Make 3D sell itself — give free users a taste:**
- A short, non-interactive 3D fly-around preview of their drawn route (a few seconds, then a "Go Pro" prompt), and/or full 3D on one designated demo area (e.g. Lyngen).
- Public tour pages can show a static 3D thumbnail render — shared links then advertise the premium feature to non-users.
- All marketing screenshots/videos lead with 3D, badged "Pro."

Trade-off to accept: 3D was the loudest "free replacement for FATMAP" hook, so launch messaging should shift to "the safety planner FATMAP never was — steepness, runout, snow depth and Varsom, free; the 3D you loved, 300 kr/yr (what FATMAP cost)."

---

## 3. Pricing — market research (July 2026)

| Product | Annual price | Notes |
|---|---|---|
| AllTrails Plus | $35.99/yr (~370 kr) | Offline maps; frequent 50%-off sales |
| AllTrails Peak | $79.99/yr (~820 kr) | AI features, heatmaps, custom routes |
| Komoot Premium | €59.99/yr (~700 kr) | Full bundle |
| Outdooractive Pro+ | ~€60/yr (~700 kr) | Billed annually |
| Strava (incl. FATMAP features) | €60/yr (~700 kr) | Where FATMAP went |
| **FATMAP Explore (RIP)** | **$30/yr (~310 kr)** | **The anchor the target audience remembers** |
| Norgeskart friluftsliv Premium | 60 kr/yr | Norwegian hobby-app floor |

### Price: **300 kr/yr** (suggest 29–35 kr/mnd monthly option)

- Lands exactly on the FATMAP anchor — "the 3D planner you lost, at the price you paid, built for Norway."
- Half of AllTrails Plus in kroner terms, ~40% of Komoot/Strava — a very easy value story, and low enough to be an impulse purchase in a Facebook topptur group.
- **Keep a monthly option** (e.g. 35 kr/mnd): ski touring is seasonal; a Dec–Apr subscriber pays ~175 kr who might never commit annually. Price the annual so a full season on monthly (~5 × 35 = 175 kr) still makes annual attractive for anyone touring two seasons.
- **MVA math:** the 50,000 kr registration threshold is now ~167 subscribers (vs ~100 at 490 kr). Below it, you keep the full 300 kr; once registered, 300 kr incl. 25% MVA nets 240 kr. Decide early whether the listed price is MVA-inclusive so you never have to raise it visibly.
- **Revenue reality check:** the launch plan's 1–2% conversion of 300 WAU ≈ handfuls of subscribers at first. At 300 kr you need ~2× the subscribers for the same revenue as 490 kr — the bet is that 3D-as-premium plus the lower price more than doubles conversion. Plausible given FATMAP demand, but hold the option of a higher-priced tier later (e.g. "Pro+" with offline packs + custom overlays) rather than ever raising the base price.

---

## 4. Launch strategy: all features, all free at launch — billing later

**Recommendation: launch with ALL features enabled and free, with premium features clearly badged — turn on billing at the Jan 2027 viability gate.**

Why not free-features-only at launch: 3D, recording, and plan-vs-actual are the stickiest features and the best screenshots. Hiding them means launching a shallower product into the one big PR moment (the FATMAP-shaped hole, winter 2026/27). There is no second first launch.

Why not billing on day one: (a) Stripe + MVA + refund support built before knowing anyone will pay; (b) a paywall in launch-week Reddit/Facebook posts undermines the community-first positioning that is the moat; (c) the viability gate (≥300 WAU, ≥25% W2 retention by Jan 2027) exists precisely to avoid building billing prematurely.

**Concrete plan:**

1. **Now → launch:** the ~20 founding testers get everything; grandfather them with lifetime premium as planned.
2. **Public launch (Oct–Nov 2026):** everything free. Premium-destined features (3D included) carry a badge: *"Pro — free during launch season."* Honest, zero bait-and-switch, and it pre-sells the upgrade by letting everyone taste 3D during the launch buzz.
3. **In-app pricing page from day one:** exactly what stays free forever (safety core, 2D planning, sharing) and what becomes Pro at 300 kr/yr in January. Transparency is marketing.
4. **Jan 2027 (gate passes):** enable Stripe. Existing users keep everything already saved (read-only above the 10-route cap — never delete or lock data). One-time early-bird offer (e.g. 249 kr first year) to convert the launch cohort.
5. Gate fails → nothing was built for an audience that wasn't there.

---

## 5. Public tours & sharing — where it fits

Build as a **free, pre-launch feature** (DB already prepared: `isShared`, `shareSlug` on the route table). It is the acquisition engine, not a revenue feature:

- Public tour pages viewable without login → SEO for "topptur <fjellnavn>" queries → free traffic forever.
- Every shared link in a Facebook topptur group is an ad — and its static 3D thumbnail advertises Pro.
- Premium angle: *copying a public tour into your own library* counts against the 10-route free cap, so heavy collectors convert while browsing and sharing stay free.

---

## 6. Summary card

| Question | Answer |
|---|---|
| Free tier | 2D planning core + all safety data (steepness, runout, snow, Varsom, weather) + import/export + sharing/public tours + 10 saved routes |
| Premium tier | **3D terrain view**, unlimited library, GPS recording & activity log, plan-vs-actual, offline maps, bulk export, custom overlays |
| Price | **300 kr/yr** / ~35 kr/mnd; optional 249 kr early-bird first year; MVA threshold at ~167 subs |
| Launch | All features, all free, premium-badged "free during launch season"; billing at Jan 2027 gate |
| Public tours | Free to publish and view — the growth engine (3D thumbnails tease Pro) |
