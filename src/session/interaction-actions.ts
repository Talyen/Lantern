import type { EncounterView } from '../gameplay/state-view';
import type { SessionRuntime } from './runtime';
import type { GameAudio } from '../audio/audio';
import { homeArea, type Adventure } from '../gameplay/adventure';
import type { AreaDefinition } from '../levels/types';
import type { AdventureMenus } from '../ui/adventure';
import type { AreaTravel, AreaChangeResult } from './area-change';
import { interactionError, type WorldInteraction } from './world-interactions';

type InteractionContext = {
  area(): AreaDefinition;
  definitions(): Record<string, AreaDefinition>;
  paused(): boolean;
  changeArea(change: AreaTravel): Promise<AreaChangeResult>;
  syncAdventure(): void;
  openShop(): void;
  openSmithing(): void;
};

/** Executes reached world targets; area preparation and commit remain with the coordinator. */
export class InteractionActions {
  constructor(
    private readonly adventure: Adventure,
    private readonly encounter: EncounterView,
    private readonly menus: Pick<AdventureMenus, 'openRepair' | 'openInventory' | 'openTravel'>,
    private readonly audio: Pick<GameAudio, 'play'>,
    private readonly context: InteractionContext,
    private readonly runtime: SessionRuntime,
  ) {}

  execute(target: WorldInteraction): void {
    const { adventure, encounter, context } = this;
    if (context.paused() || encounter.player.hp <= 0 || encounter.player.lock > 0 || encounter.dodgeRemaining > 0) return;
    const area = context.area();
    if (target.type === 'fire' && !adventure.fireSafe(area, target.fire, encounter)) return;
    const error = interactionError(target, area, adventure, encounter);
    if (error) { adventure.message(error); return; }
    switch (target.type) {
      case 'resource': this.runtime.selectGathering(target.resource); break;
      case 'shelter': this.menus.openRepair(); break;
      case 'shop': context.openShop(); break;
      case 'smithing': context.openSmithing(); break;
      case 'stash': this.menus.openInventory(true); break;
      case 'chest': this.runtime.openChest(target.chest); break;
      case 'fire': {
        this.runtime.discover();
        const sourceFire = target.fire;
        this.menus.openTravel(sourceFire.name, adventure.destinations(context.definitions()).map(({ area: destination, fire }) => ({
          name: fire.name,
          travel: () => {
            const allowed = () => this.runtime.canTravel(area, sourceFire, destination, fire);
            if (allowed()) void context.changeArea({ kind: 'travel', area: destination.id, transition: true, spawn: fire.arrival, canCommit: allowed }).then(result => {
              if (result.status === 'committed' && result.readiness === 'ready') this.audio.play('fireTravel');
            }).catch(areaChangeFailed);
          },
        })));
        break;
      }
      case 'portal': {
        const link = adventure.portal;
        if (!link) return;
        if (area.id === homeArea) {
          void context.changeArea({ kind: 'travel', area: link.area, transition: true, spawn: link.departure, consumePortal: link }).then(result => {
            if (result.status !== 'committed') return;
            context.syncAdventure();
            if (result.readiness === 'ready') { this.audio.play('portalPass'); this.audio.play('portalClose'); }
          }).catch(areaChangeFailed);
        } else {
          void context.changeArea({ kind: 'travel', area: homeArea, transition: true, spawn: context.definitions().homestead.portalArrival }).then(result => {
            if (result.status === 'committed' && result.readiness === 'ready') this.audio.play('portalPass');
          }).catch(areaChangeFailed);
        }
        break;
      }
    }
  }
}

export function areaChangeFailed(error: unknown): void { console.error('Unable to change area.', error); }
