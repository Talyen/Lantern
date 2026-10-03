import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import stylelint from 'stylelint';
import { Workspace, PositionEncoding } from '@astral-sh/ruff-wasm-nodejs';
import { requireDisableReason } from '../eslint/rules.mjs';
import { cli, isMain, parseArgs, root } from './lib/cli.mjs';
import { repositoryFiles } from './agents/state.mjs';

// This pass deliberately ignores inline configurations: a directive cannot disable
// the check that validates its own explanation and explicit rule names.
const directives = new ESLint({
  cwd: root, overrideConfigFile: true, allowInlineConfig: false,
  overrideConfig: [{
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { lantern: { rules: { 'require-disable-reason': requireDisableReason } } },
    rules: { 'lantern/require-disable-reason': 'error' },
  }],
});
export async function directiveMessages(filePath, source) {
  const [result] = await directives.lintText(source, { filePath });
  return result.messages.filter(message => message.ruleId === 'lantern/require-disable-reason');
}

async function javascript() {
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles(['.']);
  for (const result of results) {
    const audit = await directiveMessages(result.filePath, await readFile(result.filePath, 'utf8'));
    result.messages = result.messages.filter(message => message.ruleId !== 'lantern/require-disable-reason').concat(audit);
    result.errorCount = result.messages.filter(message => message.severity === 2).length;
    result.warningCount = result.messages.filter(message => message.severity === 1).length;
  }
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) console.log(output);
  return results.every(result => result.errorCount === 0 && result.warningCount === 0);
}

async function python() {
  const settings = JSON.parse(await readFile(resolve(root, 'ruff.config.json'), 'utf8'));
  const workspace = new Workspace(settings, PositionEncoding.Utf16);
  let passed = true;
  try {
    // Git excludes private sources, worktrees and build output without a second
    // filesystem-wide exclusion policy. No Python runtime or Blender is started.
    const files = (await repositoryFiles()).filter(path => path.endsWith('.py') && !path.includes('.generated.'));
    for (const path of files) {
      let source;
      try { source = await readFile(resolve(root, path), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const diagnostic of workspace.check(source)) {
        const location = diagnostic.start_location;
        console.error(`${path}:${location.row}:${location.column} ${diagnostic.code ?? 'syntax'} ${diagnostic.message}`);
        passed = false;
      }
    }
  } finally { workspace.free(); }
  return passed;
}

async function css() {
  const result = await stylelint.lint({ cwd: root, files: ['**/*.css'], formatter: 'string' });
  if (result.report) console.log(result.report);
  return !result.errored && result.results.every(file => file.warnings.length === 0);
}

if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--javascript': 'boolean', '--python': 'boolean', '--css': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run lint -- [--javascript] [--python] [--css]\nChecks JavaScript/TypeScript, Python and CSS without fixes or downloads. No flags checks all languages.'); return; }
  const all = !args['--javascript'] && !args['--python'] && !args['--css'];
  let passed = true;
  for (const [flag, check] of [['--javascript', javascript], ['--python', python], ['--css', css]]) {
    if (all || args[flag]) {
      const ok = await check();
      console.log(`${ok ? 'PASS' : 'FAIL'} lint ${flag.slice(2)}`);
      passed &&= ok;
    }
  }
  if (!passed) process.exitCode = 1;
});
