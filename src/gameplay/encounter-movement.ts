import type { ActorState, Encounter, Movement, PlayerAction } from './encounter-model';

export function syncMovement(state: Encounter, movement?: Movement): void {
  movement?.syncActors?.([{ id: 'player', state: state.player, dodging: state.dodgeRemaining > 0 },
    ...state.enemyIds.filter(id => !!state.enemies[id].home).map(id => ({ id, state: state.enemies[id] }))]);
}

/** Gap closing snapshots aim. Movement does not promise that the later strike hits. */
export function prepareThrust(state: Encounter, action: PlayerAction, movement?: Movement): void {
  const player = state.player, x = Math.sin(player.yaw), z = Math.cos(player.yaw);
  const target = state.enemyIds.filter(id => {
    const enemy = state.enemies[id], dx = enemy.x - player.x, dz = enemy.z - player.z, distance = Math.hypot(dx, dz);
    return enemy.home && enemy.hp > 0 && distance <= action.reach + .75 &&
      Math.abs(enemy.y - player.y) < .8 && (distance === 0 || (dx * x + dz * z) / distance >= Math.cos(action.arc)) &&
      (!movement || movement.lineOfSight(player, enemy));
  }).sort((a, b) => Math.hypot(state.enemies[a].x - player.x, state.enemies[a].z - player.z) -
    Math.hypot(state.enemies[b].x - player.x, state.enemies[b].z - player.z) || a.localeCompare(b))[0];
  if (!target) return;
  const enemy = state.enemies[target];
  if (Math.hypot(enemy.x - player.x, enemy.z - player.z) < action.reach) return;
  const along = (enemy.x - player.x) * x + (enemy.z - player.z) * z;
  const perpendicular = Math.abs((enemy.x - player.x) * z - (enemy.z - player.z) * x);
  const reach = Math.sqrt(Math.max(0, (action.reach - .02) ** 2 - perpendicular ** 2));
  action.lunge = { x, z, distance: Math.min(.75, Math.max(0, along - reach)), advanced: 0, stopped: false };
}

/** Called before contacts, including when one frame crosses the entire preparation. */
export function advanceThrust(player: ActorState, action: PlayerAction, elapsed: number, movement?: Movement): void {
  const lunge = action.lunge; if (!lunge || lunge.stopped) return;
  const contact = action.contacts[0], start = contact / 2;
  const fraction = Math.max(0, Math.min(1, (elapsed - start) / (contact - start)));
  const desired = lunge.distance * fraction * fraction * (3 - 2 * fraction);
  const amount = desired - lunge.advanced; if (amount <= 0) return;
  const beforeX = player.x, beforeZ = player.z;
  if (movement) movement.move('player', player, lunge.x * amount, lunge.z * amount, 0, 'lunge');
  else { player.x += lunge.x * amount; player.z += lunge.z * amount; }
  lunge.advanced = desired;
  if (Math.hypot(player.x - beforeX - lunge.x * amount, player.z - beforeZ - lunge.z * amount) > .001) lunge.stopped = true;
}
