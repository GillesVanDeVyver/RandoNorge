# Phase 0 spikes — throwaway, on purpose

These two apps exist to answer one question each, on real phones, before any
mobile code is written that depends on the answer. Neither is meant to ship, be
tested, be linted or be kept in step with the rest of the repo. They are
deliberately outside the pnpm workspace (`pnpm-workspace.yaml` lists only
`apps/*` and `packages/*`), so a root `pnpm install` neither installs Expo nor
notices these directories at all.

| Spike | Question | Kills | Answer goes in |
| --- | --- | --- | --- |
| `webview-3d/` | Does MapLibre GL JS in a WebView hold up on a cheap Android? | Phase 6, and the whole 3D-on-mobile approach | `webview-3d/RESULTS.md` |
| `background-location/` | Does free `expo-location` background recording survive a real tour? | Phase 4, or costs money to fix | `background-location/RESULTS.md` |

Both scaffold themselves with `create-expo-app` at the version current on the
day you run them (`./setup.sh`), rather than pinning an Expo SDK here that would
be stale by the time anybody reads this. The part worth keeping is
`template/App.tsx` in each — that is the actual spike; the scaffold around it is
disposable and git-ignored.

The third Phase 0 item is not code: send the Kartverket letter
(`docs/kartverket-tile-cache-permission-request.md`) and log the date in
`docs/kartverket-permission-log.md`. It gates offline maps at z11 until it is
answered, and the reply time is outside our control, which is exactly why it
belongs at the very start.

## When these are done

Write the answer down in each `RESULTS.md`, even — especially — if the answer is
"no". A spike that is run but not recorded gets re-run in three months by
someone who no longer remembers which phone stuttered. Then delete the `app/`
scaffolds; the results outlive the code.
