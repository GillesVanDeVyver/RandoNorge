# RandoNorge — Premium UI Design Plan

*A design audit and phased roadmap for elevating the look and feel to a premium, high-end backcountry tool — while keeping it easy to use. No code changes are included here; this is a plan.*

**Direction agreed:** Dark "alpine glass" aesthetic, fully responsive (phone → desktop), delivered as this written plan.

---

## 1. What the app is, and why that matters for design

RandoNorge is a backcountry ski-touring and route planner for Norway. The map is the product: a Kartverket topographic base, an NVE steepness/runout overlay, a seNorge snow-depth overlay, a freehand-drawn route, and a synced elevation + snow-depth profile along the bottom. The closest design north stars are FATMAP, Gaia GPS, Strava's route builder, and Apple Maps' newer "floating glass" UI.

The single most important design principle for this category: **the map is the hero, and the chrome should float above it without competing.** Premium feel here comes less from decoration and more from restraint, consistency, and confident handling of data (steepness colors, elevation, snow). The current build already does the hard part well — accurate steepness bands, runout coloring, true-scale elevation exaggeration, a custom date picker. The gap is purely visual cohesion: right now there are several different "mini design languages" stacked on one screen.

---

## 2. Design audit — current state

The engineering is strong; the inconsistency is the issue. Concretely:

**Competing accent colors.** There is no single brand color. The toolbar's active state is magenta (`#e91e63`), the map controls are navy (`#1e3a5f`), the snow date bar is a different navy (`#0b3a5c`), and the profile date picker is blue (`#3478f6`). Four unrelated "primary" colors appear on one screen. A premium product reads as one confident voice.

**Three different button systems.** The toolbar uses 36px rounded-square white buttons; the map controls use 40px navy circles; the snow date bar uses transparent text-over-navy buttons with stacked icon + label. Each cluster looks like it came from a different app.

**Inconsistent surfaces.** Floating panels use `rgba(255,255,255,0.95)`, `0.97`, `0.9`, and solid navy, with shadows of `0 2px 8px`, `0 2px 6px`, and `0 -2px 8px`, and radii of `4px`, `6px`, and `8px`. None of these are coordinated, so the panels don't feel like members of the same family.

**No spacing or type scale.** Padding/margins are scattered (`12`, `8`, `6`, `4`) without a system, and typography is raw `system-ui` with ad-hoc font sizes (`11`, `12`, `13`, `14`, `16`). Stat numbers are not tabular, so values jitter horizontally as the route changes.

**Unrefined details that break the premium spell.** The profile collapse control is a tiny `▲`/`▼` glyph in an 18px tab; "Clear route" uses the native `window.confirm()` dialog (an instant immersion-breaker); recharts tooltips are styled with inline objects duplicated in two places; there are no focus-visible rings; hover is a flat background swap with no elevation or motion; and the search field appears as a bare white rectangle with no relationship to the button stack.

**No app identity.** There is no wordmark, no loading state with personality, and no empty/onboarding state ("Draw a route to begin"). Premium tools establish a quiet sense of place.

None of these are bugs — the app works and is thoughtfully built. They're the difference between "a capable hobby project" and "a product someone would pay for."

---

## 3. The premium direction: "Alpine Glass"

A dark, frosted, translucent control layer floating over a full-bleed map. Think cold, clean, high-altitude: deep slate-blue glass, a single confident accent, crisp tabular data, and soft depth from layered shadows and `backdrop-filter` blur. Color is reserved almost entirely for *meaning* — steepness bands, ascent/descent, snow — so the data stays the brightest thing on screen.

Three rules to hold the line:

1. **One accent, used sparingly.** Everything interactive shares a single accent; semantic colors (steepness, ascent green, descent red, snow blue) are the only other saturated colors allowed.
2. **One control geometry.** Every button, in every cluster, uses the same size, radius, surface, and states.
3. **The map is never tinted by chrome.** Glass panels darken and blur what's *behind* them, but the live map area stays untouched and bright.

---

## 4. Proposed design-token system

Define these once (CSS custom properties on `:root`, consumed by every CSS module). This is the backbone of the whole effort — most later steps are just "apply tokens."

**Color — surfaces (dark glass)**

- `--surface-1`: `rgba(17, 24, 33, 0.72)` — primary glass panel (with `backdrop-filter: blur(20px) saturate(140%)`)
- `--surface-2`: `rgba(28, 38, 51, 0.85)` — raised elements (popovers, tooltips)
- `--surface-hover`: `rgba(255, 255, 255, 0.08)` — hover wash on glass
- `--surface-active`: `rgba(255, 255, 255, 0.14)` — pressed/selected wash
- `--hairline`: `rgba(255, 255, 255, 0.12)` — 1px borders between glass and map

**Color — accent and semantics**

- `--accent`: a confident alpine teal/cyan, e.g. `#3DD6C4` (or a glacier blue `#4FA8E0` if teal feels too playful). Used for the active tool, focus rings, selected calendar day, and the route line.
- `--accent-contrast`: `#06231f` (text/icon on accent fills)
- Ascent `#34C759`, Descent `#FF6B5E`, Snow `#7FB4E6` — refined, slightly desaturated versions of the current values so they sit calmly on dark glass.
- Keep the NVE steepness bands exactly as-is — they're a domain standard and must not change for safety/legibility reasons.

