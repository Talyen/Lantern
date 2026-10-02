import type { Adventure } from '../gameplay/adventure';
import type { Point } from '../gameplay/area';
import { type ActorId, type Encounter } from '../gameplay/encounter';
import { gatheringSafe, type Harvesting } from '../gameplay/harvesting';
import type { MovementWorld } from '../gameplay/movement';
import { gathering } from '../gameplay/skills';
import type { AreaInstance } from '../levels/builder';
import { resourceSkill, type ResourceDefinition } from '../levels/resources';
import type { AreaDefinition } from '../levels/types';
import type { GameAudio } from '../audio/audio';
import type { GatheringTools } from '../rendering/gathering-tools';
import { duration, play, type Actor } from './actors';

type GatheringContext = {
  area(): AreaDefinition;
  instance(): AreaInstance | undefined;
  navigation(): MovementWorld | undefined;
  paused(): boolean;
};
type Swing = { resource: ResourceDefinition; time: number; contacted: boolean };
type Occupant = { areaId: string; position: Point };

/** Coordinates gathering motions and contacts without changing equipped items. */
export class GatheringController {
  private selected: ResourceDefinition | null = null;
  private swing: Swing | null = null;
  private readonly occupantRecords: Record<ActorId, Occupant> = {
    player: { areaId: '', position: [0, 0] },
    enemy: { areaId: '', position: [0, 0] },
    caster: { areaId: '', position: [0, 0] },
  };
  private readonly occupants: Occupant[] = [];

  constructor(
    private readonly encounter: Encounter,
    private readonly adventure: Adventure,
    private readonly harvesting: Harvesting,
    private readonly actor: Actor,
    private readonly tools: GatheringTools,
    private readonly audio: GameAudio,
    private readonly context: GatheringContext,
  ) {}

  get target(): ResourceDefinition | null { return this.selected; }
  get choppingId(): string | null { return this.swing?.resource.id ?? null; }

  select(resource: ResourceDefinition): void {
    this.selected = resource;
    this.begin(resource);
  }

  cancel(releaseLock = true): void {
    this.selected = null;
    this.tools.show(null);
    if (!this.swing) return;
    this.swing = null;
    if (releaseLock) this.encounter.player.lock = 0;
    if (this.actor.current === 'chop' || this.actor.current === 'mine') play(this.actor, 'idle');
  }

  cancelIfInterrupted(movement: { x: number; z: number }, blocking: boolean): void {
    if (this.selected && (blocking || Math.hypot(movement.x, movement.z) > 0 ||
      this.encounter.player.hp <= 0 || !gatheringSafe(this.encounter, this.context.area().kind))) {
      this.cancel();
    }
  }

  register(area: AreaInstance, navigation: MovementWorld): void {
    this.harvesting.register(area.area.id, area.resources);
    for (const resource of area.resources) {
      const felled = this.harvesting.state(area.area.id, resource.id)?.felled ?? false;
      area.setResourceState(resource.id, felled);
      navigation.setTreeFelled(resource.id, felled);
    }
  }

  private visible(resource: ResourceDefinition): boolean {
    const [x, y, z] = resource.position;
    return !!this.context.navigation()?.resourceVisible(this.encounter.player, resource.id, { x, y, z });
  }

  private begin(resource: ResourceDefinition): void {
    const { player, attackCooldown, dodgeRemaining } = this.encounter;
    const motion = resource.kind === 'tree' ? 'chop' : 'mine';
    if (this.context.paused() || this.swing || !gatheringSafe(this.encounter, this.context.area().kind) ||
      player.lock > 0 || attackCooldown > 0 || dodgeRemaining > 0 || !this.actor.actions[motion]) return;
    if (this.harvesting.distance(resource, [player.x, player.z]) > gathering.reach || !this.visible(resource)) return;

    this.encounter.pending = null;
    player.attackTime = -1;
    this.encounter.blocking = false;
    player.yaw = Math.atan2(resource.position[0] - player.x, resource.position[2] - player.z);
    player.lock = duration(this.actor, motion);
    this.swing = { resource, time: 0, contacted: false };
    this.selected = resource;
    this.tools.show(resource.kind);
    this.actor.current = null;
    play(this.actor, motion);
    this.audio.play('chopSwing', player);
  }

  advance(dt: number): void {
    const area = this.context.area();
    const { player, enemies } = this.encounter;
    const occupants = this.occupants;
    occupants.length = 0;
    const playerOccupant = this.occupantRecords.player;
    playerOccupant.areaId = area.id; playerOccupant.position[0] = player.x; playerOccupant.position[1] = player.z;
    occupants.push(playerOccupant);
    if (area.kind !== 'safe') for (const id of this.encounter.enemyIds) {
      const enemy = enemies[id];
      if (enemy.hp <= 0) continue;
      const occupant = this.occupantRecords[id] ??= { areaId: '', position: [0, 0] };
      occupant.areaId = area.id; occupant.position[0] = enemy.x; occupant.position[1] = enemy.z;
      occupants.push(occupant);
    }
    for (const change of this.harvesting.advance(dt, occupants)) {
      if (change.areaId !== area.id) continue;
      this.context.instance()?.setResourceState(change.id, false);
      this.context.navigation()?.setTreeFelled(change.id, false);
    }

    const swing = this.swing;
    if (!swing) {
      if (this.selected) this.begin(this.selected);
      return;
    }
    swing.time += dt;
    const resource = swing.resource;
    const motion = resource.kind === 'tree' ? 'chop' : 'mine';
    const contactTime = motion === 'chop' ? this.actor.chopContact : this.actor.mineContact;
    if (!swing.contacted && swing.time >= contactTime) {
      swing.contacted = true;
      if (!this.visible(resource)) { this.cancel(); return; }
      const reward = this.harvesting.contact(area.id, resource.id, [player.x, player.z],
        this.adventure.character.xp[resourceSkill(resource.kind)]);
      if (!reward) { this.cancel(); return; }

      const position = { x: resource.position[0], z: resource.position[2] };
      this.audio.play(resource.kind === 'tree' ? 'chopHit' : 'equipmentLand', position);
      this.adventure.grantHarvest(reward.item, reward.quantity, reward.skill, reward.xpPerUnit,
        [position.x, position.z]);
      this.context.instance()?.treeHit(resource.id);
      if (reward.felled) {
        this.context.instance()?.setResourceState(resource.id, true);
        this.context.navigation()?.setTreeFelled(resource.id, true);
        if (resource.kind === 'tree') {
          this.audio.play('woodCrack', position);
          this.audio.play('treeFall', position);
        }
      }
    }

    if (swing.time >= duration(this.actor, motion)) {
      this.swing = null;
      player.lock = 0;
      if (this.harvesting.state(area.id, resource.id)?.felled) this.cancel();
      else this.begin(resource);
    }
  }
}
