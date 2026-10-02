import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { noUnownedWebStorage, requireDisableReason } from './eslint/rules.mjs';

export default [
  { ignores: ['node_modules/**', '.local/**', '.worktrees/**', 'public/vendor/**', 'dist/**', 'coverage/**', 'reports/**', '**/*.generated.*'] },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    ...eslint.configs.recommended,
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
    plugins: { lantern: { rules: { 'no-unowned-web-storage': noUnownedWebStorage, 'require-disable-reason': requireDisableReason } } },
    rules: {
      ...eslint.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'lantern/require-disable-reason': 'error',
    },
  },
  { files: ['scripts/**/*.{js,mjs,cjs}', 'eslint/**/*.{js,mjs}', 'electron/**/*.cjs', '*.{js,ts}'], ignores: ['scripts/assets/mixamo/mixamo-browser-download.js'], languageOptions: { globals: globals.node } },
  // This source is injected into the signed-in browser; the collector fills its placeholder.
  { files: ['scripts/assets/mixamo/mixamo-browser-download.js'], languageOptions: { globals: { ...globals.browser, __COMPLETED__: 'readonly' } } },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    // TypeScript owns name resolution and unused variables for its source set.
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off' },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'lantern/no-unowned-web-storage': 'error',
    },
  },
  {
    files: ['src/gameplay/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['three', 'three/**', '**/rendering', '**/rendering/**', '**/ui', '**/ui/**'], message: 'Gameplay uses numeric interfaces and level data; keep three.js, rendering and UI in their owners.' }] }],
    },
  },
  {
    files: ['src/rendering/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/ui', '**/ui/**'], message: 'Rendering must not import UI; coordinate them through clearing callbacks.' }] }] },
  },
];
