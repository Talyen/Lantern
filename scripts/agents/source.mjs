import { readFile } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';
import ts from 'typescript';
import { cli, isMain, parseArgs, root, UsageError } from '../lib/cli.mjs';
import { git } from './state.mjs';
import { budget, integer, linePage, recordPage, repositoryPath } from './read-text.mjs';

const supported = /\.(?:[cm]?js|tsx?)$/;
export function sourceSymbols(text, file) {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const symbols = [];
  const add = (name, node) => symbols.push({ name, kind: ts.SyntaxKind[node.kind],
    startLine: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
    endLine: tree.getLineAndCharacterOfPosition(node.end).line + 1 });
  function bindingNames(name) {
    if (ts.isIdentifier(name)) return [name.text];
    return name.elements.flatMap(element => ts.isBindingElement(element) ? bindingNames(element.name) : []);
  }
  for (const node of tree.statements) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) for (const name of bindingNames(declaration.name)) add(name, node);
    } else if (node.name) {
      const name = node.name.getText(tree); add(name, node);
      if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        for (const member of node.members) if (member.name) add(`${name}.${member.name.getText(tree)}`, member);
      }
    } else if (ts.isExportAssignment(node)) add('default', node);
  }
  return symbols;
}

// Direct literal imports/re-exports/require only; no transitive graph or alias guessing.
export async function directConsumers(owners) {
  const known = new Set((await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean));
  const files = [...known].filter(file => supported.test(file) && !/^(?:\.local|node_modules|public\/vendor|dist)\//.test(file)).sort();
  const wanted = new Set(owners), found = [];
  for (const file of files) {
    let text;
    try { text = await readFile(resolve(root, file), 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) specifier = node.arguments[0];
      else if (ts.isExternalModuleReference(node)) specifier = node.expression;
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) {
        const target = relative(root, resolve(root, dirname(file), specifier.text)).replaceAll('\\', '/');
        const stem = target.replace(/\.[cm]?js$/, '');
        const candidates = [target, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'].map(extension => stem + extension)];
        const owner = candidates.find(candidate => known.has(candidate));
        if (wanted.has(owner)) found.push({ owner, file, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, specifier: specifier.text });
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  return found;
}

if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--file': 'value', '--symbol': 'value', '--start-line': 'value', '--end-line': 'value', '--offset': 'value', '--limit': 'value', '--max-chars': 'value' });
  if (args['--help']) { console.log('Usage: npm run agent:source -- --file PATH [--symbol NAME | --start-line N [--end-line N]] [--offset 0] [--limit 20] [--max-chars 12000]\nList TS/JS top-level symbols and class/interface members, or read source lines. Offsets count records in the list, lines in a selected span. Content is bounded; nextOffset reports continuation. Read-only.'); return; }
  if (!args['--file']) throw new UsageError('Choose --file PATH.');
  const { path, local } = repositoryPath(args['--file']);
  if (!supported.test(extname(path))) throw new UsageError('Source inspection supports TypeScript and JavaScript files.');
  if (args['--symbol'] && (args['--start-line'] || args['--end-line'])) throw new UsageError('Choose a symbol or a line range.');
  if (args['--end-line'] && !args['--start-line']) throw new UsageError('--end-line requires --start-line.');
  const text = await readFile(path, 'utf8'), symbols = sourceSymbols(text, local), lines = text.split(/\r?\n/);
  if (!args['--symbol'] && !args['--start-line']) { console.log(JSON.stringify({ file: local, ...recordPage(symbols, args) }, null, 2)); return; }
  let startLine, endLine;
  if (args['--symbol']) {
    const matches = symbols.filter(symbol => symbol.name === args['--symbol']);
    if (!matches.length) throw new UsageError(`Unknown symbol ${args['--symbol']}; list symbols without --symbol.`);
    startLine = Math.min(...matches.map(symbol => symbol.startLine)); endLine = Math.max(...matches.map(symbol => symbol.endLine));
  } else {
    startLine = integer(args['--start-line'], 1, 1, lines.length, 'Start line');
    endLine = integer(args['--end-line'], lines.length, startLine, lines.length, 'End line');
  }
  const page = linePage(lines.slice(startLine - 1, endLine), integer(args['--offset'], 0, 0, Number.MAX_SAFE_INTEGER, 'Offset'), budget(args), integer(args['--limit'], 100, 1, 200, 'Line limit'));
  if (page.oversizedLine) throw new UsageError('A source line exceeds the content budget; increase --max-chars.');
  console.log(JSON.stringify({ file: local, symbol: args['--symbol'], startLine, endLine, firstShownLine: startLine + page.offset, ...page }, null, 2));
});
