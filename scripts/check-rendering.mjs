import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { cli, isMain, root } from './lib/cli.mjs';

const legacyNames = new Set(['WebGLRenderer', 'WebGLBackend', 'forceWebGL', 'usesWebGPU', 'switchBackend', 'ShaderMaterial', 'RawShaderMaterial', 'onBeforeCompile']);
const retiredNames = new Set(['TRAANode', 'TAAUNode', 'stableTemporalAA', 'checkedTAAU', 'VolumeNodeMaterial']);
const graphNames = new Set(['RenderPipeline', 'WebGPUBackend']);

// Parse application code, not comments or error text. The local symbol table
// follows imports, constructor/receiver aliases and annotated renderer parameters
// without loading dependencies or building a second application type project.
export function renderingViolations(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const options = { noLib: true, noResolve: true, allowJs: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === path ? file : undefined;
  const checker = ts.createProgram([path], options, host).getTypeChecker();
  const errors = new Set();
  const legacy = () => errors.add('WebGL/legacy shader support is forbidden; use the shared WebGPU pipeline and TSL.');
  const retired = () => errors.add('FSR Temporal is the sole reconstruction method; volumetric rendering is retired.');
  function unwrap(node) {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node))) node = node.expression;
    return node;
  }
  function constant(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constant(node.left, new Set(seen)), right = constant(node.right, new Set(seen));
      return left === null || right === null ? null : left + right;
    }
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.parent.flags & ts.NodeFlags.Const) return constant(declaration.initializer, seen);
    }
    return null;
  }
  function property(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) return constant(node.argumentExpression);
    return null;
  }
  function typeOrigin(type, seen) {
    if (type && ts.isTypeReferenceNode(type)) {
      if (ts.isIdentifier(type.typeName) && type.typeName.text === 'Promise') return typeOrigin(type.typeArguments?.[0], seen);
      return origin(type.typeName, seen);
    }
    return '';
  }
  function origin(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return '';
    seen.add(node);
    if (ts.isIdentifier(node)) {
      const declarations = checker.getSymbolAtLocation(node)?.declarations ?? [];
      for (const declaration of declarations) {
        if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text;
        if (ts.isImportClause(declaration)) {
          const imported = constant(declaration.parent.moduleSpecifier)?.split('/').at(-1)?.replace(/\.[cm]?js$/, '');
          if (legacyNames.has(imported) || retiredNames.has(imported) || graphNames.has(imported) || imported === 'WebGPURenderer') return imported;
        }
        if (ts.isVariableDeclaration(declaration)) {
          const typed = typeOrigin(declaration.type, seen);
          if (typed) return typed;
          if (declaration.initializer) {
            const initial = unwrap(declaration.initializer);
            if (ts.isObjectLiteralExpression(initial)) return '';
            const name = origin(initial, seen);
            return node.text === 'renderer' || node.text === 'renderers' ? 'WebGPURenderer' : name;
          }
        }
        if (ts.isBindingElement(declaration)) return (declaration.propertyName ?? declaration.name).getText(file);
        if (ts.isParameter(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration) || ts.isFunctionDeclaration(declaration)) {
          const name = typeOrigin(declaration.type, seen);
          if (name) return name;
        }
      }
      return node.text;
    }
    if (ts.isNewExpression(node)) return origin(node.expression, seen);
    if (ts.isCallExpression(node)) {
      const name = origin(node.expression, seen);
      return name === 'createRenderer' ? 'WebGPURenderer' : name;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = property(node);
      if (name === 'renderer' || name === 'renderers') return 'WebGPURenderer';
      // Resolve class fields and parameter properties before a namespace member.
      if (ts.isPropertyAccessExpression(node)) {
        const declaration = checker.getSymbolAtLocation(node.name)?.valueDeclaration;
        const typed = typeOrigin(declaration?.type, seen);
        if (typed) return typed;
        if (declaration && ts.isPropertyAssignment(declaration)) return origin(declaration.initializer, seen);
      }
      return name ?? origin(node.expression, seen);
    }
    return '';
  }
  function isRenderer(node) {
    const name = origin(node);
    return name === 'WebGPURenderer' || name === 'renderer' || name === 'renderers';
  }
  function modulePath(node) {
    const name = constant(node);
    if (name && /webgl|postprocessing/i.test(name)) legacy();
    if (name && /(?:ShaderMaterial|RawShaderMaterial)(?:\.|\/|$)/.test(name)) legacy();
    if (name && /(?:TRAANode|TAAUNode|VolumeNodeMaterial)(?:\.|\/|$)/i.test(name)) retired();
    if (name && /(?:RenderPipeline|WebGPUBackend)(?:\.|\/|$)/.test(name) && path !== 'src/rendering/webgpu-pipeline.ts') errors.add('Render graphs belong in the shared WebGPU pipeline owner.');
  }
  function visit(node) {
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = origin(node);
      if (legacyNames.has(name)) legacy();
      if (retiredNames.has(name)) retired();
      if (graphNames.has(name) && path !== 'src/rendering/webgpu-pipeline.ts') errors.add('Render graphs belong in the shared WebGPU pipeline owner.');
    }
    if (ts.isNewExpression(node) && origin(node.expression) === 'WebGPURenderer' && path !== 'src/rendering/renderer.ts') errors.add('Create renderers through the native-only renderer owner.');
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = property(node);
      if ((name === 'render' || name === 'renderAsync') && isRenderer(node.expression)) errors.add('Render scenes through the shared WebGPU pipeline.');
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) { if (node.moduleSpecifier) modulePath(node.moduleSpecifier); }
    if (ts.isCallExpression(node)) {
      if (origin(node.expression) === 'normalMap' && !['src/rendering/surface-detail.ts', 'src/labs/materials/probe.ts'].includes(path)) errors.add('Custom normal mapping must use mappedSurfaceNormal from the shared surface adapter; the pinned derivative frame otherwise assumes UV0.');
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') modulePath(node.arguments[0]);
      if (property(node.expression) === 'getContext' && /^(?:webgl2?|experimental-webgl)$/i.test(constant(node.arguments[0]) ?? '')) legacy();
    }
    if (ts.isStringLiteralLike(node) && (node.text === 'traa' || node.text === 'taau')) retired();
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...errors];
}

if (isMain(import.meta.url)) await cli(async () => {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:[cm]?js|tsx?)$/.test(entry.name)) files.push(path);
    }
  }
  for (const dir of ['src', 'scripts/levels', 'electron']) await walk(dir);
  const errors = [];
  for (const path of files) {
    for (const error of renderingViolations(path, await readFile(resolve(root, path), 'utf8'))) errors.push(`${path}: ${error}`);
  }
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (pkg.dependencies?.postprocessing || pkg.devDependencies?.postprocessing) errors.push('Remove the legacy postprocessing dependency.');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Native WebGPU policy passed: ${files.length} runtime files.`);
});
