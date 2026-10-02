import {
  casterBoltSpeed, enemyAttackDamage, type ActorId, type Encounter, type EncounterEvent,
  type Movement, type Projectile, type Timings,
} from './encounter-model';
import { hit } from './encounter-damage';

const playerTarget = ['player'] as const;

/** Numeric swept projectiles share terrain collision with movement, never apply damage twice. */
export function advanceProjectile(state: Encounter, projectile: Projectile, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): boolean {
  if (state.phase === 'lost' || projectile.owner !== 'player' && state.enemies[projectile.owner].hp <= 0)
    return false;
  const speed = projectile.owner !== 'player' ? casterBoltSpeed : projectile.kind === 'arrow' ? 24 : 16;
  const elapsed = projectile.firstStep ?? dt;
  const distance = Math.min(projectile.remaining, elapsed * speed);
  projectile.firstStep = undefined;
  const to = { x: projectile.x + projectile.dx * distance, y: projectile.y, z: projectile.z + projectile.dz * distance };
  const wall = movementWorld?.segmentHit?.(projectile, to) ?? null;
  // Ordinary shots consume at the closest contact. Only piercing shots need
  // an ordered contact list; strict comparison preserves authored tie order.
  const hits: { id: ActorId; fraction: number }[] | undefined = projectile.pierced ? [] : undefined;
  let nearestId: ActorId | undefined, nearestFraction = Infinity;
  for (const id of projectile.owner === 'player' ? state.enemyIds : playerTarget) {
    const target = id === 'player' ? state.player : state.enemies[id];
    if (projectile.pierced?.includes(id) || target.hp <= 0 || id !== 'player' && !state.enemies[id].home)
      continue;
    const x = target.x - projectile.x, z = target.z - projectile.z;
    const along = x * projectile.dx + z * projectile.dz, perpendicular = Math.abs(x * projectile.dz - z * projectile.dx);
    const radiusAlong = Math.sqrt(Math.max(0, .42 * .42 - perpendicular * perpendicular));
    const entry = along - radiusAlong, exit = along + radiusAlong;
    const fraction = Math.max(0, entry) / Math.max(.0001, distance);
    if (perpendicular <= .42 && exit >= 0 && entry <= distance && projectile.y >= target.y + .15 && projectile.y <= target.y + 1.6 && (wall === null || fraction < wall)) {
      if (hits) hits.push({ id, fraction });
      else if (fraction < nearestFraction) { nearestId = id; nearestFraction = fraction; }
    }
  }
  if (nearestId !== undefined) {
    hit(state, nearestId, timing, events, projectile.kind === 'arrow' ? 'bow' : 'staff', { x: -projectile.dx, z: -projectile.dz }, dt - elapsed + nearestFraction * distance / speed, projectile.damage ?? (projectile.owner === 'player' ? state.stats.damage : enemyAttackDamage));
    return false;
  }
  if (hits) {
    hits.sort((a, b) => a.fraction - b.fraction);
    for (const contact of hits) {
      hit(state, contact.id, timing, events, projectile.kind === 'arrow' ? 'bow' : 'staff', { x: -projectile.dx, z: -projectile.dz }, dt - elapsed + contact.fraction * distance / speed, projectile.damage ?? (projectile.owner === 'player' ? state.stats.damage : enemyAttackDamage));
      projectile.pierced!.push(contact.id);
    }
  }
  if (wall !== null) {
    events.push({ type: 'projectileImpact', kind: projectile.kind, position: { x: projectile.x + (to.x - projectile.x) * wall, z: projectile.z + (to.z - projectile.z) * wall } });
    return false;
  }
  projectile.x = to.x;
  projectile.z = to.z;
  projectile.remaining -= distance;
  return projectile.remaining > 0;
}

export function stepProjectiles(state: Encounter, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): void {
  if (!state.projectiles.length)
    return;
  // Keep the input stable while hit() may replace state.projectiles on a death.
  // Allocate a survivor list only once the first shot is consumed.
  const projectiles = state.projectiles;
  let survivors: Projectile[] | undefined;
  for (let index = 0; index < projectiles.length; index++) {
    const projectile = projectiles[index];
    if (advanceProjectile(state, projectile, dt, timing, events, movementWorld)) survivors?.push(projectile);
    else survivors ??= projectiles.slice(0, index);
  }
  const advanced = survivors ?? projectiles;
  // A later shot can kill the owner of an earlier surviving bolt. Preserve the
  // second pass, and copy only when that final owner check removes a shot.
  let live: Projectile[] | undefined;
  for (let index = 0; index < advanced.length; index++) {
    const projectile = advanced[index];
    if (projectile.owner === 'player' || state.enemies[projectile.owner].hp > 0) live?.push(projectile);
    else live ??= advanced.slice(0, index);
  }
  state.projectiles = live ?? advanced;
  if (state.player.hp <= 0)
    state.projectiles = [];
}
