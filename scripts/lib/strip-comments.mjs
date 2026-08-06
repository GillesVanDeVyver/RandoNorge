// Strip comments from a source file so only real code is scanned.
//
// The verify-* scripts assert things like "worker/auth.js does not contain
// `storage: "database"`". The files under test are heavily commented, and
// those comments name the very strings the checks look for — usually as a
// warning not to reintroduce them. Matching against raw source therefore finds
// the warning and reports a problem that isn't there, so every scan runs
// through here first.
//
// LINE COMMENTS MUST BE STRIPPED BEFORE BLOCK COMMENTS, and that ordering is
// the whole reason this lives in one shared file instead of being copied into
// each script.
//
// Several comments in this repo mention paths like "/api/auth/*". Strip block
// comments first and the regex reads that "/*" as the opening of a block
// comment and deletes everything up to the next "*" + "/" — which can be
// hundreds of lines away, or the end of the file. The code in between is
// silently removed, so the checks run against a string that no longer contains
// what they are looking for. They do not fail; they pass, on nothing.
//
// That happened on 2026-08-06 in scripts/verify-app-base.mjs, which quietly
// stopped checking a chunk of LoginPage.tsx. Only its negative control — which
// plants a fault and requires the check to catch it — noticed. Keep the order,
// and keep the controls.
export const stripComments = (src) =>
  src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
