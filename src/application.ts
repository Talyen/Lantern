import { Adventure } from './gameplay/adventure';
import type { SavedAdventure, SlotId } from './gameplay/adventure-store';
import { TransactionalAdventureStore } from './gameplay/transactional-adventure-store';
import { InputPreferences } from './input/bindings';
import { createRenderer } from './rendering/renderer';
import { createGameSession, type GameSession } from './session/session';
import { Options } from './ui/options';
import { KeybindingsMenu } from './ui/keybindings';
import { FrontEnd } from './ui/front-end';
import { GameAudio } from './audio/audio';
import { loadingScreen } from './ui/loading';
import { registerRuntimeSnapshot, recordFailure } from './diagnostics/report';

const app = document.getElementById('app')!;
const markup = app.innerHTML;
const sceneMount = document.getElementById('scene')!;
const store = new TransactionalAdventureStore(() => localStorage, () => indexedDB);
const preferences = new InputPreferences(() => localStorage);
const audio = new GameAudio();
let session: GameSession | undefined;
let loadingReport: (() => ReturnType<GameSession['report']>) | undefined;
let selected: SavedAdventure | undefined;
let busy = false;
let closing = false;
let generation = 0;
const development = import.meta.env.DEV && (new URLSearchParams(location.search).get('author') === 'levels' || new URLSearchParams(location.search).get('inspection') === 'render');
const renderer = await createRenderer(sceneMount);
const bindings = new KeybindingsMenu(preferences, () => session?.actionBar() ?? [null, null, null, null, null, null],
  () => session?.clearInput(), () => session ? renderer.domElement.focus() : front.focusOptions(), document.getElementById('shared-menus')!);
const options = new Options({
  returnToTitle: () => { void returnToTitle().catch((error: unknown) => recordFailure('return-title', error)); },
  apply: settings => session?.applySettings(settings), combatText: settings => session?.applyCombatText(settings),
  flushSettings: () => session?.flushSettings(), resetMeasurements: () => session?.resetMeasurements(),
  clearInput: () => session?.clearInput(), focus: () => session ? renderer.domElement.focus() : front.focusOptions(),
  keybindings: () => bindings.open(), audio: { apply: settings => audio.applySettings(settings), play: cue => audio.play(cue) },
});
const front = new FrontEnd({
  slots: () => store.views(),
  continue: slot => { selectAdventure(slot).catch((error: unknown) => recordFailure('adventure-loading', error)); },
  create: (slot, name) => { selectAdventure(slot, name).catch((error: unknown) => recordFailure('adventure-loading', error)); },
  delete: slot => { deleteAdventure(slot).catch((error: unknown) => recordFailure('adventure-delete', error)); },
  options: () => options.open(), sound: () => audio.play('uiClick'),
});
store.subscribe(() => front.refresh());
if (!development) await store.initialize();
registerRuntimeSnapshot(() => session?.report() ?? loadingReport?.() ?? { ready: !busy, backend: 'webgpu', persistence: { blockedByExisting: false, ...store.diagnostics() } });

async function selectAdventure(slot: SlotId, name?: string): Promise<void> {
  if (busy || closing) return;
  busy = true; front.pending(name === undefined ? 'load' : 'create');
  try {
    const record = name === undefined ? await store.load(slot) : await store.create(slot, name);
    if (closing) return;
    busy = false;
    if (record) await start(record);
    else { loadingScreen.dismiss(); front.showLoadError(); }
  } catch (error) { front.showLoadError(); throw error; }
  finally { front.pending(); busy = false; }
}
async function deleteAdventure(slot: SlotId): Promise<void> {
  if (busy || closing) return;
  busy = true; front.pending('delete');
  try { await store.delete(slot); await store.flush(); }
  catch (error) { front.showLoadError(); throw error; }
  finally { busy = false; front.pending(); }
}

async function start(record?: SavedAdventure): Promise<void> {
  if (busy || closing) return;
  busy = true;
  const operation = ++generation;
  front.hide(); app.innerHTML = markup; app.hidden = false;
  document.getElementById('scene')!.replaceWith(sceneMount);
  sceneMount.replaceChildren(renderer.domElement);
  delete sceneMount.dataset.renderError;
  const token = loadingScreen.begin(record?.name ?? 'Lantern', true);
  for (const key of ['graphics', 'pipelineSize', 'lightingStage', 'renderError', 'settingsError']) delete renderer.domElement.dataset[key];
  let accepted = false;
  const adventure = record ? new Adventure(undefined, Math.random, {
    character: record.character,
    save: value => { if (accepted && operation === generation && !closing) store.save(record.slot, record.id, value); }, diagnostics: () => store.diagnostics(),
  }) : new Adventure();
  try {
    const candidate = await createGameSession({ renderer, adventure, options, preferences, bindingsMenu: bindings, audio, development,
      reportLoading: report => { loadingReport = report; } });
    if (closing) { await candidate.dispose(); return; }
    session = candidate; selected = record;
    loadingReport = undefined;
    accepted = true;
    if (record) candidate.save();
    options.setPlaying(!development); busy = false;
  } catch (error) {
    recordFailure('adventure-loading', error);
    loadingReport = undefined;
    app.hidden = true; busy = false;
    if (development) { loadingScreen.fail(token, error); return; }
    loadingScreen.fail(token, error, {
      kind: 'adventure',
      retry: () => { if (record) selectAdventure(record.slot).catch((error: unknown) => recordFailure('adventure-loading', error)); else start().catch((error: unknown) => recordFailure('adventure-loading', error)); },
      back: () => { loadingScreen.dismiss(); front.showPlay(); },
    });
  }
}
async function returnToTitle(): Promise<void> {
  if (busy || !session || closing) return;
  busy = true;
  const previous = session;
  previous.clearInput();
  if (selected) previous.save();
  generation++;
  await store.flush(); options.close(); options.setPlaying(false);
  session = undefined; selected = undefined;
  app.hidden = true; app.inert = true;
  await previous.dispose();
  renderer.domElement.remove();
  app.replaceChildren();
  busy = false; front.showTitle();
}
function checkpointWhenHidden(): void {
  if (!closing && session && selected && (document.hidden || document.documentElement.hasAttribute('data-window-hidden')))
    session.save();
}
document.addEventListener('visibilitychange', checkpointWhenHidden);
window.addEventListener('lanternvisibilitychange', checkpointWhenHidden);
window.addEventListener('pagehide', () => {
  if (session && selected) session.save();
  closing = true;
  store.close(); preferences.close(); audio.dispose();
  void (async () => { await session?.dispose(); await renderer.dispose(); })().catch((error: unknown) => console.error('Unable to release Lantern.', error));
}, { once: true });

// Explicit authoring/inspection keeps its disposable fixture world; normal play always selects a slot.
if (development) await start();
else { loadingScreen.dismiss(); front.showTitle(); }