**Color — text on dark**

- `--text-1`: `rgba(255,255,255,0.95)` (primary), `--text-2`: `rgba(255,255,255,0.65)` (labels), `--text-3`: `rgba(255,255,255,0.40)` (disabled).

**Typography**

- Ship one refined variable sans (Inter is the safe, free choice; or keep `system-ui` but commit to one ramp). Add `font-feature-settings: "tnum" 1` (tabular numbers) for all stats and axis ticks so numbers don't shift.
- Type ramp: `--text-xs 11px / --text-sm 13px / --text-base 15px / --text-lg 20px / --text-xl 28px`. Stat values use `--text-xl` with a tight `font-weight: 600`; labels use `--text-xs` uppercase with `letter-spacing: 0.06em` (the current stat label treatment is already good — promote it to a token).

**Spacing scale** (4px base): `--space-1 4 / -2 8 / -3 12 / -4 16 / -6 24 / -8 32`. Replace every ad-hoc pixel value with one of these.

**Radius**: `--radius-sm 8px / --radius-md 12px / --radius-lg 16px / --radius-pill 999px`. Panels use `lg`, buttons use `md` (or `pill` for the round map controls — pick one and commit).

**Elevation (layered soft shadows for depth on glass):**

- `--shadow-1`: `0 1px 2px rgba(0,0,0,0.3)`
- `--shadow-2`: `0 4px 16px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.4)`
- `--shadow-float`: `0 8px 32px rgba(0,0,0,0.45)` for the profile card and popovers.

**Motion**: `--ease: cubic-bezier(0.2, 0, 0, 1)`; `--dur-fast 120ms / --dur 200ms / --dur-slow 320ms`. Standardize all transitions on these and add `prefers-reduced-motion` fallbacks.

---

## 5. Component-by-component recommendations

**Global / map.** Wrap all floating UI in the glass surface tokens. Add a subtle bottom-edge gradient scrim behind the profile card so it reads cleanly over both bright snowfields and dark forest tiles. Restyle Leaflet's attribution to a tiny, low-opacity pill that matches the glass language instead of the default white box. Consider a faint vignette at the very screen edges to make the floating chrome "pop" without touching the map center.

**Unify the three control clusters into one button system.** Pick a single button: 40px, `--radius-md`, `--surface-1` glass, `--hairline` border, `--text-1` icon, with hover = `--surface-hover` + 1px lift, active/selected = `--accent` fill with `--accent-contrast` icon, and a visible `--accent` focus ring. Apply this identically to the toolbar (draw/erase/clear), the map controls (overlay/search/fullscreen/locate/zoom), and the snow date bar. The result: three clusters that obviously belong together.

**Toolbar (top-left).** Replace the magenta active state with the accent. Group the buttons in a single glass "pill" or rounded container with hairline dividers rather than separate floating buttons. Add tooltips that match the glass tooltip style (the native `title=` is fine functionally but looks unbranded — a small styled tooltip is a cheap premium win).

**Map controls (top-right).** Keep the vertical stack but in glass, not solid navy. The search affordance is the weakest element: when expanded it should slide open as a glass field that visually connects to the search button (shared container, accent caret, a result dropdown styled like the date popover). Add a result list rather than silently jumping to the first hit.

**Overlay toggle.** Currently a single button that swaps snowflake/mountain icons — functional but ambiguous about current state. Consider a small segmented control ("Steepness | Snow") in glass so the active layer is always legible at a glance. This also scales if a third overlay is ever added.

**Snow date bar (top-center).** This is the most visually divergent element (solid dark navy, stacked icon+label text buttons, chevron glyphs `‹‹‹`). Rebuild it as one glass pill with the unified button geometry, replacing the `‹‹‹` text glyphs with proper chevron icons (you already have a clean Lucide-style icon set — add double/triple chevron or rewind icons). Keep the genuinely nice day/week/year stepping logic; just reskin it. The "↺ Now" reset is a good touch — keep it, styled as the accent.

**Profile panel (bottom).** This is the biggest premium opportunity.

