# Fjellrute — legal vulnerability review

Reviewed: 2026-07-16. Scope: the full codebase (frontend, Worker, migrations, docs, assets, git history), assessed against Norwegian/EEA law and the upstream providers' terms. This is a technical review by an AI assistant, not legal advice — have a lawyer confirm the critical items before charging money for the service.

## What is already in good shape

The project is unusually well prepared on the licensing side. `docs/DATA_LICENSES.md` is a genuine data-rights audit with verified commercial-use terms for Kartverket (CC BY 4.0), MET Norway (CC BY 4.0 plus service ToS), NVE/Varsom and seNorge (NLOD), and the Terrarium terrain tiles, and attribution is actually implemented in the map corner, the info dialog, the data panels and the ToS. The Worker stamps MET's mandatory identifying User-Agent and edge-caches responses, which satisfies their two hard service requirements. The terms of use have a proper acceptance gate before sign-up and guest entry, a single source of truth (`src/terms/content.ts`) so the gate and the dialog cannot drift apart, and the liability disclaimer is correctly scoped "to the fullest extent permitted by law" rather than as an absolute waiver that avtaleloven § 36 could set aside. No secrets are committed anywhere in the git history (`.dev.vars` is properly ignored; the example file contains placeholders only), route/track ownership is enforced in SQL on every endpoint, and the yr.no weather icons were imported together with their MIT LICENSE file.

## Critical findings

### 1. No privacy policy while already collecting substantial personal data (GDPR)

This is the largest legal exposure in the project, and it is a gap between plan and reality: `Fjellrute-Launch-Plan.md` schedules the privacy policy for week 3 (Jul 27–Aug 2), but the code is **already collecting and storing** the data that triggers the obligation:

- email address, name and profile picture (`user` table, Google OAuth)
- IP address and user agent per session (`session` table — most people forget these are personal data)
- OAuth access/refresh/id tokens from Google (`account` table)
- saved routes, and — since migration 0002 — **recorded GPS tracks with timestamps** (`track` table)

GPS location history is high-sensitivity personal data in practice: repeated tracks reveal home address, habits and movement patterns. Under GDPR Articles 12–14 users must be informed at the point of collection what is stored, why, for how long, on what legal basis, and with which processors — and there is currently no privacy notice anywhere in the app (confirmed by grep: no privacy/personvern page, route or component exists). The terms of use (§1–9) never mention personal data at all.

**Fix:** publish a privacy policy before the next deploy, or at minimum before any real users record tracks. It can be one screen, as the launch plan says, but it must cover: data stored (including IP/UA in sessions and GPS tracks), purposes and legal basis (contract performance for accounts/routes/tracks; legitimate interest for session IP logging), retention, the processors below, and the user's rights including deletion. Add it next to the terms in the acceptance gate.

### 2. Processor and data-transfer obligations undocumented (GDPR Art. 28 / Ch. V)

The stack silently involves at least three processors handling EEA personal data:

