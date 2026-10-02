import { relative, resolve } from 'node:path';

const storageOwners = new Set([
  'src/clearing/clearing.ts',
  'src/rendering/graphics-settings.ts',
  'src/audio/settings.ts',
  'src/labs/animations/animation-lab.ts',
  'src/labs/characters/character-gallery.ts',
]);
const storageNames = new Set(['localStorage', 'sessionStorage', 'indexedDB']);
const globalObjects = new Set(['window', 'globalThis', 'self']);

// Static and literal dynamic imports share the same direct ownership boundaries.
export const importBoundaries = {
  gameplay: { patterns: [{ regex: '^(?:three(?:/|$)|(?:.*/)?(?:rendering|ui)(?:/|$))', message: 'Gameplay uses numeric interfaces and level data; keep three.js, rendering and UI in their owners.' }] },
  rendering: { patterns: [{ regex: '^(?:.*/)?ui(?:/|$)', message: 'Rendering must not import UI; coordinate them through clearing callbacks.' }] },
};

function constantString(node, sourceCode, seen = new Set()) {
  if (!node || seen.has(node)) return null;
  seen.add(node);
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression'].includes(node.type)) return constantString(node.expression, sourceCode, seen);
  if (node.type === 'Identifier' && sourceCode) {
    for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
      const variable = scope.set.get(node.name);
      if (!variable) continue;
      const definition = variable.defs.length === 1 ? variable.defs[0] : undefined;
      return definition?.type === 'Variable' && definition.parent?.kind === 'const' && definition.node.id.type === 'Identifier'
        ? constantString(definition.node.init, sourceCode, seen) : null;
    }
  }
  return null;
}

function propertyName(node, computed, sourceCode) {
  if (!computed && node.type === 'Identifier') return node.name;
  return constantString(node, sourceCode);
}

export const noRestrictedDynamicImports = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { patterns: { type: 'array', items: { type: 'object', properties: { regex: { type: 'string' }, message: { type: 'string' } }, required: ['regex', 'message'], additionalProperties: false } } }, required: ['patterns'], additionalProperties: false }],
    messages: { boundary: '{{message}}' },
  },
  create(context) {
    const patterns = (context.options[0]?.patterns ?? []).map(pattern => ({ ...pattern, matcher: new RegExp(pattern.regex, 'i') }));
    return {
      ImportExpression(node) {
        // Variable imports are outside this direct-import policy.
        const name = propertyName(node.source, true);
        if (name === null) return;
        const pattern = patterns.find(pattern => pattern.matcher.test(name));
        if (pattern) context.report({ node: node.source, messageId: 'boundary', data: { message: pattern.message } });
      },
    };
  },
};

function typeQuery(node) {
  while (node.parent?.type === 'TSQualifiedName') node = node.parent;
  return node.parent?.type === 'TSTypeQuery';
}

export const noUnownedWebStorage = {
  meta: {
    type: 'problem', schema: [],
    messages: { storage: 'Access {{name}} through the existing boot, preference or named lab storage owner.' },
  },
  create(context) {
    const filename = relative(context.cwd, resolve(context.filename)).split('\\').join('/');
    if (storageOwners.has(filename)) return {};
    const reported = new Set();
    const inspected = new Set();
    function followAlias(node, declaration) {
      if (declaration.parent?.kind !== 'const') return;
      for (const variable of context.sourceCode.getDeclaredVariables(declaration)) {
        if (!variable.identifiers.includes(node)) continue;
        for (const reference of variable.references) {
          if (reference.isRead() && reference.isValueReference !== false && !typeQuery(reference.identifier)) inspect(reference.identifier, '');
        }
      }
    }
    function inspect(node, name) {
      if (storageNames.has(name)) {
        if (!reported.has(node.range[0])) {
          reported.add(node.range[0]);
          context.report({ node, messageId: 'storage', data: { name } });
        }
        return;
      }
      if (inspected.has(node)) return;
      inspected.add(node);
      if (node.type === 'ObjectPattern') {
        for (const property of node.properties) {
          if (property.type !== 'Property') continue;
          const key = propertyName(property.key, property.computed, context.sourceCode);
          if (storageNames.has(key)) inspect(property.key, key);
          else if (globalObjects.has(key)) inspect(property.value.type === 'AssignmentPattern' ? property.value.left : property.value, '');
        }
        return;
      }
      const parent = node.parent;
      if (parent?.type === 'MemberExpression' && parent.object === node) {
        const key = propertyName(parent.property, parent.computed, context.sourceCode);
        if (storageNames.has(key)) inspect(parent.property, key);
        else if (globalObjects.has(key)) inspect(parent, '');
      } else if (parent?.type === 'ChainExpression' ||
        (['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression'].includes(parent?.type) && parent.expression === node)) {
        inspect(parent, '');
      } else if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'ObjectPattern') {
        inspect(parent.id, '');
      } else if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'Identifier') {
        followAlias(parent.id, parent);
      } else if (parent?.type === 'Property' && parent.value === node && parent.parent.type === 'ObjectPattern') {
        let pattern = parent.parent;
        while (pattern.parent?.type === 'Property') pattern = pattern.parent.parent;
        if (pattern.parent?.type === 'VariableDeclarator') followAlias(node, pattern.parent);
      } else if (parent?.type === 'AssignmentExpression' && parent.right === node && parent.left.type === 'ObjectPattern') {
        inspect(parent.left, '');
      }
    }
    return {
      'Program:exit'() {
        for (const scope of context.sourceCode.scopeManager.scopes) {
          for (const reference of scope.references) {
            const node = reference.identifier;
            if (reference.isValueReference === false || reference.resolved?.defs.length || typeQuery(node)) continue;
            if (storageNames.has(node.name)) inspect(node, node.name);
            else if (globalObjects.has(node.name)) inspect(node, '');
          }
        }
      },
    };
  },
};

export const requireDisableReason = {
  meta: {
    type: 'problem', schema: [],
    messages: { reason: 'Explain ESLint suppressions and inline rule configurations with a reason after -- .' },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim();
          const disable = /^eslint-disable(?:-next-line|-line)?(?:\s|$)/.test(text);
          const inlineRules = /^eslint\s/.test(text);
          if ((disable || inlineRules) && !/--\s*\S/.test(text)) {
            context.report({ loc: comment.loc, messageId: 'reason' });
          }
        }
      },
    };
  },
};
