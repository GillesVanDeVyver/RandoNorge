# Kartverket permission — send log and follow-up diary

The letter itself is `docs/kartverket-tile-cache-permission-request.md`. This
file is the record of what was actually sent, when, and what came back.

It exists because the request is an external dependency with an unknown reply
time that blocks Phase 5 of the mobile plan and the premium offline tier. A
request nobody can prove was sent is a request that gets re-drafted in three
months instead of chased, and the z11 cap stays in place by default.

## Status

**Sent 2026-07-21. No reply after five weeks. Follow-up drafted, not yet sent —
it was due 2026-08-11.**

| Field | Value |
| --- | --- |
| Sent on | 2026-07-21 |
| Sent from | `Fjellrute@gmail.com` |
| Sent to | `post@kartverket.no` |
| Subject | Permission request — offline caching of topo WMTS tiles (z12–18) in a commercial hiking app |
| Reference / case number, if any | none received |
| Follow-up due | 2026-08-11 (sent + 3 weeks) |
| Follow-up sent | — drafted, see the request doc, "Follow-up" section |
| Reply received | none as of 2026-08-24 |
| Outcome | open |

## What was actually sent, and how it differed from the draft

The version that went out was a shortened Norwegian-only rewrite of the drafted
letter. The draft in `kartverket-tile-cache-permission-request.md` is left as it
was, so the difference stays visible; the follow-up closes the gaps. What the
sent version left out:

- **The three numbered questions**, including the request for a written
  confirmation we can keep on file. A friendly informal reply would not be the
  artefact needed to raise `topo.maxDownloadZoom`, so the question has to be
  asked explicitly.
- **The fact that we already cap the download at z11 today.** This is the
  paragraph that shows the request comes from someone already complying rather
  than someone asking for forgiveness.
- **The scale and throttling detail** — user-initiated, one region at a time,
  six parallel requests, willing to add limits. This pre-empts reading the
  request as an intent to bulk-copy the cache.
- **The English text**, and the sender was a personal Gmail address rather than
  a SonoFit one. Both make the mail cheaper for a postmottak to leave unrouted.

## Why the silence is not necessarily a no

`post@kartverket.no` is the general postmottak, not the desk that owns tile
licensing. Kartverket is a public body, so a written inquiry does warrant a
response, and citing the original date is what turns an unrouted mail into a
journalled case. If the follow-up also goes unanswered, the next step is their
customer-service channel listed on kartverket.no rather than a third mail to the
same inbox.

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
