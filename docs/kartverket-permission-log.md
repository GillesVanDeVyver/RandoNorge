# Kartverket permission — send log and follow-up diary

The letter itself is `docs/kartverket-tile-cache-permission-request.md`. This
file is the record of what was actually sent, when, and what came back.

It exists because the request is an external dependency with an unknown reply
time that blocks Phase 5 of the mobile plan and the premium offline tier. A
request nobody can prove was sent is a request that gets re-drafted in three
months instead of chased, and the z11 cap stays in place by default.

## Status

**Not sent.** This is the one Phase 0 item that cannot be done from a keyboard
here: it needs an email from a SonoFit address.

## To do, once, today

1. Send the letter body from `contact@fjellrute.no` (or another SonoFit address)
   to `post@kartverket.no`, subject line as written in the draft.
2. Fill in the table below.
3. Put a calendar reminder three weeks out. Kartverket answer, but a request
   routed to a Geovekst licensee can go quiet, and the polite follow-up is what
   moves it.

| Field | Value |
| --- | --- |
| Sent on | |
| Sent from | |
| Sent to | `post@kartverket.no` |
| Subject | Permission request — offline caching of topo WMTS tiles (z12–18) in a commercial hiking app |
| Reference / case number, if any | |
| Follow-up due | (sent + 3 weeks) |
| Follow-up sent | |
| Reply received | |
| Outcome | |

## Outcomes and what each one means

- **Permitted under existing terms.** Raise `topo.maxDownloadZoom` from 11 to 16
  in `packages/core/src/offline/layers.ts`, save the reply as a PDF next to this
  file, and quote its date in `docs/DATA_LICENSES.md`. Phase 5 unblocks fully.
- **Permitted with conditions.** Write the conditions here verbatim before
  implementing them — attribution wording, cache lifetime, volume ceilings. A
  condition remembered loosely is a condition breached later.
- **Needs a separate agreement with a Geovekst licensee.** Log the contact and
  start that thread; keep the z11 cap meanwhile. Phase 5 can still be built and
  shipped at z11 for the other layers, with topo detail switched on by a one-line
  change when the agreement lands.
- **Refused.** Offline topo stays at z11. Then the offline feature has to be
  re-pitched on the layers we may cache, and the premium tier's headline feature
  needs rethinking — a decision for the pricing plan, not for the code.

## Why the cap is where it is

Kartverket's terms of use put the topo cache at zoom 12–20 inside the Geovekst
cooperation's data, and copying that data — as opposed to displaying it live — is
what needs the licensees' permission. z11 is therefore the highest zoom we can
copy to a user's device without asking. It is also roughly 1:250,000 on screen:
enough to see that a valley exists, not enough to ski down it.
