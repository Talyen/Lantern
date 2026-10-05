import { memory } from './helpers/storage';
import { isRecord, parseJson } from '../src/data/json';
// Admission: renewal and save boundaries can duplicate rewards, lose ground items or reset finite XP budgets.
import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Adventure, characterSaveKey } from '../src/gameplay/adventure';
import { characterBackupKey, decodeCharacter } from '../src/gameplay/character-save';
import { createEncounter, enemyMaxHealth } from '../src/gameplay/encounter';
import { renewalSeconds } from '../src/gameplay/outing';
import { resourceDefinitions } from '../src/levels/resources';
import { areas } from '../src/levels/registry';
import { RenewalVisibility } from '../src/session/renewal-visibility';

const setup = (storage = memory()) => {
  const adventure = new Adventure(storage, () => 0);
  adventure.configureAreas(areas);
  const encounter = createEncounter('playing', areas.clearing.layout);
  adventure.enter(encounter, areas.clearing);
  encounter.player.x = 30; encounter.player.z = 30;
  return { adventure, encounter, storage };
};

test('individual enemy deadlines defer safely and renew only their own life and rewards', () => {
  const { adventure, encounter } = setup();
  encounter.enemies.enemy.hp = 0; encounter.enemies.enemy.lowestHp = 0;
  adventure.step(encounter, areas.clearing, 0);
  const old = adventure.session().drops[0];
  const independent = adventure.spawnDrop('wood', 1, [0, 0]);
  adventure.advanceRenewal(encounter, areas.clearing, 60);
  encounter.enemies.caster.hp = 0; encounter.enemies.caster.lowestHp = 0;
  adventure.step(encounter, areas.clearing, 0);
  const casterLoot = adventure.session().drops.filter(drop => drop.source?.id === 'caster').map(drop => drop.id);
  adventure.advanceRenewal(encounter, areas.clearing, renewalSeconds - 60);
  expect(encounter.enemies.enemy.hp).toBe(0); // Visible/nearby eligibility has not been granted.
  adventure.canRenew = (_source, point) => point !== old.position;
  adventure.advanceRenewal(encounter, areas.clearing, 1);
  expect(encounter.enemies.enemy.hp).toBe(0); // Source loot also needs to be safely hidden.
  adventure.canRenew = () => true;
  adventure.advanceRenewal(encounter, areas.clearing, 1);
  expect(encounter.enemies.enemy).toMatchObject({ hp: enemyMaxHealth, lowestHp: enemyMaxHealth, engaged: false, attackTime: -1 });
  expect(encounter.enemies.caster.hp).toBe(0);
  expect(adventure.session().drops.map(drop => drop.id)).toEqual([independent.id, ...casterLoot]);
  encounter.enemies.enemy.hp = 0;
  adventure.step(encounter, areas.clearing, 0);
  expect(adventure.session().drops.filter(drop => drop.source?.id === 'enemy').map(drop => drop.item)).toEqual(['scroll', 'gold', 'axe']);
});

test('chests open with living enemies, renew independently and never repeat collected equipment claims', () => {
  const { adventure, encounter } = setup();
  const chest = areas.clearing.chests![0];
  encounter.player.x = chest.position[0]; encounter.player.z = chest.position[1];
  expect(adventure.openChest(encounter, areas.clearing, chest)).toBe(true);
  const sword = adventure.session().drops.find(drop => drop.item === 'sword')!;
  sword.age = 1;
  expect(adventure.pickup(sword.id, chest.position, true)).toBe(true);
  const retained = adventure.spawnDrop('stone', 2, [25, 25]);
  encounter.player.x = 30; encounter.player.z = 30;
  adventure.canRenew = () => true;
  adventure.advanceRenewal(encounter, areas.clearing, renewalSeconds);
  expect(adventure.chest(areas.clearing, chest).opened).toBe(false);
  expect(adventure.session().drops.map(drop => drop.id)).toEqual([retained.id]);
  encounter.player.x = chest.position[0]; encounter.player.z = chest.position[1];
  expect(adventure.openChest(encounter, areas.clearing, chest)).toBe(true);
  expect(adventure.session().drops.some(drop => drop.item === 'sword')).toBe(false);
  expect(adventure.session().drops.some(drop => drop.item === 'shield')).toBe(true);
});

