// The version of each legal document, as the Worker knows it.
//
// These are a deliberate second copy of TERMS_VERSION (src/terms/content.ts)
// and PRIVACY_VERSION (src/terms/privacy.ts). The Worker cannot import those:
// they live in TypeScript modules that only the Vite build compiles, and the
// document text they carry has no business being shipped in the Worker bundle.
//
// The server needs its own copy because it is the server that records an
// acceptance. Two paths depend on that:
//
//   * "Continue with Google" — the user accepts the gate, then leaves for
//     Google and comes back through an OAuth callback that carries none of the
//     app's own state. Nothing client-side survives to report what was
//     accepted, so the create hook in worker/auth.js stamps these values.
//   * Re-acceptance — PUT /api/me/policies records "the current versions",
//     and the client must not be the authority on what "current" means, or a
//     stale or crafted request could clear the gate without the new text ever
//     being shown.
//
// Both copies are shipped by the same `npm run build && wrangler deploy`, so
// they cannot drift in production for longer than one deploy. They can very
// easily drift in the repository, though — bumping one and forgetting the
// other would leave every signed-in user either permanently gated or never
// gated. `pnpm test:policies` compares the two files and fails if they differ.
//
// So: when bumping a version, edit BOTH this file and the TypeScript one.

/** Must equal TERMS_VERSION in src/terms/content.ts. */
export const TERMS_VERSION = '2026-07-16';

/** Must equal PRIVACY_VERSION in src/terms/privacy.ts. */
export const PRIVACY_VERSION = '2026-08-08';
