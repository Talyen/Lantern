import type { SkillXP } from './skills';
import type { AbilityId, WeaponSet } from './abilities';
import type { Loadout, Weapon } from './equipment';
import { baseStats, type CombatStats } from './combat-stats';
import type { EncounterLayout, Spawn, EnemyRig } from './area';

/** Encounter simulation. Positions, clocks and animation timings use world units and seconds. */
export type EnemyId = string;
export type ActorId = 'player' | EnemyId;
export type EnemyKind = 'raider' | 'caster';
export type Motion = 'idle' | 'run' | 'attack' | 'hit' | 'death' | 'dodge' | 'block' | 'chop' | 'sweep' | 'pierce' | 'mine' | 'crush' | 'battleCry';
export type Phase = 'loading' | 'playing' | 'won' | 'lost';
export type ActorState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  speed: number;
  lock: number;
  attackTime: number;
  contactIndex: number;
};
export type EnemyState = ActorState & {
  kind: EnemyKind;
  rig: EnemyRig;
  loadout: Loadout;
  home?: Spawn;
  engaged: boolean;
  returning: boolean;
  cooldown: number;
  lowestHp: number;
  /** Future protected attacks explicitly opt into a heavy-interruption window. */
  interruption?: 'protected' | 'heavy-window';
};
export const playerMaxHealth = baseStats.maxHealth, enemyMaxHealth = 200, playerMaxMana = baseStats.maxMana;
export const enemyAttackDamage = 20;
export const enemyNoticeRadius = 6, enemyLeashRadius = 10;
export const dodgeDuration = 0.45, dodgeDistance = 2.4, dodgeInvulnerability = 0.25, dodgeCooldown = 1;
export type Projectile = {
  id: number;
  owner: ActorId;
  kind: 'arrow' | 'bolt';
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  remaining: number;
  firstStep?: number;
  damage?: number;
  pierced?: ActorId[];
  impactId?: number;
  ability?: AbilityId | null;
};
export const casterAttackRange = 6, casterBoltSpeed = 8;
export type PendingInput = {
  remaining: number;
} & ({
  kind: 'attack';
  aim?: AimPoint;
} | {
  kind: 'ability';
  ability: AbilityId;
  aim?: AimPoint;
} | {
  kind: 'dodge';
  direction: AimPoint;
  aim?: AimPoint;
} | {
  kind: 'swap';
});
export type PlayerAction = {
  impactId?: number;
  duration: number;
  contacts: readonly number[];
  damage: number;
  rate: number;
  reach: number;
  arc: number;
  weapon: Weapon;
  ability: AbilityId | null;
};
export type Encounter = {
  phase: Phase;
  layout: EncounterLayout;
  player: ActorState;
  enemyIds: EnemyId[];
  enemies: Record<EnemyId, EnemyState>;
  weapon: Weapon | null;
  shield: boolean;
  blocking: boolean;
  blockFrameOffset: number;
  pending: PendingInput | null;
  projectiles: Projectile[];
  nextProjectile: number;
  nextImpact?: number;
  stats: CombatStats;
  setStats: [CombatStats, CombatStats];
  attackCooldown: number;
  invulnerability: number;
  playerMana: number;
  weaponSets: [Loadout, Loadout];
  activeSet: WeaponSet;
  abilityCooldowns: Partial<Record<AbilityId, number>>;
  ultimateCooldown: number;
  berserkingRemaining: number;
  proficiency: Partial<SkillXP>;
  potionCooldown: number;
  playerAction: PlayerAction | null;
  // Within-frame dodge onset lets contacts retain pre-unlock damage/immunity.
  dodgeRemaining: number;
  dodgeCooldown: number;
  dodgeFrameOffset: number;
  invulnerabilityBeforeDodge: number;
  dodgeDirection: {
    x: number;
    z: number;
  };
};
export type ActorTiming = {
  attack: number;
  hit: number;
  contacts: readonly number[];
  commitLead?: number;
  abilities?: Partial<Record<AbilityId, {
    attack: number;
    contacts: readonly number[];
  }>>;
};
export type Timings = Record<ActorId, ActorTiming>;
export type Movement = {
  move(id: ActorId, actor: ActorState, dx: number, dz: number, dt: number): void;
  direction(from: ActorState, to: ActorState, dt: number): {
    x: number;
    z: number;
  };
  lineOfSight(from: ActorState, to: ActorState): boolean;
  segmentHit?(from: {
    x: number;
    y: number;
    z: number;
  }, to: {
    x: number;
    y: number;
    z: number;
  }): number | null;
};
export type AimPoint = {
  x: number;
  z: number;
};
export type Input = {
  x: number;
  z: number;
  paused: boolean;
  aim?: AimPoint;
  block?: boolean;
};
export type EncounterEvent = {
  type: 'weaponSet';
  set: WeaponSet;
} | {
  type: 'animation';
  actor: ActorId;
  motion: Motion;
} | {
  type: 'hit';
  actor: ActorId;
} | {
  type: 'action';
  actor: ActorId;
  action: 'attack' | 'contact' | 'dodge' | 'land' | 'battleCry' | 'berserking';
  weapon: Weapon | null;
} | {
  type: 'impact';
  origin?: { actor: ActorId; ability: AbilityId | null; id: number };
  actor: ActorId;
  damage: number;
  position: { x: number; y: number; z: number };
  weapon: Weapon | null;
  blocked: boolean;
  lethal: boolean;
} | {
  type: 'projectileImpact';
  kind: 'arrow' | 'bolt';
  position: {
    x: number;
    z: number;
  };
} | {
  type: 'proficiency';
  family: 'axe' | 'sword' | 'bow';
  amount: number;
} | {
  type: 'label';
  value: 'MOVE TO BEGIN' | 'DEFEAT THE RAIDER' | 'RAIDER ATTACKING' | 'DEFEAT THE CASTER' | 'CASTER ATTACKING';
} | {
  type: 'outcome';
  won: boolean;
};
