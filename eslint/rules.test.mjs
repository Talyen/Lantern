import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

// These policy fixtures need syntax and scope, not a TypeScript project per snippet.
const eslint = new ESLint({ overrideConfig: [{ files: ['src/**/*.ts', 'tests/**/*.ts'], languageOptions: { parserOptions: { projectService: false } }, rules: {
  '@typescript-eslint/no-floating-promises': 'off',
  '@typescript-eslint/no-misused-promises': 'off',
  '@typescript-eslint/await-thenable': 'off',
  '@typescript-eslint/switch-exhaustiveness-check': 'off',
} }] });
async function messages(filePath, code, ruleId) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result.messages.filter(message => message.ruleId === ruleId);
}

test('storage ownership catches global references, qualification and destructuring', async () => {
  for (const code of [
    'localStorage.getItem("key");',
    'window.localStorage?.getItem("key");',
    'globalThis["sessionStorage"].clear();',
    'self[`indexedDB`].open("save");',
    'const { localStorage: store } = window; store.clear();',
    'let store; ({ sessionStorage: store } = globalThis);',
    'const { window: { indexedDB: db } } = globalThis;',
    'const host = window; host.localStorage.clear();',
    'const host = globalThis; const alias = host; alias.sessionStorage.clear();',
    'const host = (self as Window); host.indexedDB.open("save");',
    'const { window: host } = globalThis; host.localStorage.clear();',
    'const key = "localStorage"; window[key].clear();',
    'const key = `sessionStorage`; const alias = key; globalThis[alias].clear();',
    'const key = "indexedDB" as const; const { [key]: db } = self;',
  ]) assert.equal((await messages('src/ui/adventure.ts', code, 'lantern/no-unowned-web-storage')).length, 1, code);
});

test('storage ownership allows local names, types and injected storage', async () => {
  for (const code of [
    'function read(localStorage: Storage) { return localStorage.getItem("key"); }',
    'const window = { localStorage: { clear() {} } }; window.localStorage.clear();',
    'type StorageSource = typeof window.localStorage;',
    'function read(store: Storage) { return store.getItem("key"); }',
    'const object = { localStorage: "label" }; console.log(object.localStorage);',
    'const window = { localStorage: { clear() {} } }; const host = window; host.localStorage.clear();',
    'function read(window: { localStorage: Storage }) { const host = window; host.localStorage.clear(); }',
    'const host = window; type StorageSource = typeof host.localStorage;',
    'const key = "localStorage"; function read(key: string) { window[key]; }',
    'const host = window; const object = { host }; console.log(object);',
  ]) assert.equal((await messages('src/gameplay/character-persistence.ts', code, 'lantern/no-unowned-web-storage')).length, 0, code);
});

test('literal dynamic imports use the same gameplay and rendering boundaries', async () => {
  for (const source of ['three', 'three/webgpu', '../rendering/graphics', '../ui/hud']) {
    for (const code of [`import("${source}");`, `import(\`${source}\`);`]) {
      assert.equal((await messages('src/gameplay/encounter.ts', code, 'lantern/no-restricted-dynamic-imports')).length, 1, code);
    }
  }
  assert.equal((await messages('src/rendering/adventure.ts', 'import("../ui/hud");', 'lantern/no-restricted-dynamic-imports')).length, 1);
  for (const source of ['../levels/types', '@dimforge/rapier3d-compat', 'navcat', './equipment']) {
    assert.equal((await messages('src/gameplay/movement.ts', `import("${source}");`, 'lantern/no-restricted-dynamic-imports')).length, 0, source);
  }
  assert.equal((await messages('src/rendering/adventure.ts', 'import("../gameplay/adventure");', 'lantern/no-restricted-dynamic-imports')).length, 0);
  assert.equal((await messages('src/entry.ts', 'import("./ui/hud");', 'lantern/no-restricted-dynamic-imports')).length, 0);
});

test('only existing named storage owners are exempt', async () => {
  for (const file of ['src/clearing/clearing.ts', 'src/rendering/graphics-settings.ts', 'src/audio/settings.ts', 'src/labs/animations/animation-lab.ts', 'src/labs/characters/character-gallery.ts']) {
    assert.equal((await messages(file, 'localStorage.clear();', 'lantern/no-unowned-web-storage')).length, 0, file);
  }
  assert.equal((await messages('src/labs/animations/new-lab.ts', 'localStorage.clear();', 'lantern/no-unowned-web-storage')).length, 1);
});

test('gameplay and rendering imports respect their owners', async () => {
  for (const code of [
    'import { Vector3 } from "three";',
    'import type { Scene } from "three/webgpu";',
    'import { Graphics } from "../rendering/graphics";',
    'export { createHud } from "../ui/hud";',
  ]) assert.equal((await messages('src/gameplay/encounter.ts', code, 'no-restricted-imports')).length, 1, code);
  for (const code of [
    'import type { AreaDefinition } from "../levels/types";',
    'import RAPIER from "@dimforge/rapier3d-compat";',
    'import { findPath } from "navcat";',
  ]) assert.equal((await messages('src/gameplay/movement.ts', code, 'no-restricted-imports')).length, 0, code);
  assert.equal((await messages('src/rendering/adventure.ts', 'import { createHud } from "../ui/hud";', 'no-restricted-imports')).length, 1);
  assert.equal((await messages('src/rendering/adventure.ts', 'import type { GroundDrop } from "../gameplay/adventure";', 'no-restricted-imports')).length, 0);
});

