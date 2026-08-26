// Metro configuration for a pnpm workspace.
//
// Metro's defaults assume the app owns every file it bundles, which is false
// here in two ways that each produce a different confusing error:
//
//   1. @fjellrute/core lives at ../../packages/core, OUTSIDE this app's
//      directory. Metro only watches the project root, so an edit in core would
//      not trigger a reload — and on a cold start the resolver would report the
//      package as missing. watchFolders fixes both.
//
//   2. pnpm does not flatten node_modules. Every dependency is a symlink into a
//      content-addressed store, and hoisted packages live in the WORKSPACE root's
//      node_modules, not this app's. nodeModulesPaths has to name both, in that
//      order: the app's own first, so a version this app pins wins over a
//      hoisted one. Those two directories are an ADDITION to ordinary upward
//      resolution, not a replacement for it — see the note below, which used to
//      say the opposite and cost a build.
//
// The package this app shares is TypeScript source with no build step (see
// packages/core/package.json — deliberately no `main` and no dist/). That works
// because Metro transforms everything it bundles through babel-preset-expo,
// which handles .ts, and because Expo's Metro resolves the "exports" map, which
// is how the subpath imports (`@fjellrute/core/geometry`) find their files. It
// also means an edit in core hot-reloads on the phone with no rebuild, which is
// the whole point of not having a dist/.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// `config.resolver.disableHierarchicalLookup = true` USED TO BE HERE. It is
// deliberately absent, and this comment exists so nobody adds it back.
//
// It appears in Expo's own monorepo documentation, so it looks like the
// blessed setting, and the justification originally written here sounded
// reasonable: with pnpm the upward walk reaches the store, where a package
// exists at many versions, so pin resolution down to two known directories.
//
// That premise is false, and backwards. pnpm builds one directory per resolved
// package — node_modules/.pnpm/<name>@<version>_<hash-of-its-peers> — and fills
// its node_modules with exactly one symlink per dependency, pointing at the
// precise variant pnpm chose for THAT consumer. So the upward walk from a file
// inside a store directory finds pnpm's own answer, first, and only one of it.
// The upward walk is not a threat to pnpm's resolution; it is the mechanism
// that delivers it.
//
// Disabling it means every module any dependency imports has to be findable in
// apps/mobile/node_modules or the workspace root — and under pnpm those hold
// only what a package.json DECLARES. Transitive dependencies live in the store
// and become unreachable. expo-router imports `@expo/metro-runtime`, which it
// declares itself and which pnpm had linked correctly, and Metro returned HTTP
// 500 with "could not be found within the project" while the file sat right
// there. Expo's recipe assumes a hoisting package manager (npm, yarn) where the
// root node_modules is flat and complete. It is wrong for pnpm.
//
// The right fix for that error class is never to declare somebody else's
// dependency in this app's package.json to drag it into scope. That treats one
// symptom and leaves the next transitive import to fail the same way.

module.exports = config;
