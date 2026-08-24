// Where things live, for the verification harness.
//
// WHY THIS FILE EXISTS. Phase 1 of the mobile build plan turned the repository
// into a pnpm workspace and moved the browser app down into apps/web. Half of
// what these harnesses read moved with it (src/, public/) and half deliberately
// did not (worker/, migrations/, docs/, wrangler.jsonc — all root-level because
// the Worker is deployed from the root). Every script used to derive one `root`
// and join both kinds of path onto it. Nine copies of a two-way split is nine
// chances for one of them to be wrong in a way that reads as a passing test, so
// the split is stated once, here.
//
// The asymmetry is the point and is worth keeping in mind when adding a check:
// a path under src/ or public/ is a path into ONE app and belongs on WEB, while
// a path into worker/ or migrations/ describes the service both apps talk to
// and belongs on REPO. Getting it backwards throws ENOENT rather than passing
// vacuously, which is the failure mode we want.
//
// CORE is the third case and the one most likely to be picked wrongly, because
// it is also a src/. The test is not what the file does but who else has to
// agree with it: the terms text, the tile arithmetic and the route geometry are
// checked here precisely because the Worker and the phone app must match them,
// so they are shared, so they are CORE. A path is only WEB if the answer would
// be allowed to differ on a phone.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root: worker/, migrations/, docs/, scripts/, wrangler.jsonc.
 *
 *  Three levels up, because this file is scripts/lib/tree.mjs — one deeper than
 *  the harnesses that import it, which each walk up two. */
export const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The browser app package: its src/ and public/. */
export const WEB = join(REPO, 'apps/web');

/** The platform-free package both apps compile: geometry, parsers, tile maths,
 *  the API clients, i18n, types and the terms and privacy text. */
export const CORE = join(REPO, 'packages/core');
