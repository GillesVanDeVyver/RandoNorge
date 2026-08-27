# Running Fjellrute on a phone

The commands, in order, with nothing else. Reasons for all of it are in
`README.md`; when the two disagree, README.md is right and this file is stale.

All paths are from the repository root.

## Once, ever

```sh
pnpm install
apps/mobile/setup.sh
```

## Once per phone (and again only when a native dependency changes)

```sh
cd apps/mobile
npx eas-cli@latest build --profile development --platform android
```

`eas-cli`, not `eas` — `npx eas` is a different package and fails with
"could not determine executable to run".

Open the URL EAS prints on the phone and install the APK.

## Every time

Two terminals, both from the repository root:

```sh
npx wrangler dev --ip 0.0.0.0 --port 8787   # backend
pnpm -C apps/mobile start                   # Metro
```

Then open the installed app. Phone and laptop must be on the same Wi-Fi.

The login screen prints the backend host it chose. If it is wrong, edit
`LAN_API` in `src/config/api.ts`. Sign in with an account made at fjellrute.no;
there is no sign-up on the phone.

## Checks

```sh
pnpm -C apps/mobile typecheck     # not part of the root `pnpm build`
node scripts/verify-mobile-app.mjs
pnpm test                         # includes the above
```

## When something is wrong

| Symptom | First thing to check |
|---|---|
| Correct password rejected | The deep-link scheme. `pnpm test` catches a mismatch. |
| Request times out, nothing in the Worker log | Wi-Fi isolation, or `--ip 0.0.0.0` missing. |
| Blank map, app otherwise fine | Tiles, not the app. Check the Worker log for the proxy routes. |
| `app.json` modified after `setup.sh` | Expected. `expo install --fix` re-serializes it — read the diff. |
