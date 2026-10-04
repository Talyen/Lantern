import { expect, test, vi } from 'vitest';
import { AdventureStore, slotKey, migrationKey } from '../src/gameplay/adventure-store';
import { character } from '../src/gameplay/character';
import { characterSaveKey, characterBackupKey } from '../src/gameplay/character-save';

function memory() {
  const data = new Map<string, string>();
  let writable = true, readable = true;
  return {
    data,
    set writable(value: boolean) { writable = value; },
    set readable(value: boolean) { readable = value; },
    getItem(key: string) { if (!readable) throw Error('Read unavailable'); return data.get(key) ?? null; },
    setItem(key: string, value: string) { if (!writable) throw Error('Write unavailable'); data.set(key, value); },
    removeItem(key: string) { if (!writable) throw Error('Write unavailable'); data.delete(key); },
  };
}

test('four slots keep complete character and outing state independent through fresh store lifetimes', () => {
  const storage = memory(), store = new AdventureStore(storage);
  for (const slot of [1, 2, 3, 4] as const) {
    const saved = store.create(slot, `Name ${slot}`)!;
    saved.character.gold = slot * 20;
    saved.character.xp.mining = slot * 11;
    saved.character.outing.elapsed = slot * 100;
    saved.character.outing.cooldowns.ultimateCooldown = slot;
    saved.character.outing.portal = { area: 'clearing', departure: { position: [slot, 2], yaw: slot } };
    store.save(slot, saved.id, saved.character);
    expect(store.create(slot, 'Replacement')).toBeNull();
  }
  store.close();
  const restored = new AdventureStore(storage); restored.initialize();
  for (const slot of [1, 2, 3, 4] as const) {
    const saved = restored.load(slot)!;
    expect(saved.name).toBe(`Name ${slot}`);
    expect(saved.character.gold).toBe(slot * 20);
    expect(saved.character.xp.mining).toBe(slot * 11);
    expect(saved.character.outing.elapsed).toBe(slot * 100);
    expect(saved.character.outing.cooldowns.ultimateCooldown).toBe(slot);
    expect(saved.character.outing.portal?.departure.position).toEqual([slot, 2]);
  }
  restored.close();
});

test('legacy migration preserves the outing, recovers a valid backup and never reimports after deletion', () => {
  const storage = memory(), saved = character(); saved.gold = 123;
  saved.outing.elapsed = 400; saved.outing.checkpoint = 'clearing/camp';
  storage.data.set(characterSaveKey, '{unreadable'); storage.data.set(characterBackupKey, JSON.stringify(saved));
  const store = new AdventureStore(storage); store.initialize();
  expect(store.load(1)?.character).toEqual(saved);
  expect(store.load(1)?.name).toBe('Adventure 1');
  expect(storage.getItem(migrationKey)).toBe('true');
  expect(storage.getItem(characterSaveKey)).toBe('{unreadable');
  store.delete(1); store.close();
  storage.data.delete(migrationKey); // A durable deletion identity still prevents reimport.
  const again = new AdventureStore(storage); again.initialize();
  expect(again.load(1)).toBeNull(); expect(again.views()[0].state).toBe('empty'); again.close();
});

test('interrupted migration remains recoverable without a completion marker or duplicate import', () => {
  const storage = memory(); const legacy = character(); legacy.gold = 71;
  storage.data.set(characterSaveKey, JSON.stringify(legacy));
  const write = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === slotKey(1)) throw Error('Interrupted'); write(key, value); };
  const first = new AdventureStore(storage); first.initialize();
  expect(first.load(1)?.character.gold).toBe(71);
  expect(storage.getItem(migrationKey)).toBeNull(); first.close();
  storage.setItem = write;
  const second = new AdventureStore(storage); second.initialize();
  expect(second.load(1)?.character.gold).toBe(71);
  expect(second.views().slice(1).every(slot => slot.state === 'empty')).toBe(true);
  second.close();
});

test('pending snapshots survive switching and automatic retry writes the latest snapshot in each slot', async () => {
  vi.useFakeTimers();
  const storage = memory(), store = new AdventureStore(storage);
  try {
    const first = store.create(1, 'First')!, second = store.create(2, 'Second')!;
    storage.writable = false;
    first.character.gold = 40; store.save(1, first.id, first.character);
    first.character.gold = 41; store.save(1, first.id, first.character);
    second.character.gold = 90; store.save(2, second.id, second.character);
    expect(store.load(1)?.character.gold).toBe(41); expect(store.load(2)?.character.gold).toBe(90);
    storage.writable = true; await vi.advanceTimersByTimeAsync(1000);
    expect(store.diagnostics().pending).toBe(false);
    const restored = new AdventureStore(storage); restored.initialize();
    expect(restored.load(1)?.character.gold).toBe(41); expect(restored.load(2)?.character.gold).toBe(90); restored.close();
  } finally { store.close(); vi.useRealTimers(); }
});

