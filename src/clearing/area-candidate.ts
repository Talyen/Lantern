import type { AreaInstance } from '../levels/builder';
import type { MovementWorld } from '../gameplay/movement';
import type { PreparedLighting } from '../rendering/area-lighting';

/** The transition owns these three resources until the coordinator accepts them. */
export async function prepareAreaCandidate(
  build: () => Promise<AreaInstance>,
  navigation: () => Promise<MovementWorld>,
  lighting: (area: AreaInstance) => Promise<PreparedLighting>,
) {
  const area = await build();
  let movement: MovementWorld | undefined, prepared: PreparedLighting | undefined, owned = true;
  const dispose = () => {
    if (!owned) return;
    owned = false;
    prepared?.release(); movement?.dispose(); area.dispose();
  };
  try {
    movement = await navigation();
    prepared = await lighting(area);
    return { area, movement, lighting: prepared, dispose,
      accept: (eligible: () => boolean, beforeCommit: () => void) => {
        try {
          if (!eligible()) { dispose(); return false; }
          beforeCommit();
          owned = false;
          return true;
        } catch (error) { dispose(); throw error; }
      },
    };
  } catch (error) { dispose(); throw error; }
}
