import type { GameplayAudio } from '../audio/gameplay';
import { type ActorId, type Encounter, type EncounterEvent } from '../gameplay/encounter';
import type { WeaponSet } from '../gameplay/abilities';
import type { CoreEffects } from '../rendering/effects';
import type { createHud } from '../ui/hud';
import { duration, play, type Actor } from './actors';

type PresentationContext = {
  effects(): CoreEffects | undefined;
  weaponSet(set: WeaponSet): void;
  axeXp(): void;
  playerHit(unblocked: boolean): void;
};

/** Presents ordered simulation events; the coordinator retains progress and input decisions. */
export class EncounterPresentation {
  constructor(
    private readonly encounter: Encounter,
    private readonly actors: Record<ActorId, Actor>,
    private readonly audio: GameplayAudio,
    private readonly hud: Pick<ReturnType<typeof createHud>, 'update'>,
    private readonly context: PresentationContext,
  ) {}

  present(events: EncounterEvent[]): void {
    for (const id in this.actors) {
      const actor = this.actors[id];
      const state = id === 'player' ? this.encounter.player : this.encounter.enemies[id];
      actor.root.position.set(state.x, state.y + .04, state.z);
      actor.root.rotation.y = state.yaw;
    }
    for (const event of events) {
      switch (event.type) {
        case 'weaponSet': this.context.weaponSet(event.set); break;
        case 'axeXp': this.context.axeXp(); break;
        case 'hit': {
          if (event.actor === 'player') {
            this.context.playerHit(events.some(impact => impact.type === 'impact' && impact.actor === 'player' && !impact.blocked));
          }
          break;
        }
        case 'animation':
          play(this.actors[event.actor], event.motion, event.actor === 'player' ? this.encounter.playerAction?.rate ?? 1 : 1);
          break;
        case 'impact': {
          const effects = this.context.effects(), position = this.actors[event.actor].root.position;
          const skill = event.origin?.ability === 'sweep' || event.origin?.ability === 'piercing-shot';
          effects?.burst(event.blocked ? 'sparks' : 'hit', position, event.blocked ? 7 : skill ? 16 : event.weapon === 'axe' ? 11 : 8);
          break;
        }
        // These events are presented by GameplayAudio and the HUD below.
        case 'action': case 'projectileImpact': case 'label': case 'outcome': break;
      }
    }
    this.audio.encounter(events, this.encounter);
    this.hud.update(this.encounter, events);
  }

  resetActors(safe: boolean): void {
    for (const actor of Object.values(this.actors)) {
      actor.mixer?.stopAllAction();
      actor.current = null;
      actor.previous = null;
      actor.velocity.set(0, 0);
    }
    for (const id of this.encounter.enemyIds.filter(id => this.actors[id])) this.actors[id].root.visible = !safe && !!this.encounter.enemies[id].home;
    this.present([
      { type: 'animation', actor: 'player', motion: 'idle' },
      ...this.encounter.enemyIds.filter(id => this.actors[id]).map(id => ({
        type: 'animation' as const, actor: id,
        motion: this.encounter.enemies[id].hp <= 0 ? 'death' as const : 'idle' as const,
      })),
    ]);
    for (const id of this.encounter.enemyIds.filter(id => this.actors[id])) {
      const death = this.actors[id].actions.death;
      if (this.encounter.enemies[id].hp <= 0 && death) death.time = duration(this.actors[id], 'death');
    }
  }
}
