import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { expect, test, vi } from 'vitest';
import { AdventureDatabase, adventureDatabaseName, type AdventureCommit } from '../src/data/adventure-database';
import { Adventure } from '../src/gameplay/adventure';
import { AdventureStore, slotKey } from '../src/gameplay/adventure-store';
import { TransactionalAdventureStore, pendingAdventureKey, indexedAdventureKey } from '../src/gameplay/transactional-adventure-store';
import { character, type CharacterSave } from '../src/gameplay/character';
import { createEncounter } from '../src/gameplay/encounter';
import { resourceDefinitions } from '../src/levels/resources';
import { areas } from '../src/levels/registry';
import { memory } from './helpers/storage';

// Admission: new native transactions/journals can lose an entire outing on abort or migration.
// Existing synchronous storage fixtures cannot exercise IDB atomicity or asynchronous shutdown.
const savedArea = () => ({ enemies: {}, chests: {}, resources: {}, drops: [] });
function fixture() {
  const storage = memory(), factory = new IDBFactory();
  const store = () => new TransactionalAdventureStore(storage, () => factory);
  return { storage, factory, store };
}

test('migration keeps legacy bytes and deletion/recreation rejects old progress across lifetimes', async () => {
  const { storage, factory, store } = fixture();
  const legacy = new AdventureStore(storage), old = legacy.create(1, 'Old')!;
  old.character.gold = 71; old.character.outing.areas.clearing = savedArea(); legacy.save(1, old.id, old.character); legacy.close();
  const bytes = storage.getItem(slotKey(1));
  const first = store();
  try {
    await first.initialize();
    expect((await first.load(1))?.character.gold).toBe(71);
    expect(storage.getItem(slotKey(1))).toBe(bytes);
    await first.delete(1); await first.flush();
    const next = (await first.create(1, 'New'))!;
    first.save(1, old.id, old.character); await first.flush();
    expect(next.id).not.toBe(old.id);
  } finally { first.close(); }
  const restored = new TransactionalAdventureStore(storage, () => factory);
  try {
    expect((await restored.load(1))?.name).toBe('New');
    expect((await restored.load(1))?.character.gold).toBe(0);
  } finally { restored.close(); }
});

test('an aborted transaction changes neither metadata nor area records', async () => {
  const factory = new IDBFactory(), database = await AdventureDatabase.open(factory);
  const current = character(); current.outing.areas.clearing = savedArea();
  const first: AdventureCommit = { identity: { id: 'one', name: 'One', deleted: false }, revision: 1, current, backup: current };
  try {
    await database.write(1, first);
    const next = character(); next.gold = 99; next.outing.areas.clearing = savedArea();
    next.outing.areas.clearing.resources.tree = { hits: 1 };
    const put = IDBObjectStore.prototype.put;
    const failing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'slots') this.transaction.abort();
      return put.call(this, value, key);
    });
    try { await expect(database.write(1, { ...first, revision: 2, current: next, backup: current }, first)).rejects.toThrow(); }
    finally { failing.mockRestore(); }
    const read = (await database.read(1)).commit!;
    expect(read.revision).toBe(1); expect(read.current?.gold).toBe(0);
    expect(read.current?.outing.areas.clearing.resources).toEqual({});
  } finally { database.close(); }
});

test('shutdown journal recovers the latest coherent transfer when IDB writes fail', async () => {
  const { storage, store } = fixture(), first = store();
  await first.initialize(); const initial = (await first.create(1, 'Pending'))!; await first.flush();
  const fail = vi.spyOn(AdventureDatabase.prototype, 'write').mockRejectedValue(new Error('Disk unavailable'));
  try {
    const adventure = new Adventure(undefined, () => 0, { character: initial.character,
      save: value => first.save(1, initial.id, value), diagnostics: () => first.diagnostics() });
    const encounter = createEncounter('playing', areas.homestead.layout);
    adventure.configureAreas(areas); adventure.enter(encounter, areas.homestead);
    const axe = adventure.character.items.find(item => item.item === 'axe')!;
    adventure.dropItem(axe.id, 1, [0, 0]); await first.flush();
    first.close();
    expect(storage.getItem(pendingAdventureKey(1))).not.toBeNull();
  } finally { fail.mockRestore(); first.close(); }
  const restored = store();
  try {
    const saved = (await restored.load(1))!;
    expect(saved.character.items.some(item => item.item === 'axe')).toBe(false);
    expect(saved.character.outing.areas.homestead.drops).toEqual([expect.objectContaining({ item: 'axe', quantity: 1 })]);
    expect(storage.getItem(pendingAdventureKey(1))).toBeNull();
  } finally { restored.close(); }
});

