import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { importBoundaries, noRestrictedDynamicImports, noUnownedWebStorage, requireDisableReason } from './eslint/rules.mjs';

export default [
  { ignores: ['node_modules/**', '.local/**', '.worktrees/**', 'public/vendor/**', 'dist/**', 'coverage/**', 'reports/**', '**/*.generated.*'] },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    ...eslint.configs.recommended,
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
    plugins: { lantern: { rules: { 'no-restricted-dynamic-imports': noRestrictedDynamicImports, 'no-unowned-web-storage': noUnownedWebStorage, 'require-disable-reason': requireDisableReason } } },
    rules: {
      ...eslint.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'lantern/require-disable-reason': 'error',
    },
  },
  { files: ['scripts/**/*.{js,mjs,cjs}', 'eslint/**/*.{js,mjs}', 'electron/**/*.cjs', '*.{js,cjs,ts}'], ignores: ['scripts/assets/mixamo/mixamo-browser-download.js'], languageOptions: { globals: globals.node } },
  // This source is injected into the signed-in browser; the collector fills its placeholder.
  { files: ['scripts/assets/mixamo/mixamo-browser-download.js'], languageOptions: { globals: { ...globals.browser, __COMPLETED__: 'readonly' } } },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    // TypeScript owns name resolution and unused variables for its source set.
    rules: {
      ...tseslint.configs.eslintRecommended.rules,
      'no-undef': 'off', 'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 }],
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vite.config.ts', 'vitest.config.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-spread': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: false }],
      'lantern/no-unowned-web-storage': 'error',
      '@typescript-eslint/unbound-method': 'error',
    },
  },
  {
    files: ['src/gameplay/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', importBoundaries.gameplay],
      'lantern/no-restricted-dynamic-imports': ['error', importBoundaries.gameplay],
    },
  },
  {
    files: ['src/rendering/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', importBoundaries.rendering],
      'lantern/no-restricted-dynamic-imports': ['error', importBoundaries.rendering],
    },
  },
];
