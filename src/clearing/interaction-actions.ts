import type { GameAudio } from '../audio/audio';
import { homeArea, type Adventure } from '../gameplay/adventure';
import type { Encounter } from '../gameplay/encounter';
import type { AreaDefinition } from '../levels/types';
import type { AdventureMenus } from '../ui/adventure';
import type { AreaTravel } from './area-change';
import type { GatheringController } from './gathering';
import { interactionError, type WorldInteraction } from './world-interactions';

type InteractionContext = {
  area(): AreaDefinition;
  definitions(): Record<string, AreaDefinition>;
  paused(): boolean;
  changeArea(change: AreaTravel): Promise<boolean>;
  syncAdventure(): void;
};

/** Executes reached world targets; area preparation and commit remain with the coordinator. */
export class InteractionActions {
  constructor(
    private readonly adventure: Adventure,
    private readonly encounter: Encounter,
    private readonly menus: Pick<AdventureMenus, 'openRepair' | 'openInventory' | 'openTravel'>,
    private readonly gathering: Pick<GatheringController, 'select'>,
    private readonly audio: Pick<GameAudio, 'play'>,
    private readonly context: InteractionContext,
  ) {}

  execute(target: WorldInteraction): void {
    const { adventure, encounter, context } = this;
    if (context.paused() || encounter.player.hp <= 0 || encounter.player.lock > 0 || encounter.dodgeRemaining > 0) return;
    const area = context.area();
    const error = interactionError(target, area, adventure, encounter);
    if (error) { adventure.message(error); return; }
    switch (target.type) {
      case 'resource': this.gathering.select(target.resource); break;
      case 'shelter': this.menus.openRepair(); break;
      case 'stash': this.menus.openInventory(true); break;
      case 'chest': adventure.openChest(encounter, area, target.chest); break;
      case 'fire': {
        adventure.discover(area, [encounter.player.x, encounter.player.z]);
        const sourceFire = target.fire;
        this.menus.openTravel(adventure.destinations(context.definitions()).map(({ area: destination, fire, available }) => ({
          name: fire.name, available,
          travel: () => {
            const allowed = () => adventure.canTravel(encounter, area, sourceFire, destination, fire);
            if (allowed()) void context.changeArea({ kind: 'travel', area: destination.id, transition: true, spawn: fire.arrival, canCommit: allowed }).then(ok => {
              if (ok) this.audio.play('fireTravel');
            }).catch(areaChangeFailed);
          },
        })));
        break;
      }
      case 'portal': {
        const link = adventure.portal;
        if (!link) return;
        if (area.id === homeArea) {
          void context.changeArea({ kind: 'travel', area: link.area, transition: true, spawn: link.departure }).then(ok => {
            if (!ok) return;
            this.audio.play('portalPass');
            if (adventure.portal === link) {
              adventure.portal = null;
              context.syncAdventure();
              this.audio.play('portalClose');
            }
          }).catch(areaChangeFailed);
        } else {
          void context.changeArea({ kind: 'travel', area: homeArea, transition: true, spawn: context.definitions().homestead.portalArrival }).then(ok => {
            if (ok) this.audio.play('portalPass');
          }).catch(areaChangeFailed);
        }
        break;
      }
    }
  }
}

export function areaChangeFailed(error: unknown): void { console.error('Unable to change area.', error); }
