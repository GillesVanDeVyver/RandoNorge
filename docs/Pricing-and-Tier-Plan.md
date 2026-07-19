# Fjellrute — Free vs Premium Tiering, Pricing & Launch Strategy

*Based on a full audit of the codebase (src/, worker/, migrations/, docs/) and market research, July 2026.*

---

## 1. Guiding principles (derived from the code and your own launch plan)

1. **Safety data stays free, forever.** Steepness, runout, snow depth, and Varsom warnings are the reason people will trust Fjellrute. Paywalling safety information for backcountry skiers is both an ethical and a reputational risk. Your launch plan already promises this — keep it.
2. **Free tier = the growth loop.** Anything that brings new users in or spreads links stays free.
3. **Premium = convenience, memory, and depth.** Charge for things power users do repeatedly: storing, recording, comparing, going offline.
4. **Premium never takes anything away.** Features that launch free stay free for existing behavior; premium only adds (with one careful exception: unlimited storage limits, announced from day one).
5. **Costs are not the driver.** Your entire stack (Cloudflare free tier + Kartverket/MET/NVE/seNorge free APIs) runs at ~150 kr/yr up to ~300 WAU. Tier by *value*, not by serving cost. The one real cost lever is 3D terrain tiles (R2 + Worker requests) — worth monitoring, not worth paywalling at launch.

---

## 2. Recommended tier split

### FREE tier (the "trust core" + growth loop)

| Feature | Why free |
|---|---|
| Route drawing, eraser, editing on Kartverket topo | The product's core promise |
| Steepness + runout overlay (NVE) | Safety — never paywall |
| Snow depth overlay (seNorge) | Safety — never paywall |
| Elevation profile + route stats (distance, ascent, max slope) | Core planning value |
| Weather forecast (MET) + Varsom avalanche warning | Safety — never paywall |
| 2D map, search, locate, fullscreen | Table stakes |
| **3D terrain view** | Your killer differentiator vs. dead FATMAP. This is the screenshot people will share. Keep free; revisit only if R2/Worker costs bite |
| Guest mode (plan without account) | Zero-friction acquisition |
| GPX/FIT/TCX import, single GPX export | Interop = adoption. Never lock people's data in |
| Save routes — **up to 10** | Enough to get hooked; the cap is the conversion trigger |
| **Viewing public/shared tours** (new feature) | This is your SEO and viral loop — every shared link is free marketing. Must be free and login-free |
| **Publishing/sharing your own tours** (new feature) | Free publishing = content flywheel. Creators produce the catalog that attracts new users. Don't tax the people filling your platform |

### PREMIUM tier ("Fjellrute Pro" / "Fjellrute+")

| Feature | Why premium |
|---|---|
| **Unlimited saved routes** (library beyond 10) | Classic freemium cap; hits exactly the power users |
| **Live GPS navigation + activity recording** | High ongoing value, used every single tour; this is the "companion in the field" upgrade. (AllTrails/Komoot both monetize navigation-adjacent features) |
| **Plan vs. actual comparison** (timeline scrubbing) | Delightful power feature, already built, clearly "pro" |
| **Activity log / completed-tours archive** | The "your season's memory" pitch; pairs with recording |
| **Offline map packs** (planned) | The #1 premium feature in every competitor (AllTrails Plus, Komoot Maps, Outdooractive Pro). No mobile coverage in the mountains = obvious value |
| **Bulk GPX export** (planned) | Guide/instructor feature |
| **Custom overlays** (planned) | Niche pro/guide feature |
| **Historical winter imagery** (planned) | Nice-to-have depth |
| Future: season stats/heatmap dashboard | Annual "your year in the mountains" retention driver |

**Borderline calls, with recommendation:**
- **3D view → FREE.** It's your marketing. If terrain-tile costs grow, the premium version becomes "offline 3D" or higher-res, not 3D itself.
- **GPS recording → PREMIUM, but with a taste:** let free users record e.g. 3 activities total (or keep only the last 3), so everyone experiences it before hitting the wall.
- **Sharing → FREE both ways.** A share link that says "made with Fjellrute" viewed by a non-user is worth more than 49 kr.

---

## 3. Pricing — market research (July 2026)