- **Cloudflare** (Workers + D1 — the entire user database)
- **Resend** (US company; receives every user's email address for verification/reset mail)
- **Google** (OAuth sign-in)

Each needs a data processing agreement (all three offer standard DPAs — they need to be accepted/verified, not negotiated) and the US transfers should rest on the EU–US Data Privacy Framework or SCCs, which the privacy policy must mention. Also worth doing: check where the D1 database is physically located and consider Cloudflare's EU jurisdiction options, as the launch plan itself notes.

### 3. Google Fonts loaded remotely leaks visitor IPs to Google before any consent

`index.html` loads Inter from `fonts.googleapis.com`/`fonts.gstatic.com`. Every visitor's IP address is sent to Google before they have accepted anything — German courts (LG München I, 3 O 17493/20) have held exactly this to violate GDPR, and Datatilsynet takes a similar line on unnecessary third-party disclosures. This is the kind of thing that generates complaint letters.

**Fix:** self-host the font. Inter is SIL Open Font License — free to bundle. Download the woff2 files into `public/fonts/`, replace the three `<link>` tags with a local `@font-face`. Half an hour of work, removes the issue entirely, and makes the app faster and offline-capable in the fjell.

## Significant findings

### 4. No user-facing account deletion or data export

`docs/REMOVE_USER.md` is a good admin runbook (and the cascade design is correct), but GDPR Article 17 deletion currently depends on the user emailing you and you running wrangler commands against production. Acceptable at solo-dev scale **if** the privacy policy tells users how to request it — right now nothing does. Two smaller notes: the verification-token cleanup uses `like '%email%'`, which can over-delete if one address is a substring of another (use `= lower(email)` on the parsed identifier instead), and there is no Article 20 export — low priority, but a "download my routes/tracks as GeoJSON" button would satisfy it cheaply since the data is already GeoJSON.

### 5. Session rows and their IP addresses may accumulate indefinitely

Better Auth expires sessions, but check whether **expired session rows** (with IP + user agent) are ever actually deleted from D1. Indefinite retention of IP logs without a stated purpose is a storage-limitation (Art. 5(1)(e)) problem. A periodic cleanup (cron trigger deleting `session where expiresAt < now`) plus a retention line in the privacy policy closes this.

### 6. react-leaflet is Hippocratic-2.1 licensed

Every runtime dependency is MIT/BSD **except react-leaflet, which uses the Hippocratic License 2.1** — a non-OSI-approved license with ethical use conditions (human-rights compliance requirements) and a termination clause. For this app the practical risk is very low, but it is exactly the kind of thing a due-diligence review, an acquirer, or an enterprise customer flags. Options if it ever matters: use leaflet directly (BSD-2), or consolidate on MapLibre (BSD-3) for 2D as well. For now: document it as a known, accepted license.

### 7. Bundled image assets with undocumented provenance

Three groups of images ship with the app and only one is documented:

- `public/weather-icons/` — ✅ imported with MIT LICENSE, fine.
- `src/avalanche/problem-icons/*.jpg` — described in code as "official EAWS avalanche-problem pictograms". EAWS publishes its icon set for reuse (CC BY 4.0), but this is **not recorded in DATA_LICENSES.md** and no EAWS attribution is shown. Verify the license on eaws.org, add a row to the audit doc, and add "Avalanche problem icons © EAWS" to the attribution dialog.
- `public/login-backcountry.jpg`, `public/overview-peaks.jpg` — no license record, no EXIF attribution, no note in git. If these are Unsplash/Pexels, record the source URL and license in DATA_LICENSES.md now, while you still remember where they came from; unlicensed hero photos are one of the most common sources of copyright demand letters for small commercial sites.

## Before charging money (from the project's own roadmap, confirmed by this review)

These are not vulnerabilities today but become legal requirements the day payment is enabled:

- **Provider identification** (ehandelsloven § 8): name, address, org number and email must be easy to find in the service — register the ENK and put the details in the ToS/footer.
- **Right of withdrawal** (angrerettloven): for paid digital content you need the standard information and the explicit "I accept that delivery starts now and waive withdrawal" consent flow, or a 14-day refund right.
- **Lawyer review of the liability disclaimer**: `src/terms/content.ts` itself carries a NOTE saying exactly this. For a safety-adjacent avalanche-planning product sold commercially, that review is worth the money — the "planning aid only" framing is strong, but a lawyer should confirm §§ 2–4 hold up once consideration is paid.
- **Consumer purchase terms** and, at 50 000 kr turnover, MVA registration (flagged in the launch plan; verify with Skatteetaten).

## Minor items

- Both `docs/terms-of-service.en.md` and `.no.md` still contain the "**Draft note (remove before publishing)**" blockquote — make sure these files are not served or published anywhere as-is.
- The terms have no minimum-age clause and the privacy setup doesn't address children. In Norway the GDPR consent age is 13; a one-line "you must be at least 13 (15 recommended for an avalanche-terrain tool) to create an account" in the ToS is cheap insurance.
- `EMAIL_FROM` is `fjellrute@gmail.com` — the wrangler.jsonc comment already notes Resend can't verify gmail.com; switch to the real domain before launch (deliverability, not legality).
- The open action items in DATA_LICENSES.md remain valid and correct: honour MET's `Expires` header eventually, get written confirmation from NVE before scaling the uncached `/export` sampling, and ask Kartverket before any server-side caching of z12+ tiles (Geovekst restriction).
- The Google OAuth consent screen cannot be published without a privacy policy URL — item 1 above is therefore also the blocker for "Continue with Google" working for real users, as the launch plan already spotted.

## Priority order

1. Privacy policy page + link in the acceptance gate (unblocks Google OAuth publishing too)
2. Self-host the Inter font
3. Accept/verify DPAs with Cloudflare, Resend, Google; note transfers in the privacy policy
4. Document EAWS icons and the two hero photos in DATA_LICENSES.md
5. Session-row cleanup job + retention statement
6. Fix the `like '%email%'` deletion pattern in REMOVE_USER.md
7. Remove draft notes from the ToS markdown files; add age line
8. Pre-monetization package (ENK details, angrerett flow, lawyer review of disclaimer)
