import { Adventure } from './gameplay/adventure';
import { AdventureStore, type SavedAdventure } from './gameplay/adventure-store';
import { InputPreferences } from './input/bindings';
import { createRenderer } from './rendering/renderer';
import { disposeAreaCache } from './levels/builder';
import { createGameSession, type GameSession } from './clearing/clearing';
import { Options } from './ui/options';
import { KeybindingsMenu } from './ui/keybindings';
import { FrontEnd } from './ui/front-end';
import { GameAudio } from './audio/audio';
import { loadingScreen } from './ui/loading';
import { registerRuntimeSnapshot, recordFailure } from './diagnostics/report';

const app = document.getElementById('app')!;
const markup = app.innerHTML;
const sceneMount = document.getElementById('scene')!;
const store = new AdventureStore(() => localStorage);
const preferences = new InputPreferences(() => localStorage);
const audio = new GameAudio();
let session: GameSession | undefined;
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
  continue: slot => { if (!busy) { const record = store.load(slot); if (record) void start(record).catch((error: unknown) => recordFailure('adventure-loading', error)); else front.showLoadError(); } },
  create: (slot, name) => { if (!busy) { const record = store.create(slot, name); if (record) void start(record).catch((error: unknown) => recordFailure('adventure-loading', error)); else front.showPlay(); } },
  delete: slot => store.delete(slot), options: () => options.open(), sound: () => audio.play('uiClick'),
});
store.subscribe(() => front.refresh());
if (!development) store.initialize();
registerRuntimeSnapshot(() => session?.report() ?? { ready: !busy, backend: 'webgpu', persistence: { loaded: true, failures: 0, blockedByExisting: false, ...store.diagnostics() } });

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
    const candidate = await createGameSession({ renderer, adventure, options, preferences, bindingsMenu: bindings, audio, development });
    if (closing) { await candidate.dispose(); return; }
    session = candidate; selected = record;
    accepted = true;
    if (record) store.save(record.slot, record.id, candidate.capture());
    options.setPlaying(!development); busy = false;
  } catch (error) {
    recordFailure('adventure-loading', error);
    app.hidden = true; busy = false;
    if (development) { loadingScreen.fail(token, error); return; }
    loadingScreen.fail(token, error, {
      kind: 'adventure',
      retry: () => { if (!busy) { const latest = record ? store.load(record.slot) : undefined; if (!record || latest) void start(latest ?? undefined).catch((error: unknown) => recordFailure('adventure-loading', error)); else { loadingScreen.dismiss(); front.showPlay(); } } },
      back: () => { loadingScreen.dismiss(); front.showPlay(); },
    });
  }
}
async function returnToTitle(): Promise<void> {
  if (busy || !session || closing) return;
  busy = true;
  const previous = session;
  previous.clearInput();
  if (selected) store.save(selected.slot, selected.id, previous.capture());
  generation++;
  store.flush(); options.close(); options.setPlaying(false);
  session = undefined; selected = undefined;
  app.hidden = true; app.inert = true;
  await previous.dispose();
  renderer.domElement.remove();
  app.replaceChildren();
  busy = false; front.showTitle();
}
window.addEventListener('pagehide', () => {
  closing = true;
  if (session && selected) store.save(selected.slot, selected.id, session.capture());
  store.close(); preferences.close(); audio.dispose();
  void (async () => { await session?.dispose(); await disposeAreaCache(); await renderer.dispose(); })().catch((error: unknown) => console.error('Unable to release Lantern.', error));
}, { once: true });

// Explicit authoring/inspection keeps its disposable fixture world; normal play always selects a slot.
if (development) await start();
else { loadingScreen.dismiss(); front.showTitle(); }
