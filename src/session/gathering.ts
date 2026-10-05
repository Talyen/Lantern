import type { Harvesting } from '../gameplay/harvesting';
import type { GatheringAction, GatheringEvent } from '../gameplay/gathering-action';
import type { MovementWorld } from '../gameplay/movement';
import type { AreaInstance } from '../levels/builder';
import type { ResourceDefinition } from '../levels/resources';
import type { CoreEffects } from '../rendering/effects';
import { Vector3 } from 'three';
import type { GameAudio } from '../audio/audio';
import type { GatheringTools } from '../rendering/gathering-tools';
import { play, type Actor } from './actors';

type GatheringPresentation = { instance(): AreaInstance | undefined; effects(): Pick<CoreEffects, 'burst'> | undefined };
/** Presents committed gathering events; numeric action state belongs to GatheringAction. */
export class GatheringController {
  private readonly contactPosition = new Vector3();
  constructor(
    private readonly action: GatheringAction,
    private readonly harvesting: Harvesting,
    private readonly actor: Actor,
    private readonly tools: Pick<GatheringTools, 'show'>,
    private readonly audio: Pick<GameAudio, 'play'>,
    private readonly context: GatheringPresentation,
  ) {}
  get target(): ResourceDefinition | null { return this.action.target; }
  get choppingId(): string | null { return this.action.choppingId; }
  select(resource: ResourceDefinition): void { this.action.select(resource); }
  cancel(releaseLock = true): void { this.action.cancel(releaseLock); }

  register(area: AreaInstance, navigation: MovementWorld): void {
    this.harvesting.register(area.area.id, area.resources);
    for (const resource of area.resources) {
      const felled = this.harvesting.state(area.area.id, resource.id)?.felled ?? false;
      navigation.setTreeFelled(resource.id, felled);
    }
    this.restore(area);
  }

  /** Rebuild resource appearance without touching collision or harvesting clocks. */
  restore(area: AreaInstance): void {
    for (const resource of area.resources) area.setResourceState(resource.id, this.harvesting.state(area.area.id, resource.id)?.felled ?? false);
    const swing = this.action.playback;
    this.tools.show(swing?.kind ?? null);
    if (swing) {
      play(this.actor, swing.kind === 'tree' ? 'chop' : 'mine');
      const action = this.actor.actions[swing.kind === 'tree' ? 'chop' : 'mine'];
      if (action) action.time = swing.time;
      this.actor.mixer?.update(0);
    }
  }

  present(events: GatheringEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'start': {
          const motion = event.resource.kind === 'tree' ? 'chop' : 'mine';
          this.tools.show(event.resource.kind);
          this.actor.current = null;
          play(this.actor, motion);
          this.audio.play('chopSwing', this.actor.root.position);
          break;
        }
        case 'stop':
          this.tools.show(null);
          if (this.actor.current === 'chop' || this.actor.current === 'mine') play(this.actor, 'idle');
          break;
        case 'regrown': this.context.instance()?.setResourceState(event.id, false); break;
        case 'contact': {
          const { resource, felled, origin } = event;
          const position = { x: resource.position[0], z: resource.position[2] };
          this.audio.play(resource.kind === 'tree' ? 'chopHit' : 'equipmentLand', position);
          this.contactPosition.set(position.x, resource.position[1] - .5, position.z);
          this.context.effects()?.burst(resource.kind === 'tree' ? 'debris' : 'chips', this.contactPosition, resource.kind === 'tree' ? 7 : 5);
          this.context.instance()?.treeHit(resource.id);
          if (felled) {
            if (resource.kind === 'tree') this.context.instance()?.fellTree(resource.id, origin);
            else this.context.instance()?.setResourceState(resource.id, true);
            if (resource.kind === 'tree') { this.audio.play('woodCrack', position); this.audio.play('treeFall', position); }
          }
          break;
        }
      }
    }
  }
}
