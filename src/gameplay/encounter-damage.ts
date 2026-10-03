import type { Weapon } from './equipment';
import { armoredDamage } from './combat-stats';
import { enemyAttackDamage, type ActorId, type Encounter, type EncounterEvent, type Timings } from './encounter-model';

/** Shared damage, interruption and outcome rules for melee and projectile contacts. */
export function hit(state: Encounter, actor: ActorId, timing: Timings, events: EncounterEvent[], source?: Weapon, incoming?: {
  x: number;
  z: number;
}, impactOffset = 0, rawDamage = enemyAttackDamage, origin?: Extract<EncounterEvent, {type: 'impact'}>['origin']): void {
  const immunity = impactOffset < state.dodgeFrameOffset ? state.invulnerabilityBeforeDodge : state.invulnerability;
  if ((actor === 'player' ? state.player : state.enemies[actor]).hp <= 0 || actor === 'player' && immunity > impactOffset)
    return;
  const target = actor === 'player' ? state.player : state.enemies[actor];
  let damage = actor !== 'player' ? rawDamage : armoredDamage(rawDamage, state.stats.armor);
  let blocked = false;
  if (actor === 'player' && state.blocking && impactOffset >= state.blockFrameOffset) {
    // Projectiles are blocked by their incoming direction, even if the caster has moved.
    const dx = incoming?.x ?? 0, dz = incoming?.z ?? 0, distance = Math.hypot(dx, dz);
    if (distance && (Math.sin(target.yaw) * dx + Math.cos(target.yaw) * dz) / distance >= .5) {
      damage *= .5;
      blocked = true;
    }
  }
  target.hp = Math.max(0, target.hp - damage);
  if (actor !== 'player' && source === 'axe')
    events.push({ type: 'axeXp' });
  if (actor !== 'player' && !state.enemies[actor].returning)
    state.enemies[actor].engaged = true;
  // A successful shield block retains the stance; rear hits interrupt normally.
  const enemy = actor !== 'player' ? state.enemies[actor] : null;
  const contact = timing[actor].contacts[0];
  const committed = enemy?.kind === 'raider' && (timing[actor].commitLead ?? 0) > 0 && target.attackTime >= 0 && target.attackTime + impactOffset >= Math.max(0, contact - (timing[actor].commitLead ?? 0)) && target.attackTime < contact && target.hp > 0;
  if (!blocked && !committed) {
    target.lock = timing[actor].hit;
    target.attackTime = -1;
  }
  if (actor === 'player') {
    state.dodgeFrameOffset = state.invulnerabilityBeforeDodge = 0;
    state.invulnerability = .65 + impactOffset;
    state.dodgeRemaining = 0;
    state.pending = null;
    if (!blocked)
      state.blocking = false;
  }
  else if (!committed)
    target.contactIndex = 0;
  events.push({ type: 'hit', actor }, { type: 'impact', actor, weapon: source ?? null, damage, position: { x: target.x, y: target.y, z: target.z }, blocked, lethal: target.hp <= 0, ...(origin ? { origin } : {}) });
  if (!blocked && !committed)
    events.push({ type: 'animation', actor, motion: 'hit' });
  if (target.hp <= 0) {
    const won = actor !== 'player';
    state.projectiles = won ? state.projectiles.filter(projectile => projectile.owner !== actor) : [];
    events.push({ type: 'animation', actor, motion: 'death' });
    if (!won || state.enemyIds.every(id => state.enemies[id].hp <= 0)) {
      state.phase = won ? 'won' : 'lost';
      state.pending = null;
      state.blocking = false;
    }
    if (!won || state.enemyIds.every(id => state.enemies[id].hp <= 0 || !state.layout.enemies && !state.enemies[id].engaged))
      events.push({ type: 'outcome', won });
  }
}
