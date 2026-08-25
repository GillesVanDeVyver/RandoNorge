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
//      hoisted one.
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

// Do not let Metro walk upward on its own to find packages. With pnpm the
// upward walk finds the store, where the same package exists at several
// versions, and the resolution it picks is not the one pnpm decided on. Combined
// with nodeModulesPaths above, resolution becomes exactly the two directories
// named there.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
