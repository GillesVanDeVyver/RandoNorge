# Week 4 — done

**Week 4 of the launch plan (Aug 3–9): business shell, dedicated e-mail,
feedback channel. Finished 2026-08-08,** one day inside the window. Unlike
week 3 this work is **not yet committed or deployed** — see "What is left".

## What shipped

**The business shell exists and predates the plan.** Fjellrute operates as
`VAN DE VYVER ENGINEERING`, an enkeltpersonforetak registered in
Enhetsregisteret on 2026-02-18 under organisation number **937 188 439**,
næringskode 62.100 (dataprogrammeringstjenester). It is **not** registered in
Merverdiavgiftsregisteret, which is correct: no MVA obligation arises until
50 000 kr of turnover in a twelve-month period. The launch plan's Phase 5 note
still holds — 100 subscribers at 490 kr/yr is roughly 49 000 kr, landing right
on that threshold, so the registration question returns the same month public
pricing does. Not tax advice; Skatteetaten and Altinn are the authorities.

**The privacy policy now names the controller.** §1 previously said "Fjellrute
is the data controller", and Fjellrute is a product name rather than a legal
person, so it did not satisfy GDPR art. 13(1)(a). It now names the ENK and its
organisation number in both languages. The registered address is deliberately
omitted: for an enkeltpersonforetak it is a private home, and it is already
public in Enhetsregisteret to anyone who looks up the number.

This was the change that opened `PRIVACY_VERSION` for the week; the in-app
feedback feature then landed inside the same bump, so **2026-08-08** carries
both. The version is set in three places that must agree — `src/terms/privacy.ts`,
`public/privacy.html` (twice, once per language heading) and
`worker/policyVersions.js` — and all three read `2026-08-08`. The two policy
copies were compared section by section, both languages, and match. This bump
re-presents the acceptance gate to signed-in users; doing it at alpha scale
rather than during the November spike was the point of doing it now.

**Both mailboxes receive mail — verified by live test on 2026-08-08.**
`contact@fjellrute.no` and `hei@fjellrute.no` were tested end to end. The two
mail systems are independent and it is worth keeping them apart when debugging:
outbound (verification, password reset, feedback relay) is **Resend**, finished
2026-07-21; inbound is **Cloudflare Email Routing**, finished in week 3. The
DMARC `rua=` caveat in `docs/AUTH_SETUP.md` claiming `hei@` did not exist was
stale and has been corrected, and inbound routing is now documented there
rather than existing only as folklore.

**The feedback channel shipped as a real form, not a mailto.** The first
version was a one-line `mailto:` under the card grid on the account overview.
It was replaced, correctly, by a full-width card opening `FeedbackDialog`,
which posts to `/api/feedback`; `worker/feedback.js` stores the message in D1
(migration `0008_feedback.sql`) and relays it to `FEEDBACK_TO`
(`contact@fjellrute.no`) through Resend with the sender in `Reply-To`. A
mailto asks a tester on a phone to leave the app and find a configured mail
client — three places to give up, and the launch traffic is expected to be
mostly phones.

Two consequences worth remembering. The feature stores new personal data, so
§2, §4 and §5 of the privacy policy changed with it — that coupling is why the
policy version had to move anyway. And `escapeHtml` in `worker/email.js` is now
exported, because the feedback body is free text a user typed and must go
through exactly that function rather than a second copy of it.

**Still signed-in only.** The account overview does not render for guests, so
nobody browsing without an account can reach you from inside the app. The info
button on the map screen is the natural second home if that matters before the
Facebook push.

## What is left

Nothing is on a deadline, but the first three are prerequisites for the rest
being real.

1. **Run the tests, then commit and deploy.** `pnpm test && pnpm lint`. The
   privacy checks are the ones that matter: `test:policies` compares the two
   `PRIVACY_VERSION` copies, `test:privacy` compares the two policy texts. Note
   these need Node ≥ 22.18 (see week 3's toolchain section) — they were verified
   here by an equivalent hand-rolled comparison, not by the real scripts.
2. **Apply migration `0008_feedback.sql` to `fjellrute-db-eu`** before deploying
   the Worker, or `/api/feedback` will 500 against a missing table. Answer "no"
   if wrangler offers to add a binding on your behalf — week 3 explains why.
3. **Verify the gate actually re-presents.** The version bump means the next
   sign-in should show the policy again. This path has only ever run once for
   real; watch it once rather than assuming.
4. **The five untested sign-in flows** from week 3 are still untested: Google
   sign-in, e-mail sign-up through the terms gate, resend-verification,
   forgot-password, password reset, sign-out. Password reset first — it also
   confirms Resend still delivers.
5. **Gmail spam filters for forwarded mail**, if not already added. Delivery is
   confirmed; the folder it lands in is not recorded.
6. **"Send mail as" `contact@fjellrute.no`** via Resend SMTP. Higher value now
   than in week 3: every feedback reply, not just GDPR replies, otherwise goes
   out from a personal address.
7. **The terms of service still name no legal entity** — only the privacy policy
   does. Less urgent, but if it is worth fixing, ship it together with a
   `TERMS_VERSION` bump so users are not gated twice in consecutive weeks.
8. **The Google logo decision** from week 3 is still open, and still blocks
   nothing.

## Two things not to get wrong later

**The ENK is one person's, permanently.** An enkeltpersonforetak is bound to a
single individual's fødselsnummer. It cannot be shared with a collaborator,
transferred, or used as a vehicle for someone else's revenue. If the people
working on Fjellrute and the person holding org 937 188 439 ever diverge, the
answer is a separate entity, not a second name on this one — and the right
moment to notice is before Stripe payouts start, not after.

**The controller clause and the code are now coupled.** §1 names an entity, and
§2/§4/§5 describe what the code actually stores and who it passes through. Any
new processor, any new stored field, any change of operating entity is a policy
change and therefore a `PRIVACY_VERSION` bump in three files. `pnpm test:privacy`
catches the two copies drifting; nothing catches the policy drifting from the
code except remembering that it can.