test('saved outings retain resources, partial loot, wounded budgets, portal, cooldowns and clock without offline progress', () => {
  const { adventure, encounter, storage } = setup();
  const node = resourceDefinitions(areas.clearing).find(node => node.kind === 'stone')!;
  const point: [number, number] = [node.position[0], node.position[2]];
  for (let hit = 0; hit < node.contacts; hit++) adventure.harvesting.contact('clearing', node.id, point);
  adventure.grantHarvest('stone', 3, 'mining', 10, point, { kind: 'resource', id: node.id });
  adventure.session().drops[0].quantity = 2; // Remaining quantity after partial collection.
  encounter.enemies.enemy.hp = 120; encounter.enemies.enemy.lowestHp = 75;
  encounter.ultimateCooldown = 27; encounter.abilityCooldowns['sweep'] = 4;
  encounter.player.x = 4; encounter.player.z = 4;
  adventure.beginCast(true); adventure.step(encounter, areas.clearing, 2);
  adventure.closeSave();
  const restored = new Adventure(storage);
  restored.configureAreas(areas);
  const resumed = restored.resume(areas);
  expect(resumed.area.id).toBe('homestead');
  const next = createEncounter('playing');
  restored.enter(next, areas.homestead, resumed.spawn);
  expect(next.ultimateCooldown).toBe(27);
  expect(next.abilityCooldowns['sweep']).toBe(4);
  restored.enter(next, areas.clearing);
  expect(next.enemies.enemy).toMatchObject({ hp: 120, lowestHp: 75, engaged: false, attackTime: -1 });
  expect(restored.harvesting.isDepleted('clearing', node.id)).toBe(true);
  expect(restored.session().drops[0]).toMatchObject({ quantity: 2, harvestXp: { skill: 'mining', perUnit: 10 } });
  expect(restored.portal).toEqual(adventure.portal);
  expect(restored.character.scrolls).toBe(adventure.character.scrolls);
  expect(restored.character.outing.elapsed).toBe(adventure.character.outing.elapsed);
  const independent = restored.spawnDrop('wood', 1, [30, 30]);
  expect(independent.id).not.toBe(restored.session().drops[0].id);
  restored.canRenew = () => true;
  restored.advanceRenewal(next, areas.clearing, renewalSeconds);
  expect(restored.harvesting.isDepleted('clearing', node.id)).toBe(false);
  expect(restored.session().drops.map(drop => drop.id)).toEqual([independent.id]);
});

test('a save between lethal XP and loot generation resumes the reward exactly once', () => {
  const { adventure, encounter, storage } = setup();
  encounter.enemies.enemy.hp = 0; encounter.enemies.enemy.lowestHp = 0;
  adventure.grantWeaponXp('axe', 10); // Combat persists XP before Adventure generates drops.
  const restored = new Adventure(storage, () => 0);
  restored.configureAreas(areas);
  const next = createEncounter('playing'); restored.enter(next, areas.clearing);
  next.player.x = 30; next.player.z = 30;
  restored.step(next, areas.clearing, 0);
  expect(restored.session().drops.filter(drop => drop.source?.id === 'enemy').map(drop => drop.item)).toEqual(['scroll', 'gold', 'axe']);
  restored.closeSave();
  const again = new Adventure(storage, () => 0); again.configureAreas(areas); again.enter(next, areas.clearing);
  again.step(next, areas.clearing, 0);
  expect(again.session().drops.filter(drop => drop.source?.id === 'enemy').map(drop => drop.item)).toEqual(['scroll', 'gold', 'axe']);
  expect(again.character.xp.axeCombat).toBe(10);
});

