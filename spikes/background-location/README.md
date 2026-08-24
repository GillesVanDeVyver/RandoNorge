# Spike 0b — does free background location survive a real tour?

**Question.** Can `expo-location` + `expo-task-manager` record continuously for
six hours with the screen off and the phone in a pocket, on the phones this
audience carries — and what does it cost in battery per hour?

**Why it matters.** Phase 4 is the safety-critical feature: a recorded track is
what tells you where you came up, in a whiteout, when the app is the only thing
that knows. A recorder with silent forty-minute holes is worse than no recorder,
because it looks like it worked. If free background location cannot hold a
recording, `react-native-background-geolocation` costs money and that belongs in
the plan now rather than as a surprise in Phase 4.

## This one needs a development build

Expo Go cannot do background location — it lacks the iOS entitlement and the
Android foreground-service declaration. It will grant foreground permission and
then record nothing once the screen locks, which is indistinguishable from the
failure being hunted. A false FAIL here would cost money for no reason, so:

```sh
./setup.sh
cd app && npx expo run:android      # or npx expo run:ios
```

Android first: it needs no paid programme, and it is where the interesting
failures live.

## Protocol

1. Install the development build. Grant location **"Allow all the time"** when
   asked — anything less measures nothing.
2. **Turn battery optimisation off for the app.** On Samsung: Settings → Battery
   → Background usage limits → check the app is not in "Sleeping apps" or
   "Deep sleeping apps". On Xiaomi: Settings → Apps → the app → Battery saver →
   "No restrictions", and lock it in Recents. Note what you had to do; a
   production app has to talk the user through exactly these screens, and that
   onboarding is a Phase 4 deliverable in itself.
3. Note the battery percentage. Tap **Start**. Lock the screen. Pocket it.
4. Walk for six hours, or as close as you can manage. A ski tour is the real
   test; a long walk is an acceptable substitute.
5. **Do not open the app during the walk.** Foregrounding it can revive a task
   the OS had killed, which destroys the measurement. The sticky notification
   tells you it is alive without unlocking.
6. Back home: **Stop**, then **Export**, and send the file to your machine.
7. `node analyse.mjs ~/Downloads/spike-fixes.jsonl`

## Then run it again on a hostile phone

A PASS on a Pixel or an iPhone says little. Samsung and Xiaomi ship the most
aggressive battery managers, and this audience buys them. Two clean recordings on
two OEMs is the bar for believing a PASS; one clean recording on stock Android is
not.

Also worth one run each:

- **Aeroplane mode with GPS on** — no cell signal is the normal condition on a
  tour. GPS should keep working; if the task dies without network, that is a
  finding.
- **Cold** — a phone at −10 °C in an outside pocket loses battery far faster than
  the analyser's %/hour suggests. Note the temperature you tested at.

## What the numbers mean

`analyse.mjs` prints a verdict, but the judgement behind it is:

- **No gaps over 60 s, six hours** — free is enough. Phase 4 uses `expo-location`.
- **Coverage above 98%, a few short gaps** — marginal. A gap loses distance and
  ascent, so a summary is wrong; a drawn line on a map is merely bent. Decide
  which of those Fjellrute promises, and write the decision down.
- **Anything worse** — buy the library, and put its cost in the budget section of
  the plan. Note that this is the one paid dependency the plan anticipated.
- **Battery over ~10%/hour** — the recording is technically fine and practically
  unusable on a full day. Look at whether `timeInterval` can be relaxed (this
  spike deliberately asks for a fix every 10 s, which is more than a production
  recorder needs).