test('validated backup repairs preserve unreadable data and never replace it when archiving fails', () => {
  const storage = memory(), first = new AdventureStore(storage);
  const saved = first.create(1, 'Recover')!; saved.character.gold = 22; first.save(1, saved.id, saved.character); first.close();
  storage.data.set(slotKey(1), '{broken'); storage.writable = false;
  const recovered = new AdventureStore(storage); recovered.initialize();
  expect(recovered.load(1)?.character.gold).toBe(0); expect(storage.data.get(slotKey(1))).toBe('{broken');
  storage.writable = true; recovered.flush();
  expect(JSON.parse(storage.getItem(`${slotKey(1)}.unreadable`)!)).toContain('{broken');
  recovered.close();
});

test('unreadable and unknown slots remain protected while other known slots can be used', () => {
  const storage = memory(); storage.data.set(slotKey(1), '{primary'); storage.data.set(`${slotKey(1)}.backup`, '{backup');
  const store = new AdventureStore(storage); store.initialize();
  expect(store.load(1)).toBeNull(); expect(store.create(1, 'Overwrite')).toBeNull();
  expect(store.create(2, 'Safe')).not.toBeNull();
  expect(storage.getItem(slotKey(1))).toBe('{primary'); store.close();
  storage.readable = false;
  const unknown = new AdventureStore(storage); unknown.initialize();
  expect(unknown.views().every(slot => slot.state !== 'empty')).toBe(true);
  expect(unknown.create(3, 'Unknown')).toBeNull(); unknown.close();
});

test('deletion followed by recreation rejects stale saves and obsolete backups even after partial writes', () => {
  const storage = memory(), store = new AdventureStore(storage);
  const old = store.create(1, 'Old')!; old.character.gold = 55; store.save(1, old.id, old.character);
  storage.writable = false; store.delete(1);
  const next = store.create(1, 'New')!;
  store.save(1, old.id, old.character);
  expect(store.load(1)?.character.gold).toBe(0); expect(next.id).not.toBe(old.id);
  storage.writable = true; store.flush(); store.close();
  storage.data.set(`${slotKey(1)}.backup`, JSON.stringify({ version: 1, id: old.id, name: old.name, character: old.character }));
  storage.data.set(slotKey(1), '{corrupt-new');
  const restored = new AdventureStore(storage); restored.initialize();
  expect(restored.load(1)).toBeNull(); expect(restored.create(1, 'Overwrite')).toBeNull(); restored.close();
});

test('a known in-memory snapshot survives damage to both stored copies', () => {
  const storage = memory(), store = new AdventureStore(storage);
  const saved = store.create(1, 'Known')!; saved.character.gold = 88; store.save(1, saved.id, saved.character);
  storage.data.set(slotKey(1), '{bad-primary'); storage.data.set(`${slotKey(1)}.backup`, '{bad-backup');
  storage.writable = false;
  expect(store.load(1)?.character.gold).toBe(88);
  expect(store.diagnostics().pending).toBe(true);
  storage.writable = true; store.flush();
  const restored = new AdventureStore(storage); expect(restored.load(1)?.character.gold).toBe(88); restored.close(); store.close();
});

test('unreadable legacy progress keeps the first slot protected across repeated selection until confirmed deletion', () => {
  const storage = memory(); storage.data.set(characterSaveKey, '{legacy');
  const store = new AdventureStore(storage); store.initialize();
  expect(store.load(1)).toBeNull(); expect(store.create(1, 'Overwrite')).toBeNull();
  expect(store.views()[0].state).toBe('occupied');
  store.delete(1); expect(store.create(1, 'Fresh')?.character.gold).toBe(0); store.close();
  const restored = new AdventureStore(storage); expect(restored.load(1)?.name).toBe('Fresh'); restored.close();
});

test('primary damage does not downgrade a known latest snapshot to its older backup', () => {
  const storage = memory(), store = new AdventureStore(storage);
  const saved = store.create(1, 'Latest')!; saved.character.gold = 91; store.save(1, saved.id, saved.character);
  storage.data.set(slotKey(1), '{broken');
  expect(store.load(1)?.character.gold).toBe(91);
  store.close();
  const restored = new AdventureStore(storage); expect(restored.load(1)?.character.gold).toBe(91); restored.close();
});
