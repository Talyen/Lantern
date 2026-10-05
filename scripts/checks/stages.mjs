import { probeOwners } from '../materials/probe.mjs';
// Change-aware stage selection; full validation remains opt-in locally.
export function checkStages(files, args = {}) {
  const node = process.execPath;
  const full = !!args['--full'];
  const docsOnly = files.length > 0 && files.every(name => name.endsWith('.md'));
  const code = !docsOnly && (files.length === 0 || files.some(name => /\.(?:[cm]?js|ts|py|json)$/.test(name)));
  const docs = full || files.some(name => name.endsWith('.md') || name === 'package.json');
  const levels = full || files.some(name => /^src\/levels\/|^assets\/(?:library-selection|lighting-bakes|environment-surfaces|asset-reviews|playable-characters|textures\/environment\/manifest)|^src\/gameplay\/equipment\.ts|^scripts\/assets\/review\//.test(name));
  const lintSetup = files.some(name => ['package.json', 'package-lock.json', 'scripts/lint.mjs'].includes(name));
  const python = full || !files.length || lintSetup || files.some(name => name.endsWith('.py') || name === 'ruff.config.json');
  const css = full || !files.length || lintSetup || files.some(name => name.endsWith('.css') || name === 'stylelint.config.js');
  const lintPolicy = full || files.some(name => /^eslint\//.test(name) || ['eslint.config.js', 'scripts/check-rendering.mjs', 'scripts/lint.mjs', 'ruff.config.json', 'stylelint.config.js'].includes(name));
  const materials = full || files.some(name => /^src\/(?:assets\/(?:material-validation|environment-surfaces|asset-library)|rendering\/(?:surface-detail|material-|stone-surface|woodland-ground))|^scripts\/assets\/surfaces\/|^assets\/(?:material-recipes|textures\/environment)/.test(name));
  const preparedLighting = files.some(name => ['scripts/levels/prepared-lighting.mjs', 'scripts/levels/prepared-lighting.test.mjs', 'src/levels/lighting-preparation.ts', 'scripts/assets/stage-library-build.mjs'].includes(name));
  const nativeMaterials = files.some(name => probeOwners.includes(name));
  return [
    ...(!docsOnly || full ? [['rendering', node, ['scripts/check-rendering.mjs']]] : []),
    ...(docs ? [['docs', node, ['scripts/check-docs.mjs']]] : []),
    ...(code || full ? [['types', node, ['node_modules/typescript/bin/tsc', '--noEmit']]] : []),
    ...(code || full ? [['lint', node, ['scripts/lint.mjs', '--javascript']]] : []),
    ...(python ? [['lint-python', node, ['scripts/lint.mjs', '--python']]] : []),
    ...(css ? [['lint-css', node, ['scripts/lint.mjs', '--css']]] : []),
    ...(lintPolicy ? [['lint-policy', node, ['--test', 'eslint/rules.test.mjs']]] : []),
    ...(full ? [['asset-imports', node, ['--test', 'scripts/lib/asset-imports.test.mjs']]] : []),
    ...(full ? [['asset-review-store', node, ['--test', 'scripts/assets/review/store.test.mjs']]] : []),
    ...(full ? [['workflow', node, ['--test', 'scripts/agents/workflow.test.mjs', 'scripts/agents/source-storage.test.mjs']]] : []),
    ...(full ? [['tests', node, ['node_modules/vitest/vitest.mjs', 'run']]] : []),
    ...(preparedLighting ? [['prepared-lighting-contract', node, ['--test', 'scripts/levels/prepared-lighting.test.mjs']]] : []),
    ...(levels ? [['levels', node, ['scripts/levels/check.mjs', ...(args['--base'] ? ['--base', args['--base']] : [])]]] : []),
    ...(materials ? [['materials', node, ['scripts/assets/surfaces/validate.mjs']]] : []),
    ...(materials ? [['material-contract', node, ['--test', 'scripts/assets/surfaces/validate.test.mjs']]] : []),
    ...(nativeMaterials ? [['material-native-proof', node, ['scripts/materials/proof.mjs']]] : []),
    ...(full ? [['build', node, ['scripts/build.mjs', '--skip-typecheck']], ['inventory', node, ['scripts/check-assets.mjs', '--build']], ['preview', node, ['scripts/smoke-preview.mjs']]] : []),
    ...(args['--assets'] ? [['assets', node, ['scripts/check-assets.mjs']]] : []),
    ...(args['--base'] ? [['candidate-diff', 'git', ['diff', '--check', `${args['--base']}...HEAD`]]] : []),
    ['index-diff', 'git', ['diff', '--cached', '--check']],
    ['diff', 'git', ['diff', '--check']],
  ];
}
