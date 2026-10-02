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

function propertyName(node, computed) {
  if (!computed && node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

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
    function inspect(node, name) {
      if (storageNames.has(name)) {
        if (!reported.has(node.range[0])) {
          reported.add(node.range[0]);
          context.report({ node, messageId: 'storage', data: { name } });
        }
        return;
      }
      if (node.type === 'ObjectPattern') {
        for (const property of node.properties) {
          if (property.type !== 'Property') continue;
          const key = propertyName(property.key, property.computed);
          if (storageNames.has(key)) inspect(property.key, key);
          else if (globalObjects.has(key)) inspect(property.value.type === 'AssignmentPattern' ? property.value.left : property.value, '');
        }
        return;
      }
      const parent = node.parent;
      if (parent?.type === 'MemberExpression' && parent.object === node) {
        const key = propertyName(parent.property, parent.computed);
        if (storageNames.has(key)) inspect(parent.property, key);
        else if (globalObjects.has(key)) inspect(parent, '');
      } else if (parent?.type === 'ChainExpression' ||
        (['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression'].includes(parent?.type) && parent.expression === node)) {
        inspect(parent, '');
      } else if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'ObjectPattern') {
        inspect(parent.id, '');
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
    messages: { reason: 'Explain ESLint suppressions with a reason after -- .' },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim();
          if (/^eslint-disable(?:-next-line|-line)?(?:\s|$)/.test(text) && !/--\s*\S/.test(text)) {
            context.report({ loc: comment.loc, messageId: 'reason' });
          }
        }
      },
    };
  },
};
