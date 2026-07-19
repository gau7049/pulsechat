// Flat ESLint config shared by every workspace package.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    // support.js is a generated wireframe-viewer runtime (not app code, see
    // its own header comment); shot.tmp.mjs is a local one-off screenshot
    // script. Neither ships with the app or runs in CI.
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.gen.ts',
      'support.js',
      'shot.tmp.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Build Instructions §8: no `any` without a justifying comment — the
      // eslint-disable comment required to bypass this rule is that comment.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Build Instructions §8: no console.log debugging — structured logger only.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['apps/api/**/*.ts', 'prisma/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Hand-written Web Push service worker (Technical Spec §12) — runs in the
    // ServiceWorkerGlobalScope, not the browser window or Node.
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // Artillery load-test config/processor (ROADMAP M8, local-only) — plain
    // CommonJS Node scripts, not part of any workspace package.
    files: ['artillery/**/*.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
  },
  prettier,
);
