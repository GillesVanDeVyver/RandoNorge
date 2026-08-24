// The platform this package is allowed to assume.
//
// WHY IT IS WRITTEN OUT BY HAND. tsconfig.json here sets `lib: ["ES2023"]` and
// `types: []`, which is what makes `tsc -b` refuse a module that reaches for
// `document` or `OffscreenCanvas`. But ES2023 is only the language: it has no
// `fetch` either, and every API client in this package needs one. Adding "DOM"
// back would bring `fetch` along with the twelve thousand lines of browser that
// the restriction exists to keep out, and `types: ["node"]` would trade them
// for `process` and `Buffer` — equally absent on React Native, just less
// obviously so.
//
// So the third option: name the intersection. Everything declared below exists,
// with these signatures, in a browser, in a Cloudflare Worker, in Node 18+ and
// in React Native (Hermes). That makes this file the package's contract with
// its hosts, and it is short on purpose — each addition is a promise every
// future platform has to keep.
//
// The declarations are deliberately narrower than the real ones: only the
// members this package actually uses. A module that needs `res.headers` will
// not compile, and the right response to that is to add `headers` here after
// checking React Native has it — not to widen the lib.
//
// HOW TO CHECK THIS IS STILL TRUE. scripts/verify-core-package.mjs asserts that
// no file here mentions a browser- or Node-only global, so the boundary is
// tested rather than merely declared.

/** Only the members this package reads off a response. */
interface Response {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  blob(): Promise<unknown>;
}

interface RequestInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Passed through to fetch; never constructed or inspected here. */
interface AbortSignal {
  readonly aborted: boolean;
}

interface AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare const AbortController: {
  new (): AbortController;
};

declare const URLSearchParams: {
  new (init: Record<string, string>): { toString(): string };
};

declare function fetch(
  input: string,
  init?: RequestInit,
): Promise<Response>;
