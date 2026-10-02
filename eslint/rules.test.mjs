import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

// These policy fixtures need syntax and scope, not a TypeScript project per snippet.
const eslint = new ESLint({ overrideConfig: [{ files: ['src/**/*.ts'], languageOptions: { parserOptions: { projectService: false } }, rules: {
  '@typescript-eslint/no-floating-promises': 'off',
  '@typescript-eslint/no-misused-promises': 'off',
  '@typescript-eslint/await-thenable': 'off',
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
  ]) assert.equal((await messages('src/ui/adventure.ts', code, 'lantern/no-unowned-web-storage')).length, 1, code);
});

test('storage ownership allows local names, types and injected storage', async () => {
  for (const code of [
    'function read(localStorage: Storage) { return localStorage.getItem("key"); }',
    'const window = { localStorage: { clear() {} } }; window.localStorage.clear();',
    'type StorageSource = typeof window.localStorage;',
    'function read(store: Storage) { return store.getItem("key"); }',
    'const object = { localStorage: "label" }; console.log(object.localStorage);',
  ]) assert.equal((await messages('src/gameplay/character-persistence.ts', code, 'lantern/no-unowned-web-storage')).length, 0, code);
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
});

test('Node tooling globals do not permit DOM access in Electron main', async () => {
  assert.equal((await messages('electron/main.cjs', 'console.log(process, Buffer, require, __dirname, Response);', 'no-undef')).length, 0);
  assert.equal((await messages('electron/main.cjs', 'document.getElementById("scene");', 'no-undef')).length, 1);
  assert.equal((await messages('scripts/assets/mixamo/mixamo-browser-download.js', 'window.console.log(document.title, __COMPLETED__);', 'no-undef')).length, 0);
  assert.equal((await messages('scripts/assets/mixamo/mixamo-browser-download.js', 'require("node:fs");', 'no-undef')).length, 1);
});

test('application source rejects unhandled promises, async void callbacks and invalid awaits', async () => {
  const typed = new ESLint();
  for (const [rule, code] of [
    ['@typescript-eslint/no-floating-promises', 'Promise.resolve();'],
    ['@typescript-eslint/no-misused-promises', 'window.addEventListener("click", async () => { await Promise.resolve(); });'],
    ['@typescript-eslint/await-thenable', 'await 1; export {};'],
  ]) {
    const [result] = await typed.lintText(code, { filePath: 'src/entry.ts' });
    assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
    assert.ok(result.messages.some(message => message.ruleId === rule), JSON.stringify(result.messages));
  }
  const [allowed] = await typed.lintText('void Promise.resolve().catch(console.error); await Promise.resolve(); export {};', { filePath: 'src/entry.ts' });
  assert.equal(allowed.errorCount, 0, JSON.stringify(allowed.messages));
});

test('private and generated outputs are ignored, active source remains covered', async () => {
  for (const file of ['.local/worktrees/other/src/entry.ts', '.worktrees/other/src/entry.ts', 'public/vendor/converter.js', 'dist/assets/app.js', 'src/assets/catalog.generated.ts']) assert.equal(await eslint.isPathIgnored(file), true, file);
  assert.equal(await eslint.isPathIgnored('src/entry.ts'), false);
  assert.equal(await eslint.isPathIgnored('scripts/check.mjs'), false);
});
