import { constrain } from './area';
import { weaponFamily } from './equipment';
import {
  enemyNoticeRadius, enemyLeashRadius, enemyMaxHealth, casterAttackRange, type Encounter,
  type EncounterEvent, type EnemyId, type Motion, type Movement, type Projectile, type Timings,
} from './encounter-model';
import { hit } from './encounter-damage';
import { advanceProjectile, projectileLaunchClear } from './encounter-projectiles';

/** Keep authored packs legible without moving planted attacks or changing legacy solo fights. */
export function separateEnemies(state: Encounter, dt: number, movementWorld?: Movement): void {
  if (!state.layout.enemies)
    return;
  state.enemyIds.forEach((id, index) => {
    const enemy = state.enemies[id];
    if (enemy.hp <= 0 || enemy.lock > 0 || enemy.attackTime >= 0)
      return;
    for (const otherId of state.enemyIds) {
      if (otherId === id || state.enemies[otherId].hp <= 0)
        continue;
      const other = state.enemies[otherId], dx = enemy.x - other.x, dz = enemy.z - other.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= .75)
        continue;
      const angle = index * 2.4, amount = Math.min((.75 - distance) * .5, dt * enemy.speed * .5);
      const x = (distance > .001 ? dx / distance : Math.sin(angle)) * amount;
      const z = (distance > .001 ? dz / distance : Math.cos(angle)) * amount;
      if (movementWorld)
        movementWorld.move(id, enemy, x, z, dt);
      else
        [enemy.x, enemy.z] = constrain(state.layout.boundary, [enemy.x + x, enemy.z + z]);
    }
  });
}

export function stepEnemy(state: Encounter, id: EnemyId, dt: number, timing: Timings, events: EncounterEvent[], movementWorld: Movement | undefined, readyAfter: number): void {
  const player = state.player, enemy = state.enemies[id];
  const animate = (motion: Motion) => events.push({ type: 'animation', actor: id, motion });
  const spawn = enemy.home!;
  const dx = player.x - enemy.x, dz = player.z - enemy.z;
  const homeDistance = Math.hypot(enemy.x - spawn.position[0], enemy.z - spawn.position[1]);
  if (!enemy.engaged && !enemy.returning && Math.hypot(dx, dz) <= enemyNoticeRadius && (!movementWorld || movementWorld.lineOfSight(enemy, player)))
    enemy.engaged = true;
  if (enemy.engaged && (homeDistance > enemyLeashRadius || Math.hypot(dx, dz) > enemyLeashRadius)) {
    enemy.engaged = false;
    enemy.returning = true;
    enemy.attackTime = -1;
    enemy.contactIndex = 0;
  }
  if (enemy.returning) {
    if (homeDistance <= .2) {
      enemy.x = spawn.position[0];
      enemy.z = spawn.position[1];
      enemy.yaw = spawn.yaw;
      enemy.hp = enemyMaxHealth;
      enemy.lock = 0;
      enemy.cooldown = .8;
      enemy.returning = false;
      movementWorld?.move(id, enemy, 0, 0, dt);
      animate('idle');
    }
    else if (enemy.lock <= 0) {
      const home = { ...enemy, x: spawn.position[0], z: spawn.position[1] };
      const desired = movementWorld?.direction(enemy, home, dt) ?? { x: home.x - enemy.x, z: home.z - enemy.z };
      const length = Math.hypot(desired.x, desired.z), distance = Math.min(homeDistance, dt * enemy.speed);
      const x = length ? desired.x / length * distance : 0, z = length ? desired.z / length * distance : 0;
      if (movementWorld)
        movementWorld.move(id, enemy, x, z, dt);
      else {
        enemy.x += x;
        enemy.z += z;
      }
      if (length)
        enemy.yaw = Math.atan2(desired.x, desired.z);
      animate(length ? 'run' : 'idle');
    }
    return;
  }
  if (!enemy.engaged) {
    movementWorld?.move(id, enemy, 0, 0, dt);
    return;
  }
  if (enemy.kind === 'caster') {
    stepCaster(state, id, dt, timing, events, movementWorld, readyAfter);
    return;
  }
  let attackElapsed = dt;
  // Keep the pre-movement distance: the original encounter uses it to start an enemy strike.
  const distance = Math.hypot(dx, dz);
  if (enemy.lock <= 0 && (distance > 1.45 || Math.abs(player.y - enemy.y) >= .8 || movementWorld && !movementWorld.lineOfSight(enemy, player)) && enemy.attackTime < 0) {
    const desired = movementWorld?.direction(enemy, player, dt) ?? { x: dx, z: dz };
    const length = Math.hypot(desired.x, desired.z);
    if (movementWorld)
      movementWorld.move(id, enemy, length ? desired.x / length * dt * enemy.speed : 0, length ? desired.z / length * dt * enemy.speed : 0, dt);
    else if (length) {
      enemy.x += desired.x / length * dt * enemy.speed;
      enemy.z += desired.z / length * dt * enemy.speed;
    }
    [enemy.x, enemy.z] = constrain(state.layout.boundary, [enemy.x, enemy.z]);
    if (length)
      enemy.yaw = Math.atan2(desired.x, desired.z);
    animate('run');
  }
  else {
    movementWorld?.move(id, enemy, 0, 0, dt);
    if (enemy.lock <= 0 && enemy.attackTime < 0)
      animate('idle');
  }
  if (enemy.lock <= 0 && enemy.attackTime < 0 && enemy.cooldown <= 0 && distance <= 1.6 && (!movementWorld || movementWorld.lineOfSight(enemy, player)) && Math.abs(player.y - enemy.y) < .8) {
    enemy.attackTime = 0;
    enemy.contactIndex = 0;
    attackElapsed = Math.max(0, dt - readyAfter);
    enemy.cooldown = Math.max(0, timing[id].attack + 0.5 - attackElapsed);
    enemy.yaw = Math.atan2(dx, dz);
    events.push({ type: 'label', value: 'RAIDER ATTACKING' });
    animate('attack');
    events.push({ type: 'action', actor: id, action: 'attack', weapon: weaponFamily(enemy.loadout.main) });
  }
  if (enemy.attackTime >= 0) {
    enemy.attackTime += attackElapsed;
    while (enemy.contactIndex < timing[id].contacts.length && enemy.attackTime >= timing[id].contacts[enemy.contactIndex]) {
      enemy.contactIndex++;
      events.push({ type: 'action', actor: id, action: 'contact', weapon: weaponFamily(enemy.loadout.main) });
      const contactDx = player.x - enemy.x, contactDz = player.z - enemy.z, reach = Math.hypot(contactDx, contactDz);
      const facing = reach > 0 ? (Math.sin(enemy.yaw) * contactDx + Math.cos(enemy.yaw) * contactDz) / reach : 1;
      if (facing >= .5 && Math.hypot(player.x - enemy.x, player.z - enemy.z) <= 1.8 && (!movementWorld || movementWorld.lineOfSight(enemy, player)) && Math.abs(player.y - enemy.y) < .8)
        hit(state, 'player', timing, events, weaponFamily(enemy.loadout.main) ?? undefined, { x: enemy.x - player.x, z: enemy.z - player.z }, dt - attackElapsed + Math.max(0, timing[id].contacts[enemy.contactIndex - 1] - (enemy.attackTime - attackElapsed)));
      if (state.phase !== 'playing')
        return;
    }
    if (enemy.attackTime >= timing[id].attack) {
      enemy.attackTime = -1;
      events.push({ type: 'label', value: 'DEFEAT THE RAIDER' });
    }
  }
  return;
}