test('damaged IDB primary recovers its matching backup and archives original records atomically', async () => {
  const { factory, store } = fixture(), first = store();
  await first.initialize(); const saved = (await first.create(1, 'Recovery'))!; await first.flush();
  saved.character.gold = 20; first.save(1, saved.id, saved.character); await first.flush(); first.close();
  const opening = factory.open(adventureDatabaseName);
  const db = await new Promise<IDBDatabase>((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('slots', 'readwrite'), slot = tx.objectStore('slots'), request = slot.get(1);
    request.onsuccess = () => { const value = request.result as { current: { gold: unknown } }; value.current.gold = 'damaged'; slot.put(value, 1); };
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  }); db.close();
  const restored = store();
  try {
    expect((await restored.load(1))?.character.gold).toBe(0);
    expect(restored.diagnostics().pending).toBe(false);
    const check = factory.open(adventureDatabaseName);
    const verified = await new Promise<IDBDatabase>(resolve => { check.onsuccess = () => resolve(check.result); });
    const archived = verified.transaction('archives').objectStore('archives').getAll();
    const records = await new Promise<unknown[]>(resolve => { archived.onsuccess = () => resolve(archived.result as unknown[]); });
    expect(records).toHaveLength(1); verified.close();
  } finally { restored.close(); }
});

test('inactive areas retain their snapshots while active rewards and metadata survive reload', async () => {
  const { store } = fixture(), first = store();
  await first.initialize(); const saved = (await first.create(1, 'Areas'))!; await first.flush();
  const commits: CharacterSave[] = [];
  const adventure = new Adventure(undefined, () => 0, { character: saved.character,
    save: value => { commits.push(value); first.save(1, saved.id, value); }, diagnostics: () => first.diagnostics() });
  const encounter = createEncounter('playing', areas.clearing.layout);
  adventure.configureAreas(areas); adventure.enter(encounter, areas.clearing); await first.flush();
  const home = commits.at(-1)!.outing.areas.homestead;
  adventure.grantWeaponXp('axe', 12); await first.flush();
  expect(commits.at(-1)!.outing.areas.homestead).toBe(home);
  const tree = resourceDefinitions(areas.clearing)[0];
  adventure.harvesting.contact('clearing', tree.id, [tree.position[0], tree.position[2]]);
  adventure.grantHarvest('wood', 2, 'woodcutting', 1, [0, 0]); await first.flush();
  const captured = adventure.capture(); captured.outing.areas.homestead.drops.push({ id: 'foreign', item: 'wood', quantity: 1, age: 1, origin: [0, 0], position: [0, 0], height: 0 });
  expect(commits.at(-1)!.outing.areas.homestead.drops).toEqual([]);
  first.close(); const restored = store();
  try {
    const loaded = (await restored.load(1))!.character;
    expect(loaded.xp.axeCombat).toBe(12);
    expect(loaded.outing.areas.clearing.resources[tree.id].hits).toBe(1);
    expect(loaded.outing.areas.clearing.drops).toEqual([expect.objectContaining({ item: 'wood', quantity: 2 })]);
    expect(loaded.outing.areas.homestead.drops).toEqual([]);
  } finally { restored.close(); }
});