| Product | Annual price | Notes |
|---|---|---|
| AllTrails Plus | $35.99/yr (~370 kr) | Offline maps; frequent 50%-off sales |
| AllTrails Peak | $79.99/yr (~820 kr) | AI features, community heatmaps, custom routes |
| Komoot Premium | €59.99/yr (~700 kr) | Full bundle; regional map packs sold separately |
| Outdooractive Pro+ | ~€60/yr (~700 kr) | Billed annually |
| Strava (incl. FATMAP features) | €60/yr (~700 kr) | Where FATMAP went after the $30/yr app died |
| FATMAP Explore (RIP) | $30/yr (~310 kr) | The price its refugees remember |
| Norgeskart friluftsliv Premium | 60 kr/yr | Norwegian hobby-app floor — thin feature set |

**Reading of the market:** the global "serious outdoor app" band is 350–700 kr/yr. Your audience (Norwegian ski tourers) is a high-willingness-to-pay niche used to spending 8,000 kr on skins and 12,000 kr on airbag packs. FATMAP refugees anchored at ~310 kr/yr; Komoot/Strava anchor at ~700 kr.

### Recommendation: **490 kr/yr** (or 59 kr/mnd)

Your launch plan's number holds up well against the market:

- Comfortably under Komoot/Strava/Outdooractive (~700 kr) → easy "cheaper than Strava, built for Norway" pitch.
- Above the FATMAP anchor (310 kr), justified by being alive, Norwegian, and safety-focused.
- 100 subscribers = 49,000 kr/yr, just over the MVA registration threshold — plan for MVA from subscriber ~100 onward (490 kr incl. 25% MVA nets you ~392 kr).
- **Keep the monthly option (59 kr/mnd).** Ski touring is seasonal; many users will happily pay Dec–Apr (~295 kr) who would never commit to a year. Seasonal monthly churn is normal in this category — don't fight it, price for it.
- Optional: a launch-year "early bird" of 349–390 kr/yr for the first cohort converts fence-sitters and matches the FATMAP anchor without permanently lowering your price.

---

## 4. Launch strategy: free-only vs everything?

**Recommendation: launch with ALL features enabled and free, with premium clearly labeled — add billing later.** This is a third option that beats both of the ones you posed:

**Why not free-features-only at launch?** The premium features (recording, plan-vs-actual, big libraries) are your stickiest retention drivers. Hiding them at launch means launching a shallower product into your one big PR moment (the FATMAP-shaped hole, winter 2026/27). You don't get a second first launch.

**Why not launch with billing on day one?** (a) You'd build Stripe integration, MVA handling, and refund support before knowing anyone will pay. (b) A paywall in launch-week Reddit/Facebook posts undermines the community-first, "free forever core" positioning that is your entire moat. (c) Your own viability gate (≥300 WAU, ≥25% W2 retention by Jan 2027) exists precisely so you don't build billing prematurely.

**The concrete plan:**

1. **Now → launch:** your 20 founding testers get everything (they do anyway). Grandfather them with lifetime premium as planned.
2. **Public launch (Oct–Nov 2026):** everything free. Premium-destined features carry a small badge: *"Pro — free during launch season."* This is honest, creates zero bait-and-switch backlash, and pre-sells the upgrade by letting everyone taste it.
3. **In-app from day one:** a pricing page stating exactly what will always be free (the safety core, drawing, 3D, sharing) and what becomes Pro at 490 kr/yr. Transparency here *is* marketing.
4. **Jan 2027 (viability gate passes):** turn on Stripe. Existing free users keep routes/activities already saved (read-only above the cap — never delete or lock data), and get a one-time early-bird offer.
5. If the gate doesn't pass, you've lost nothing — no billing code was built for an audience that wasn't there.

This gets you the "launch free to get more people" growth AND the full-featured product at launch, and it converts better later because users have already formed the habits you'll charge for.

---

## 5. Public tours & sharing — where it fits

Build it as a **free, pre-launch feature** (the DB is already prepared: `isShared`, `shareSlug` on the route table). It is your acquisition engine, not a revenue feature:

- Public tour pages viewable without login → SEO for "topptur <fjellnavn>" queries → free traffic forever.
- Every shared link in a Facebook topptur group is an ad.
- Premium angle later, if desired: *copy a public tour into your own library* counts against the 10-route free cap — so heavy collectors convert, while browsing and sharing stay free.

---

## 6. Summary card

| Question | Answer |
|---|---|
| Free tier | Planning core + all safety data + 3D + import/export + sharing/public tours + 10 saved routes |
| Premium tier | Unlimited library, GPS recording & activity log, plan-vs-actual, offline maps, bulk export, custom overlays |
| Price | **490 kr/yr** / 59 kr/mnd (early-bird ~349–390 kr optional); MVA planning from ~100 subs |
| Launch | **All features, all free**, premium-badged "free during launch season"; billing at Jan 2027 gate |
| Public tours | Free both to publish and view — it's the growth engine |