test('suppressions require reasons and stale directives are errors', async () => {
  const statement = 'if (true) { console.log("fixture"); }';
  for (const file of ['src/ui/adventure.ts', 'scripts/check.mjs', 'electron/main.cjs', 'eslint.config.js']) {
    assert.equal((await messages(file, `// eslint-disable-next-line no-constant-condition\n${statement}`, 'lantern/require-disable-reason')).length, 1, file);
    assert.equal((await messages(file, `// eslint-disable-next-line no-constant-condition -- intentional fixture\n${statement}`, 'lantern/require-disable-reason')).length, 0, file);
  }
  for (const code of [
    '// eslint-disable-next-line no-constant-condition -- obsolete fixture\nconsole.log("fixture");',
    '/* eslint no-constant-condition: "error" */\nconsole.log("fixture");',
  ]) {
    const [result] = await eslint.lintText(code, { filePath: 'scripts/check.mjs' });
    assert.ok(result.messages.some(message => message.severity === 2 && /unused|already configured/i.test(message.message)), JSON.stringify(result.messages));
  }
  for (const severity of ['off', 'warn', '0', '1', '["off"]', '["warn"]']) {
    const directive = `/* eslint no-constant-condition: ${severity} */`;
    assert.equal((await messages('scripts/check.mjs', `${directive}\n${statement}`, 'lantern/require-disable-reason')).length, 1, severity);
    assert.equal((await messages('scripts/check.mjs', `${directive.replace(' */', ' -- intentional fixture */')}\n${statement}`, 'lantern/require-disable-reason')).length, 0, severity);
  }
  assert.equal((await messages('scripts/check.mjs', '/* eslint eqeqeq: "error" -- stronger fixture policy */\nconsole.log("fixture");', 'lantern/require-disable-reason')).length, 0);
});

test('Node tooling globals do not permit DOM access in Electron main', async () => {
  assert.equal((await messages('electron/main.cjs', 'console.log(process, Buffer, require, __dirname, Response);', 'no-undef')).length, 0);
  assert.equal((await messages('electron/main.cjs', 'document.getElementById("scene");', 'no-undef')).length, 1);
  assert.equal((await messages('scripts/assets/mixamo/mixamo-browser-download.js', 'window.console.log(document.title, __COMPLETED__);', 'no-undef')).length, 0);
  assert.equal((await messages('scripts/assets/mixamo/mixamo-browser-download.js', 'require("node:fs");', 'no-undef')).length, 1);
});

test('application source and tests reject unhandled promises, async void callbacks and invalid awaits', async () => {
  const typed = new ESLint();
  for (const filePath of ['src/entry.ts', 'tests/adventure.test.ts']) {
    for (const [rule, code] of [
      ['@typescript-eslint/no-floating-promises', 'Promise.resolve();'],
      ['@typescript-eslint/no-floating-promises', 'void Promise.reject(new Error("failure"));'],
      ['@typescript-eslint/no-floating-promises', 'import { expect } from "vitest"; expect(Promise.resolve(1)).resolves.toBe(1);'],
      ['@typescript-eslint/no-misused-promises', 'window.addEventListener("click", async () => { await Promise.resolve(); });'],
      ['@typescript-eslint/await-thenable', 'await 1; export {};'],
    ]) {
      const [result] = await typed.lintText(code, { filePath });
      assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
      assert.ok(result.messages.some(message => message.ruleId === rule), JSON.stringify(result.messages));
    }
    for (const code of [
      'void Promise.resolve().catch(console.error); await Promise.resolve(); export {};',
      'import { expect } from "vitest"; await expect(Promise.resolve(1)).resolves.toBe(1);',
    ]) {
      const [allowed] = await typed.lintText(code, { filePath });
      assert.equal(allowed.errorCount, 0, JSON.stringify(allowed.messages));
    }
  }
});

test('TypeScript guardrails preserve explained exceptions and deliberate null checks', async () => {
  for (const file of ['src/ui/adventure.ts', 'tests/adventure.test.ts', 'vite.config.ts']) {
    assert.equal((await messages(file, 'let value: any;', '@typescript-eslint/no-explicit-any')).length, 1, file);
    for (const directive of ['@ts-ignore', '@ts-nocheck', '@ts-expect-error']) {
      assert.equal((await messages(file, `// ${directive}\nconst value: number = "fixture";`, '@typescript-eslint/ban-ts-comment')).length, 1, directive);
    }
    assert.equal((await messages(file, '// @ts-expect-error: intentional type mismatch in fixture\nconst value: number = "fixture";', '@typescript-eslint/ban-ts-comment')).length, 0);
    assert.equal((await messages(file, 'const value: unknown = 1; value == null;', 'eqeqeq')).length, 0);
    assert.equal((await messages(file, 'const value: unknown = 1; value == "1";', 'eqeqeq')).length, 1);
  }
});

test('application union switches require every case even with a default', async () => {
  const typed = new ESLint();
  const prefix = 'declare const target: "fire" | "stash"; ';
  for (const code of [
    prefix + 'switch (target) { case "fire": break; }',
    prefix + 'switch (target) { case "fire": break; default: break; }',
  ]) {
    const [result] = await typed.lintText(code, { filePath: 'src/entry.ts' });
    assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
    assert.equal(result.messages.filter(message => message.ruleId === '@typescript-eslint/switch-exhaustiveness-check').length, 1);
  }
  const [result] = await typed.lintText(prefix + 'switch (target) { case "fire": break; case "stash": break; }', { filePath: 'src/entry.ts' });
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});

test('private and generated outputs are ignored, active source remains covered', async () => {
  for (const file of ['.local/worktrees/other/src/entry.ts', '.worktrees/other/src/entry.ts', 'public/vendor/converter.js', 'dist/assets/app.js', 'src/assets/catalog.generated.ts']) assert.equal(await eslint.isPathIgnored(file), true, file);
  assert.equal(await eslint.isPathIgnored('src/entry.ts'), false);
  assert.equal(await eslint.isPathIgnored('scripts/check.mjs'), false);
});
