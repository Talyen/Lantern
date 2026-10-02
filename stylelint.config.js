export default {
  ignoreFiles: ['node_modules/**', '.local/**', '.worktrees/**', 'public/vendor/**', 'dist/**', 'coverage/**', 'reports/**', '**/*.generated.*'],
  rules: {
    'property-no-unknown': true,
    'unit-no-unknown': true,
    'function-no-unknown': true,
    'no-invalid-double-slash-comments': true,
    // Consecutive fallback values are intentional browser compatibility, not duplicates.
    'declaration-block-no-duplicate-properties': [true, { ignore: ['consecutive-duplicates-with-different-values'] }],
  },
};