/** Caster aim commits at windup; damage interrupts it through the same hit owner as melee. */
function stepCaster(state: Encounter, id: EnemyId, dt: number, timing: Timings, events: EncounterEvent[], movementWorld: Movement | undefined, readyAfter: number): void {
  const player = state.player, enemy = state.enemies[id];
  const dx = player.x - enemy.x, dz = player.z - enemy.z, distance = Math.hypot(dx, dz);
  let attackElapsed = dt;
  const visible = !movementWorld || movementWorld.lineOfSight(enemy, player);
  if (enemy.attackTime < 0 && enemy.lock <= 0 && (distance > casterAttackRange || Math.abs(player.y - enemy.y) >= .8 || !visible)) {
    const desired = movementWorld?.direction(enemy, player, dt) ?? { x: dx, z: dz };
    const length = Math.hypot(desired.x, desired.z);
    const x = length ? desired.x / length * dt * enemy.speed : 0, z = length ? desired.z / length * dt * enemy.speed : 0;
    if (movementWorld)
      movementWorld.move(id, enemy, x, z, dt);
    else {
      enemy.x += x;
      enemy.z += z;
    }
    [enemy.x, enemy.z] = constrain(state.layout.boundary, [enemy.x, enemy.z]);
    if (length)
      enemy.yaw = Math.atan2(desired.x, desired.z);
    events.push({ type: 'animation', actor: id, motion: length ? 'run' : 'idle' });
  }
  else {
    movementWorld?.move(id, enemy, 0, 0, dt);
    if (enemy.attackTime < 0 && enemy.lock <= 0)
      events.push({ type: 'animation', actor: id, motion: 'idle' });
  }
  if (enemy.attackTime < 0 && enemy.lock <= 0 && enemy.cooldown <= 0 && distance <= casterAttackRange && visible && Math.abs(player.y - enemy.y) < .8) {
    enemy.yaw = Math.atan2(dx, dz);
    enemy.attackTime = 0;
    enemy.contactIndex = 0;
    attackElapsed = Math.max(0, dt - readyAfter);
    enemy.cooldown = Math.max(0, timing[id].attack + .5 - attackElapsed);
    events.push({ type: 'label', value: 'CASTER ATTACKING' }, { type: 'animation', actor: id, motion: 'attack' }, { type: 'action', actor: id, action: 'attack', weapon: 'staff' });
  }
  if (enemy.attackTime < 0)
    return;
  enemy.attackTime += attackElapsed;
  const release = timing[id].contacts[0];
  if (enemy.contactIndex === 0 && enemy.attackTime >= release) {
    enemy.contactIndex = 1;
    events.push({ type: 'action', actor: id, action: 'contact', weapon: 'staff' });
    const dx = Math.sin(enemy.yaw), dz = Math.cos(enemy.yaw);
    const projectile: Projectile = { id: ++state.nextProjectile, owner: id, kind: 'bolt', x: enemy.x + dx * .35, y: enemy.y + 1.08, z: enemy.z + dz * .35, dx, dz, remaining: 12, firstStep: Math.min(dt, enemy.attackTime - release) };
    if (projectileLaunchClear(projectile, enemy, events, movementWorld) && advanceProjectile(state, projectile, dt, timing, events, movementWorld))
      state.projectiles.push(projectile);
  }
  if (enemy.attackTime >= timing[id].attack) {
    enemy.attackTime = -1;
    events.push({ type: 'label', value: 'DEFEAT THE CASTER' }, { type: 'animation', actor: id, motion: 'idle' });
  }
}
