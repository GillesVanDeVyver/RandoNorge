# Payments & Income — Fjellrute

*How to handle subscription revenue practically (code), legally, and tax-wise. Written July 2026 for the planned Jan 2027 billing switch-on (see `Pricing-and-Tier-Plan.md`). Company form: enkeltpersonforetak (ENK), owner Tryggve.*

> **Disclaimer:** This is a working document, not legal or tax advice. Rates and thresholds below are the 2026 figures and change with each statsbudsjett — verify with skatteetaten.no before filing, and have a lawyer/accountant confirm the big calls (the LEGAL-REVIEW already recommends a lawyer pass on the liability disclaimer before charging money).

---

## 1. Is an enkeltpersonforetak enough?

**Short answer: yes, at launch scale — ENK is the right structure for turning on billing in Jan 2027. Revisit AS when either (a) net profit passes roughly 700–900 k kr/yr, or (b) you want the liability shield for a safety-adjacent product.**

### What ENK gives you

- Free to run: no accounting duty beyond bookkeeping (bokføringsplikt, not regnskapsplikt at this size), no annual accounts filing to Regnskapsregisteret, no audit.
- Simple money flow: profit is simply your personal income; you can move money in/out freely (it's all yours — there is no legal separation).
- Registration in Enhetsregisteret is free; you already need the org number in the app footer anyway (ehandelsloven § 8 — flagged in LEGAL-REVIEW item 8).
- You can register in Foretaksregisteret (~2 250 kr) but it's only mandatory for ENK with resale of goods or 5+ employees — not needed here.

### What ENK costs you (2026 figures)

Business profit is taxed as **calculated personal income** under foretaksmodellen:

| Component | Rate |
|---|---|
| Alminnelig inntekt | 22 % |
| Trygdeavgift on næringsinntekt | 10.8 % (vs 7.6 % on wages) |
| Trinnskatt | 1.7 % from ~226 k, 4.0 % from ~318 k, 13.7 % from ~725 k, 16.8 % from ~980 k, 17.8 % from ~1 467 k |

So marginal tax on ENK profit stacked on top of a normal day-job salary is roughly **36–37 %** in the middle brackets and up to ~50 % at the top. Note: **no minstefradrag on business income** — but all actual costs (Cloudflare, domain, Resend, lawyer fees, a share of home office, hardware) are deductible.

Other ENK trade-offs to know:

- **Unlimited personal liability.** Fjellrute is an avalanche-terrain *planning aid* with a disclaimer, but if a claim ever landed despite the ToS, it lands on you personally. This is the strongest non-tax argument for an AS eventually.
- **Weaker social rights:** sykepenger at 80 % of business income only from day 17 (insurable up), no dagpenger on business income, pension is DIY (skattefavorisert pensjonssparing for næringsdrivende: up to 7 % of income between 1G and 12G, deductible).
- **No income smoothing:** profit is taxed the year it's earned, whether or not you take it out.

### When AS starts to win

An AS pays flat 22 % on profit; money left in the company stops there. Taking it out as dividend costs an additional effective 37.84 % (22 % × 1.72 oppjustering), total ~51.5 % — i.e. *at the top margin* AS ≈ ENK. The AS advantages are:

1. **Deferral:** retain earnings at 22 % and reinvest (marketing, contractors, tiles) — powerful once profit exceeds what you need to live on.
2. **Limited liability** — worth real money for a safety-adjacent commercial product.
3. Pay yourself salary → normal wage trygdeavgift (7.6 %), minstefradrag, full sykepenger/dagpenger/tjenestepensjon rights (but the AS then pays 14.1 % arbeidsgiveravgift and must run payroll).
4. Cleaner for co-founders, investors, or acquisition (the LEGAL-REVIEW's Hippocratic-license note is exactly the kind of thing due diligence on an AS would look at).

Costs of AS: 30 000 kr share capital (stays in the company, usable), founding fee ~5–6 k, full regnskapsplikt (annual accounts to Regnskapsregisteret), typically 15–30 k kr/yr accountant, payroll admin if you take salary.

### Recommendation

| Situation | Structure |
|---|---|
| Now → billing on, < ~100–300 subscribers (< ~150 k kr/yr) | **ENK — clearly right.** AS overhead would eat a large share of revenue |
| Revenue growing, profit approaching your trinnskatt 3 bracket (~725 k total personal income) | Start planning conversion |
| Profit > what you need personally, or partners/investors, or you lose sleep over liability | **Convert to AS** (tax-free conversion of ENK → AS is possible via skattefri omdanning — do it with an accountant, effective from Jan 1 of a year) |

One nuance worth doing early even as ENK: keep the app's ownership clean (code, domain, brand under the ENK, licenses documented) so a later omdanning or sale is trivial.

---

## 2. MVA (VAT)

- Subscriptions to Fjellrute are **electronic services → standard 25 % MVA**.
- **Registration is mandatory once taxable turnover passes 50 000 kr in any rolling 12-month window.** (Still 50 k in 2026 — the much-discussed raise has not happened; re-check each budget year.) At 490 kr/yr that is subscriber ~102, or sooner with monthly plans — matching the pricing plan's "MVA from ~subscriber 100" note.
- Practical sequence:
  1. Watch cumulative invoiced revenue. When the invoice that crosses 50 000 kr is issued, register in MVA-registeret via Samordnet registermelding (Altinn) — you may only add MVA to invoices *from registration*.
  2. From then on: 490 kr is **inclusive** of MVA → you net ~392 kr/sub. Consumer prices in Norway must always be shown inclusive of MVA, so nothing changes in the UI — only your margin.
  3. File **MVA-melding** (normally bi-monthly; you can apply for annual filing when turnover < 1 M kr — do this, it's one filing/yr).
  4. MVA on your own costs (the Stripe fees are MVA-exempt financial services, but e.g. a Norwegian accountant, equipment) becomes deductible input MVA.
- **Sales to customers outside Norway:** B2C electronic services to EU consumers are in principle VAT-able *in the customer's country* (EU OSS/MOSS rules). At launch, geo-restricting billing to Norway (or accepting the small compliance risk below EU micro-thresholds) is the pragmatic path; Stripe Tax can compute and report EU VAT if/when foreign subscribers matter. Decide explicitly and note it in the ToS.

---

## 3. Income tax mechanics for the ENK (the yearly rhythm)

1. **Bookkeeping (bokføringsloven):** every sale needs salgsdokumentasjon. Stripe's invoices/receipts satisfy the content requirements (seller name + org nr + "MVA" suffix once registered, buyer, date, description, amount, MVA specified) *if configured with your business details*. Export Stripe's monthly reports; keep them 5 years.
   - Practical: use **Fiken** (~100–250 kr/mo, built for ENK, has a Stripe integration) rather than spreadsheets. It generates the næringsspesifikasjon and MVA-melding for you.
   - **Separate bank account** for the ENK. Not legally required, but effectively mandatory for sane bookkeeping. Stripe payouts → this account only.
2. **Forskuddsskatt:** when income starts, update your skattekort / apply for forskuddsskatt at skatteetaten.no; you'll pay estimated tax in 4 installments (Mar/Jun/Sep/Dec). Rule of thumb: **set aside ~40 % of profit** in a separate savings account from day one; adjust once you see the real marginal rate on top of your other income.
3. **Skattemeldingen:** business income goes in via **næringsspesifikasjonen** (the old RF-1030/RF-1175 forms are gone; accounting software files this digitally). Deadline 31 May for næringsdrivende.
4. **Hobby vs næring:** the moment you charge 490 kr/yr systematically with profit intent, this is næringsvirksomhet, not hobby — all income is taxable from krone 1 (the 50 k threshold is *only* MVA, a common misconception).
5. **Deduct everything legitimate:** Cloudflare/R2 overage, domain, Resend, Stripe fees, lawyer review of the disclaimer, accountant, license costs, proportional home office (standard 2 250 kr/yr or actual), equipment < 15 k expensed directly. These reduce both the 22 % and the trygdeavgift/trinnskatt base.

---

## 4. Handling payments in the code

### Provider choice

**Recommendation: Stripe as the billing engine, with Vipps enabled as a payment method inside Stripe.**

- Stripe fully supports Norwegian ENKs (org number + Norwegian bank account), payouts in NOK, and has by far the best subscription machinery (Billing, Checkout, Customer Portal, dunning, proration, webhooks).
- **Vipps matters in Norway** — it's the expected way to pay for a hyper-Norwegian product. Stripe offers Vipps as a payment method; check current support for *recurring* Vipps in Stripe when you build (Vipps recurring agreements via Stripe have been rolling out; if not available for subscriptions, launch card-only via Stripe and add Vipps for the monthly plan later, or use Vipps MobilePay's own Recurring API as a second rail — more code, defer it).
- Fees ~1.9–2.5 % + fixed per transaction. On 490 kr that's ~12–15 kr — irrelevant to pricing.
- Do **not** build anything that touches card data. Stripe Checkout / Payment Element keeps you in PCI SAQ-A territory (their iframe, their servers).

### Architecture on the existing stack (Cloudflare Worker + D1)

Keep it boring; this is a solved problem:

```
Browser ──> worker/billing.js ──> Stripe Checkout (hosted page)
                                       │
Stripe ── webhook POST /api/stripe/webhook ──> worker verifies signature
                                       │
                                  D1: subscription table
                                       │
worker/auth session ──> "isPremium" claim read by the SPA
```

1. **Checkout:** a `POST /api/billing/checkout` endpoint creates a Stripe Checkout Session (mode `subscription`, price = the 490 kr/yr or 59 kr/mnd Price object, `customer_email` from the Better Auth session, `client_reference_id` = user id) and redirects. No card UI in the app.
2. **Webhooks are the source of truth**, never the redirect page. Handle at minimum: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Rules:
   - **Verify the `Stripe-Signature` header** with the webhook secret (a Wrangler secret, like the existing auth secrets). Note for Workers: use the async `stripe.webhooks.constructEventAsync(...)` — the sync variant needs Node crypto that's awkward in workerd even with `nodejs_compat`.
   - **Idempotency:** store processed `event.id`s (or upsert by subscription id) — Stripe retries deliveries.
   - Never trust `success_url` query params for entitlement; a user can fabricate them.
3. **D1 schema** (new migration): `subscription(userId PK/FK, stripeCustomerId, stripeSubscriptionId, status, plan, currentPeriodEnd, cancelAtPeriodEnd, updatedAt)`. Entitlement check = `status IN ('active','trialing') AND currentPeriodEnd > now` — plus a grace period of a few days so a slow renewal webhook doesn't lock anyone out mid-tour.
4. **Enforce server-side.** The premium gates (route #11+, recording endpoints in `tracks.js`, future bulk export) must be checked in the Worker, not just hidden in React — the API is otherwise one `fetch` away from free premium.
5. **Customer Portal:** enable Stripe's hosted portal (`/api/billing/portal` → redirect). You get cancel, card update, invoice history and plan switching for free — don't build any of it.
6. **Grandfathering** (per the pricing plan): a `grantedPremium` boolean/`premiumSource` column for the 20 founding testers, checked with OR against the Stripe status. Never delete data when premium lapses — read-only above the cap, exactly as the pricing plan promises.
7. **Testing:** Stripe test mode + `stripe listen`/CLI webhook forwarding against `wrangler dev`; a test clock for renewal/dunning flows.

### Consumer-law requirements to build into the flow (Norwegian law)

These are the code-visible parts of the LEGAL-REVIEW's "before charging money" list:

- **Angrerettloven:** at checkout, an unticked-by-default checkbox: *"Jeg samtykker til at tjenesten leveres umiddelbart, og erkjenner at angreretten dermed bortfaller"* — or skip the checkbox and simply honor 14-day refunds (operationally cheaper at this volume; a refund button in your admin notes beats a legal flow). Provide the standard angrerett information either way.
- **Ehandelsloven § 8:** name, address, org nr (with "MVA" once registered), email in footer + ToS.
- **Pre-contract clarity:** price incl. MVA, renewal period, and how to cancel must be stated *before* purchase; the button must say something equivalent to "Kjøp/Bestill med betalingsplikt".
- **Digitalytelsesloven** (Norwegian digital-content law, in force since 2023) applies to paid digital services: reasonable notice before *reducing* features, and refund rights on failure — one more reason "premium never takes anything away" is the right policy.
- **Receipts:** enable Stripe email receipts/invoices with the ENK's legal details; that satisfies both the customer and bokføringsloven.

### Operational checklist (in order)

1. Register the ENK details everywhere: Stripe account, app footer, ToS (unblocks ehandelsloven).
2. Open a separate bank account; connect to Stripe payouts.
3. Set up Fiken (or similar) + Stripe report import; decide the bookkeeping routine (monthly, 30 min).
4. Build: Checkout endpoint → webhook handler + D1 table → server-side gates → Portal link. Add the angrerett consent + purchase-terms page.
5. Lawyer review of the liability disclaimer + consumer terms (LEGAL-REVIEW item 8).
6. Turn on billing (Jan 2027 gate). Watch cumulative revenue; at ~45 k kr file the MVA registration so it's active before crossing 50 k.
7. Apply for forskuddsskatt; set aside ~40 % of profit continuously.
8. At year one: evaluate profit level and liability comfort → ENK stays or AS conversion (skattefri omdanning, effective Jan 1).

---

## 5. Summary

| Question | Answer |
|---|---|
| Is ENK enough? | Yes, for launch and the first ~100–300 subscribers. Free, simple, all costs deductible |
| When to switch to AS? | Profit ≳ 700–900 k/yr (deferral at 22 % wins), or when liability/partners/investment make the shield worth ~20–40 k/yr overhead. Convert tax-free via skattefri omdanning |
| MVA? | Register at 50 000 kr rolling 12-month turnover (~subscriber 100). 25 % on subscriptions; 490 kr becomes ~392 kr net. Apply for annual MVA-melding |
| Income tax? | Foretaksmodellen: 22 % + 10.8 % trygdeavgift + trinnskatt. Set aside ~40 %. Forskuddsskatt ×4/yr, næringsspesifikasjon by 31 May |
| Payments in code? | Stripe Checkout + webhooks (signature-verified, idempotent) + D1 subscription table + server-side gates + hosted Customer Portal. Vipps as Stripe payment method for Norwegians. Never touch card data |
| Legal must-haves | Org details in footer, angrerett consent or 14-day refunds, price incl. MVA + "betalingsplikt" button, lawyer pass on the avalanche disclaimer |
