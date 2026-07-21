# TODO: full Norwegian translation of the app

Fjellrute is a Norwegian ski-touring / mountain-travel planner, but the
**UI is currently English-only**. The only strings that already ship in both
English and Norwegian are the legal texts, which have their own EN/NO toggle:

- `src/terms/content.ts` — Terms of Use (EN + NO)
- `src/terms/privacy.ts` — Privacy Policy (EN + NO)

Everything else (buttons, panels, toasts, onboarding hints, the first-run
safety disclaimer, the Varsom call-to-action on the steepness layer, etc.) is
hard-coded English.

## What needs to happen

- Introduce a proper i18n layer (a small string catalogue + a language
  hook/context, or a library such as `react-i18next`) with `en` and `no`
  locales.
- Move all hard-coded UI strings into the catalogue. Known English-only spots
  added most recently and explicitly flagged with `TODO(i18n)` in code:
  - `src/components/DisclaimerModal.tsx` — first-run safety disclaimer copy.
  - `src/components/MapAttribution.tsx` — "Check the Varsom bulletin" CTA.
- Fold the existing terms/privacy EN/NO toggle into the same global language
  selection so a single control switches the whole app.
- Default the locale to Norwegian for `.no` visitors (or from the browser's
  `Accept-Language`), with an explicit switch.

## Why it matters

The primary audience is Norwegian back-country skiers. Safety-critical framing
(the disclaimer, the Varsom pointer, avalanche wording) should read naturally
in Norwegian so nothing important is lost to a language barrier.

> Grep for `TODO(i18n)` across the codebase to find the strings already marked
> for translation.
