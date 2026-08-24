import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `.wrangler` holds wrangler's own bundles of the Worker, left behind by
  // `wrangler dev`. Linting them reported errors in generated code that no
  // edit here could fix, and their number changed with how many dev sessions
  // had run — enough noise to hide a real problem.
  //
  // `spikes` holds the two throwaway Expo apps from Phase 0 of the mobile build
  // plan. They are React Native, not React DOM: the browser globals below, the
  // react-refresh/vite rules and the DOM assumptions all describe a different
  // platform, so what this config reports there is mostly about the config. They
  // are also outside the pnpm workspace and have no node_modules until
  // `spikes/*/setup.sh` runs, which would otherwise make `pnpm lint` — and so
  // the pre-push gate — depend on whether a spike happened to be scaffolded.
  globalIgnores(['dist', '.wrangler', 'spikes']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