test('checkpoint selection rejects unsafe or removed fires; malformed outings recover their backup', () => {
  const { adventure, encounter, storage } = setup();
  const fire = areas.clearing.campfires![0];
  encounter.player.x = fire.position[0]; encounter.player.z = fire.position[1];
  for (const enemy of Object.values(encounter.enemies)) enemy.hp = 0;
  adventure.step(encounter, areas.clearing, 0);
  expect(adventure.resume(areas).area.id).toBe('clearing');
  encounter.enemies.enemy.hp = enemyMaxHealth; encounter.enemies.enemy.engaged = true;
  expect(adventure.resume(areas).area.id).toBe('homestead');
  adventure.character.outing.checkpoint = 'removed/fire';
  expect(adventure.resume(areas).area.id).toBe('homestead');
  adventure.save();
  const valid = storage.data.get(characterSaveKey)!;
  storage.data.set(characterBackupKey, valid);
  const invalid = parseJson(valid);
  if (!isRecord(invalid) || !isRecord(invalid.outing)) throw new Error('Invalid fixture');
  invalid.outing.elapsed = -1;
  storage.data.set(characterSaveKey, JSON.stringify(invalid));
  expect(new Adventure(storage).character.items).toEqual(adventure.character.items);
  expect(storage.data.has(`${characterSaveKey}.unreadable`)).toBe(true);
  // Admission: corrupt weather must recover the valid outing, not lose inventory/progress.
  const corruptWeather = parseJson(valid);
  if (!isRecord(corruptWeather) || !isRecord(corruptWeather.outing) || !isRecord(corruptWeather.outing.weather)) throw new Error('Invalid fixture');
  corruptWeather.outing.weather.peak = NaN;
  storage.data.set(characterSaveKey, JSON.stringify(corruptWeather));
  storage.data.set(characterBackupKey, valid);
  const recovered = new Adventure(storage);
  expect(recovered.character.items).toEqual(adventure.character.items);
  expect(recovered.character.outing.weather).toEqual(adventure.character.outing.weather);
  const oldOuting = parseJson(valid);
  if (!isRecord(oldOuting) || !isRecord(oldOuting.outing)) throw new Error('Invalid fixture');
  oldOuting.version = 9; delete oldOuting.outing.weather;
  const migrated = decodeCharacter(JSON.stringify(oldOuting));
  expect(migrated.version).toBe(10);
  expect(migrated.items).toEqual(adventure.character.items);
  expect(migrated.outing.checkpoint).toBe(adventure.character.outing.checkpoint);
  expect(migrated.outing.weather.phase).toBe('dry');
  const legacy = parseJson(valid);
  if (!isRecord(legacy)) throw new Error('Invalid fixture');
  legacy.version = 8; delete legacy.outing;
  expect(decodeCharacter(JSON.stringify(legacy)).outing).toMatchObject({ elapsed: 0, checkpoint: 'homestead/camp', areas: {} });
});

test('camera eligibility protects visible restored bounds and near-player off-screen locations', () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100);
  camera.position.set(0, 30, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const state = createEncounter('playing'); state.player.x = 0; state.player.z = 0;
  const visibility = new RenewalVisibility(), source = { kind: 'enemy' as const, id: 'enemy' };
  expect(visibility.eligible(camera, state, source, [11.5, 0], 0, 1)).toBe(false);
  expect(visibility.eligible(camera, state, source, [13, 0], 0, 1)).toBe(true);
  camera.left = -50; camera.right = 50; camera.updateProjectionMatrix();
  expect(visibility.eligible(camera, state, source, [20, 0], 0, 1)).toBe(false);
});

test('expired inactive enemies renew on entry while the arrival protects nearby spawns and loot', () => {
  const { adventure, encounter } = setup();
  const spawn = encounter.enemies.enemy.home!;
  encounter.enemies.enemy.hp = 0; encounter.enemies.caster.hp = 0;
  adventure.step(encounter, areas.clearing, 0);
  const nearLoot = adventure.session().drops.filter(drop => drop.source?.id === 'enemy').map(drop => drop.id);
  adventure.enter(encounter, areas.homestead);
  adventure.advanceRenewal(encounter, areas.homestead, renewalSeconds);
  adventure.enter(encounter, areas.clearing, spawn);
  expect(encounter.enemies.enemy.hp).toBe(0);
  expect(encounter.enemies.caster.hp).toBe(enemyMaxHealth);
  expect(encounter.phase).toBe('playing');
  expect(adventure.session().drops.filter(drop => drop.source?.id === 'enemy').map(drop => drop.id)).toEqual(nearLoot);
  expect(adventure.session().drops.some(drop => drop.source?.id === 'caster')).toBe(false);
});

test('a failed pickup save retries character and ground state together without duplicating currency', async () => {
  vi.useFakeTimers();
  const { adventure, encounter, storage } = setup();
  try {
    const point: [number, number] = [encounter.player.x, encounter.player.z];
    const drop = adventure.spawnDrop('gold', 3, point); drop.age = 1;
    adventure.save();
    const previous = storage.data.get(characterSaveKey);
    const write = storage.setItem;
    let fail = true;
    storage.setItem = (key, value) => { if (fail && key === characterSaveKey) throw new Error('Temporary storage failure'); write(key, value); };
    expect(adventure.pickup(drop.id, point)).toBe(true);
    expect(adventure.saveDiagnostics().pending).toBe(true);
    expect(storage.data.get(characterSaveKey)).toBe(previous);
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(adventure.saveDiagnostics().pending).toBe(false);
    const restored = new Adventure(storage); restored.configureAreas(areas); restored.enter(encounter, areas.clearing);
    expect(restored.character.gold).toBe(3);
    expect(restored.session().drops.some(entry => entry.id === drop.id)).toBe(false);
    restored.closeSave();
  } finally { adventure.closeSave(); vi.useRealTimers(); }
});
