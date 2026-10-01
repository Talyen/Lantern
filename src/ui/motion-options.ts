import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { defaultSelection, loadCombatMotions, motionStates, stateChoices, type CombatMotions, type MotionCatalog, type MotionSelection } from '../animation/combat-animations';
import characters from '../../assets/playable-characters.json';
import type { ActorId } from '../gameplay/encounter';

type MotionOptionsContext = {
  clearInput: () => void; setRetryEnabled: (enabled: boolean) => void;
  install: (who: ActorId, motions: CombatMotions) => void; reset: () => void;
};

export function createMotionOptions(loader: GLTFLoader, ctx: MotionOptionsContext) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const playerMotions = element<HTMLSelectElement>('player-motions');
  const enemyMotions = element<HTMLSelectElement>('enemy-motions');
  const motionStatus = element<HTMLParagraphElement>('motion-status');
  const moveSelectors = Object.fromEntries(motionStates.map((state) => [state, element<HTMLSelectElement>(`motion-${state}`)])) as Record<typeof motionStates[number], HTMLSelectElement>;
  let motionLoading = false;
  let motionCatalogs: Record<ActorId, MotionCatalog>;
  let activePlayerPack = 'mixamo';
  let activeEnemyPack = 'mixamo';
  let activePlayerSelection: MotionSelection;
  function enableMotionControls(enabled: boolean): void {
    playerMotions.disabled = enemyMotions.disabled = !enabled;
    for (const select of Object.values(moveSelectors)) select.disabled = !enabled;
  }
  function renderMoveChoices(packId: string, selection: MotionSelection): void {
    for (const state of motionStates) {
      const select = moveSelectors[state];
      select.replaceChildren(...stateChoices(motionCatalogs.player, packId, state).map((choice) => new Option(choice.clip.description ? `${choice.clip.name} · ${choice.clip.description}` : choice.clip.name, choice.value)));
      select.value = selection[state];
    }
  }

  async function changeMotions(who: 'player' | 'enemy', packId: string, selection: MotionSelection): Promise<void> {
    if (motionLoading) return;
    motionLoading = true;
    ctx.clearInput();
    enableMotionControls(false);
    ctx.setRetryEnabled(false);
    motionStatus.textContent = 'Loading motion set…';
    try {
      const motions = await loadCombatMotions(loader, motionCatalogs[who], packId, selection);
      ctx.install(who, motions);
      if (who === 'player') { activePlayerPack = packId; activePlayerSelection = selection; renderMoveChoices(packId, selection); }
      else activeEnemyPack = packId;
      ctx.reset();
      motionStatus.textContent = '';
    } catch (error) {
      playerMotions.value = activePlayerPack;
      enemyMotions.value = activeEnemyPack;
      renderMoveChoices(activePlayerPack, activePlayerSelection);
      motionStatus.textContent = `Could not load those motions. ${String(error)}`;
    } finally { motionLoading = false; enableMotionControls(true); ctx.setRetryEnabled(true); }
  }
  async function initializeMotionSets(): Promise<void> {
    motionLoading = true;
    try {
      const catalogs = await Promise.all((['player', 'enemy'] as const).map(async who => {
        const response = await fetch(characters[who].catalog);
        if (!response.ok) throw new Error('Run npm run assets:export-character to prepare compatible motions.');
        const catalog = await response.json() as MotionCatalog;
        if (catalog.version !== 1 || !catalog.packs?.length) throw new Error('Animation catalog unavailable.');
        catalog.packs = catalog.packs.filter(pack => pack.id === 'mixamo');
        if (!catalog.packs.length) throw new Error('Mixamo motions unavailable.');
        return catalog;
      }));
      motionCatalogs = { player: catalogs[0], enemy: catalogs[1] };
      for (const [who, select] of [['player', playerMotions], ['enemy', enemyMotions]] as const) {
        select.replaceChildren(...motionCatalogs[who].packs.map(pack => new Option(pack.label, pack.id)));
        select.value = 'mixamo';
      }
      activePlayerSelection = defaultSelection(motionCatalogs.player, activePlayerPack);
      const enemySelection = defaultSelection(motionCatalogs.enemy, activeEnemyPack);
      const motions = await Promise.all([loadCombatMotions(loader, motionCatalogs.player, activePlayerPack, activePlayerSelection), loadCombatMotions(loader, motionCatalogs.enemy, activeEnemyPack, enemySelection)]);
      ctx.install('player', motions[0]); ctx.install('enemy', motions[1]);
      renderMoveChoices(activePlayerPack, activePlayerSelection);
      ctx.reset(); enableMotionControls(true);
      motionStatus.textContent = '';
      playerMotions.addEventListener('change', () => { void changeMotions('player', playerMotions.value, defaultSelection(motionCatalogs.player, playerMotions.value)); });
      enemyMotions.addEventListener('change', () => { void changeMotions('enemy', enemyMotions.value, defaultSelection(motionCatalogs.enemy, enemyMotions.value)); });
      for (const select of Object.values(moveSelectors)) select.addEventListener('change', () => {
        const selection = Object.fromEntries(motionStates.map((state) => [state, moveSelectors[state].value])) as MotionSelection;
        void changeMotions('player', activePlayerPack, selection);
      });
    } catch (error) {
      for (const select of [playerMotions, enemyMotions]) select.replaceChildren(new Option('Exported Mixamo set', 'compiled'));
      motionStatus.textContent = `Using the exported Mixamo set. ${String(error)}`;
    }
    finally { motionLoading = false; }
  }
  return { get loading() { return motionLoading; }, initialize: initializeMotionSets };
}