// Admission: IDB failure during first import must never discard the retained v1 save or prevent retry.
test('interrupted database migration replays its full journal without changing the v1 source', async () => {
  const { storage, store } = fixture(), legacy = new AdventureStore(storage);
  const old = legacy.create(1, 'Migration')!; old.character.gold = 51;
  old.character.outing.areas.clearing = savedArea(); legacy.save(1, old.id, old.character); legacy.close();
  const source = storage.getItem(slotKey(1));
  const failed = vi.spyOn(AdventureDatabase.prototype, 'write').mockRejectedValue(new Error('Interrupted import'));
  const first = store();
  try {
    expect((await first.load(1))?.character.gold).toBe(51);
    expect(storage.getItem(slotKey(1))).toBe(source);
    expect(first.diagnostics().pending).toBe(true);
  } finally { first.close(); failed.mockRestore(); }
  const restored = store();
  try {
    expect((await restored.load(1))?.id).toBe(old.id);
    expect((await restored.load(1))?.character.gold).toBe(51);
    expect(restored.diagnostics().pending).toBe(false);
    expect(storage.getItem(slotKey(1))).toBe(source);
  } finally { restored.close(); }
});

// Admission: a stale writer's higher journal revision must never revive a deleted/recreated adventure.
test('obsolete pending identities cannot replace a recreated slot', async () => {
  const { storage, store } = fixture(), first = store();
  const old = (await first.create(1, 'Old'))!; await first.flush();
  const failed = vi.spyOn(AdventureDatabase.prototype, 'write').mockRejectedValue(new Error('Unavailable'));
  old.character.gold = 300; first.save(1, old.id, old.character); await first.flush();
  const pending = storage.getItem(pendingAdventureKey(1))!;
  failed.mockRestore(); await first.flush();
  await first.delete(1); await first.flush();
  const next = (await first.create(1, 'New'))!; await first.flush(); first.close();
  const stale = JSON.parse(pending) as { revision: number }; stale.revision = 100;
  storage.setItem(pendingAdventureKey(1), JSON.stringify(stale));
  const restored = store();
  try {
    expect((await restored.load(1))?.id).toBe(next.id);
    expect((await restored.load(1))?.character.gold).toBe(0);
    expect(storage.getItem(`${pendingAdventureKey(1)}.unreadable`)).not.toBeNull();
  } finally { restored.close(); }
});

// Admission: malformed archive storage must not allow the only pending progress bytes to be overwritten.
test('failed pending-byte preservation blocks repair and retries after storage recovers', async () => {
  const { storage, store } = fixture(), first = store();
  await first.create(1, 'Protected'); await first.flush(); first.close();
  const key = pendingAdventureKey(1);
  storage.setItem(key, '{damaged'); storage.setItem(`${key}.unreadable`, '{}');
  const restored = store();
  try {
    await restored.initialize();
    expect(storage.getItem(key)).toBe('{damaged'); expect(restored.diagnostics().pending).toBe(true);
    const saved = (await restored.load(1))!; saved.character.gold = 23;
    restored.save(1, saved.id, saved.character); await restored.flush();
    expect(storage.getItem(key)).toBe('{damaged');
    storage.removeItem(`${key}.unreadable`); await restored.initialize();
    expect(JSON.parse(storage.getItem(`${key}.unreadable`)!)).toEqual(['{damaged']);
    expect((await restored.load(1))?.character.gold).toBe(23);
    expect(restored.diagnostics().pending).toBe(false);
  } finally { restored.close(); }
});

// Admission: database eviction with retained v1 bytes must not silently revive an older adventure.
test('a lost migrated database stays protected until the slot is explicitly deleted', async () => {
  const { storage, factory, store } = fixture(), legacy = new AdventureStore(storage);
  const old = legacy.create(1, 'Old')!; old.character.gold = 12; legacy.save(1, old.id, old.character); legacy.close();
  const first = store(); await first.initialize(); first.close();
  expect(storage.getItem(indexedAdventureKey(1))).toBe('true');
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(adventureDatabaseName);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  const restored = store();
  try {
    expect(await restored.load(1)).toBeNull(); expect(await restored.create(1, 'Overwrite')).toBeNull();
    await restored.delete(1); await restored.flush();
    expect((await restored.create(1, 'Fresh'))?.character.gold).toBe(0); await restored.flush();
    expect(storage.getItem(slotKey(1))).toContain('"gold":12');
  } finally { restored.close(); }
});
