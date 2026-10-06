import type { Adventure } from '../../src/gameplay/adventure';
import type { Encounter } from '../../src/gameplay/encounter';
import type { AreaDefinition } from '../../src/levels/types';

/** Settle real loot clocks without auto-collecting the fixture's rewards. */
export function landLoot(adventure: Adventure, encounter: Encounter, area: AreaDefinition): void {
  const reachable = adventure.canCollectGround;
  adventure.canCollectGround = () => false;
  try { adventure.step(encounter, area, .6); }
  finally { adventure.canCollectGround = reachable; }
}
