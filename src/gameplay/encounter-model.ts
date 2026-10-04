import type { DamageType } from './damage';
import type { SkillXP } from './skills';
import type { AbilityId, WeaponSet } from './abilities';
import type { Loadout, Weapon } from './equipment';
import { baseStats, type CombatStats } from './combat-stats';
import type { EncounterLayout, Spawn, EnemyRig, EnemyInterruption } from './area';

/** Encounter simulation. Positions, clocks and animation timings use world units and seconds. */
export type EnemyId = string;
export type ActorId = 'player' | EnemyId;
export type EnemyKind = 'raider' | 'caster';
export type Motion = 'idle' | 'run' | 'attack' | 'hit' | 'death' | 'dodge' | 'block' | 'chop' | 'sweep' | 'pierce' | 'mine' | 'thrust' | 'riposte' | 'riposte-stance' | 'executioner' | 'onslaught' | 'arrow-rain' | 'deadeye' | 'crush' | 'battleCry';
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
  damageType: DamageType;
  rig: EnemyRig;
  loadout: Loadout;
  home?: Spawn;
  engaged: boolean;
  returning: boolean;
  cooldown: number;
  lowestHp: number;
  interruption: EnemyInterruption;
  poison?: {remaining:number; nextTick:number; damage:number; impactId:number; firstStep?:number};
};
export const playerMaxHealth = baseStats.maxHealth, enemyMaxHealth = 200, playerMaxMana = baseStats.maxMana;
export const enemyAttackDamage = 20;
export const healthRegeneration = { delay: 8, rate: .005 } as const;
export const enemyNoticeRadius = 6, enemyLeashRadius = 10;
export const dodgeDuration = 0.45, dodgeDistance = 2.4, dodgeInvulnerability = 0.25, dodgeCooldown = 1;
export type Projectile = {
  id: number;
  owner: ActorId;
  kind: 'arrow' | 'bolt';
  damageType?: DamageType;
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
  poisonDamage?: number;
  sharedHits?: ActorId[];
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
  lunge?: { x: number; z: number; distance: number; advanced: number; stopped: boolean };
  damageType?: DamageType;
  impactId?: number;
  committed?: boolean;
  mana?: number;
  cooldown?: number;
  baseDamage?: number;
  aim?: AimPoint;
  target?: EnemyId;
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
  frameElapsed?: number;
  frameManaStart?: number;
  proficiency: Partial<SkillXP>;
  ultimateCooldown: number;
  berserkingRemaining: number;
  riposte?: {remaining:number; action:PlayerAction; frameOffset?:number};
  rains: {damageType?:DamageType; id:number; x:number; y:number; z:number; age:number; damage:number; pulse:number; rate:number; firstStep?:number}[];
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
  healthRecoveryDelay: number;
  healthRecoveryElapsed: number;
  weaponSets: [Loadout, Loadout];
  activeSet: WeaponSet;
  abilityCooldowns: Partial<Record<AbilityId, number>>;
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
export type MovementMode = 'walk' | 'dodge' | 'lunge';
export type MovementActor = { id: ActorId; state: ActorState; dodging?: boolean };
export type MovementResult = { x: number; y: number; z: number; blocked: boolean };
export type Movement = {
  syncActors?(actors: readonly MovementActor[]): void;
  releaseDodge?(id: ActorId): void;
  approach?(id: ActorId, actor: ActorState, target: ActorState, kind: EnemyKind, dt: number): ActorState;
  steer?(id: ActorId, actor: ActorState, x: number, z: number, dt: number, seeking?: boolean): { x: number; z: number };
  attackGround?(from: ActorState, point: AimPoint): (AimPoint & {y:number}) | null;
  move(id: ActorId, actor: ActorState, dx: number, dz: number, dt: number, mode?: MovementMode, dodgeDistance?: number): MovementResult | void;
  direction(from: ActorState, to: ActorState, dt: number): {
    x: number;
    z: number;
  };
  lineOfSight(from: Pick<ActorState,'x' | 'y' | 'z'>, to: Pick<ActorState,'x' | 'y' | 'z'>): boolean;
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
  y?: number;
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
  ability?: AbilityId;
} | {
  type: 'impact';
  damageType?: DamageType;
  origin?: { actor: ActorId; ability: AbilityId | null; id: number };
  actor: ActorId;
  damage: number;
  position: { x: number; y: number; z: number };
  weapon: Weapon | null;
  blocked: boolean;
  lethal: boolean;
  periodic?: boolean;
} | {
  type: 'projectileImpact';
  owner?: ActorId;
  kind: 'arrow' | 'bolt';
  damageType?: DamageType;
  position: {
    x: number;
    y?: number;
    z: number;
  };
} | {
  type: 'proficiency';
  family: 'axe' | 'sword' | 'bow';
  amount: number;
} | {
  type: 'abilityCommitted';
  ability: AbilityId;
  id: number;
} | {
  type: 'abilityCancelled';
  ability: AbilityId | null;

} | {
  type: 'label';
  value: 'MOVE TO BEGIN' | 'DEFEAT THE RAIDER' | 'RAIDER ATTACKING' | 'DEFEAT THE CASTER' | 'CASTER ATTACKING';
} | {
  type: 'outcome';
  won: boolean;
};
