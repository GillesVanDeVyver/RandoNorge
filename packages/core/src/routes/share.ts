// The public link to a shared route or tour.
//
// Lifted verbatim from `shareUrlFor` in apps/web/src/Root.tsx when the phone's
// saved-routes list gained the same copy-link button. One change, and it is the
// reason this file exists rather than an import: the web read the origin off
// `window.location`, and this package may not touch `window` (see
// scripts/verify-core-package.mjs, which fails the build if it does). The origin
// is a parameter now. The web passes window.location.origin; the phone passes
// API_BASE, which is the same host — one Cloudflare Worker serves both the site
// and /api/*, so the origin routes are fetched from is the origin they are
// shared from.

/** Which public namespace the slug lives in: routes are /r/, tours are /t/. */
export type ShareKind = 'r' | 't';

export interface ShareUrlInput {
  /** Scheme + host, no trailing slash: 'https://fjellrute.no'. */
  origin: string;
  kind: ShareKind;
  /** Whether the owner has actually shared it. */
  isShared: boolean | undefined;
  /** The unguessable slug the server minted on first share. */
  slug: string | null | undefined;
  /** The owner's public handle. */
  username: string | null | undefined;
}

/**
 * /u/<username>/(r|t)/<slug>, or undefined.
 *
 * Undefined until the item is shared (has a slug) AND the owner's handle is
 * known — which is what hides the row's copy-link button in the meantime. Three
 * separate reasons to have no link, one return value, because no caller has
 * ever wanted to tell them apart: there is either a link to copy or there is
 * not.
 *
 * The slug is not encoded, matching the web: the server mints it from a
 * URL-safe alphabet. The handle is, because a human chose it.
 */
export function publicShareUrl({
  origin,
  kind,
  isShared,
  slug,
  username,
}: ShareUrlInput): string | undefined {
  if (!isShared || !slug || !username) return undefined;
  return `${origin}/u/${encodeURIComponent(username)}/${kind}/${slug}`;
}