- Float it as a rounded glass *card* with margin from the screen edges (currently it's a full-bleed bar pinned flush to the bottom). A card with `--radius-lg` top corners and `--shadow-float` reads dramatically more premium.
- Replace the tiny `▲`/`▼` collapse tab with a proper grabber handle (a short rounded bar) plus a smooth height transition; support drag-to-resize later.
- Promote the stats row to the hero data display: large tabular `--text-xl` values, `--text-xs` uppercase labels, accent/semantic colors for ascent/descent. Add a couple more derived stats premium users expect: max slope angle along the route, alongside the gain/loss already present — present them with small inline icon glyphs.
- Move the recharts inline tooltip styling into a single shared styled component using the tokens (it's currently duplicated in two `Tooltip` blocks). Tooltip = `--surface-2` glass, hairline border, tabular numbers.
- Refine the two stacked charts: on narrow screens, the stack is too tall — switch to a small segmented toggle ("Elevation | Snow") showing one chart at a time, or a compact combined view. On desktop, the two-chart stack is fine. The elevation gradient fill (rock tones) and snow gradient are tasteful — keep them; just make sure the grid lines and axis text adopt the dark-theme text tokens (currently `#666`/`#e0e0e0`, which will vanish or clash on dark glass).
- The snowflake pattern fill is a charming detail; on dark glass it'll need its opacity/contrast retuned so it reads as texture, not noise.

**Replace `window.confirm()`** for "Clear route" with a small in-app confirm — either a glass popover anchored to the trash button ("Clear route? Clear · Cancel") or an undoable toast ("Route cleared · Undo"). The undo pattern is more premium and less interruptive.

**States with personality.** Add a quiet empty state when no route exists ("Draw a route to see its profile" with the pencil icon), and replace the plain "Loading elevations…" text with a subtle shimmer/skeleton in the stats and chart areas. Style the error states ("Elevation unavailable") with a small icon and the muted text token rather than bare gray text.

**Iconography.** The Lucide-style set is consistent and good. Standardize stroke width and size via shared `baseProps` (already done — extend it), and add the few missing icons (segmented-control glyphs, chevrons for the date bar, grabber). Ensure the custom snowflake/mountain match the 2px stroke of the rest.

---

## 6. Responsive plan (phone → desktop)

The current layout is desktop-implicit (absolute-positioned clusters, a 220px search field, a full-width bottom bar). For a credible responsive experience:

- **Touch targets:** bump the unified button to a 44px hit area on coarse pointers (`@media (pointer: coarse)`), even if the visual size stays 40px.
- **Control placement on phones:** collapse the top-right control stack into a single "tools" button that expands a glass sheet, or move zoom to gesture-only and keep just overlay-toggle + locate + search visible. Avoid three separate clusters crowding a small screen.
- **Profile panel on phones:** make it a bottom sheet with three snap points (peek = stats only, half = one chart, full = both charts), using the grabber to drag between them. This is the standard premium mobile-map pattern and directly reuses the collapse logic you already have.
- **Snow date bar on phones:** dock it into the bottom-sheet header (or just above it) rather than floating at the top center where it collides with the search field.
- **Safe areas:** respect `env(safe-area-inset-*)` so controls don't sit under notches/home indicators.
- Use a small set of breakpoints (e.g. `≤640`, `641–1024`, `≥1025`) driven by the same tokens.

---

## 7. Accessibility & polish (premium = accessible)

- Add visible `:focus-visible` rings (accent, 2px, offset) to every interactive element — currently absent.
- Verify contrast: text on dark glass should clear WCAG AA (the `--text-2`/`--text-3` tokens above are tuned for this; check against the *brightest* possible map behind the glass, e.g. snowfields, since `backdrop-filter` lets it through).
- Ensure the steepness color bands remain distinguishable and consider an optional colorblind-safe legend, given this is safety-relevant avalanche-terrain data.
- Keep keyboard support (Esc already exits modes — good); add arrow-key date stepping in the popover and proper `aria-pressed` on toggle buttons.
- Respect `prefers-reduced-motion` for the panel/sheet transitions.
- Add a small, persistent legend for the active overlay (steepness bands / snow scale) — premium *and* a real usability win for interpreting the map.

---

## 8. Phased roadmap

**Phase 0 — Foundation (highest leverage, do first).** Introduce the token system (color, type, spacing, radius, shadow, motion) as CSS variables and wire up Inter (or commit to `system-ui`). This unblocks everything else and, on its own, will already make the app feel more deliberate. *No layout changes yet.*

**Phase 1 — Unify the chrome.** Convert all three control clusters to the single glass button system and one accent. Reskin the snow date bar with real chevron icons. This eliminates the "four apps on one screen" problem and is the biggest perceived-quality jump for the least risk.

**Phase 2 — The profile card.** Float it as a glass card, add the grabber + smooth collapse, upgrade the stats typography to tabular hero numbers, centralize the chart tooltip, and retune chart grid/axis/snow-pattern colors for dark glass.

**Phase 3 — Interactions & states.** Replace `window.confirm()` with an undo toast, add empty/loading/error states with personality, styled tooltips, focus rings, and the overlay segmented control + legend.

**Phase 4 — Responsive.** Bottom-sheet behavior with snap points, mobile control consolidation, touch targets, and safe-area insets.

**Phase 5 — Identity & finish.** A subtle wordmark, attribution restyle, edge scrim/vignette, and a final pass for motion consistency and `prefers-reduced-motion`.

A natural sequencing principle runs through this: each phase is shippable on its own, and earlier phases (tokens, unified chrome) deliver most of the premium perception before the more involved responsive and interaction work.

---

## 9. What to deliberately keep

The steepness/runout color science, the true-1:1 elevation exaggeration logic, the custom date popover behavior (avoiding the native picker's spurious change events), the synced hover between chart and map, the gradient chart fills, and the tile-request tuning for the seNorge layer are all genuinely good and should survive the redesign untouched. The goal is to reskin and unify, not to rebuild what already works.
