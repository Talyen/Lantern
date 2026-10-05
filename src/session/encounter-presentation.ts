import { Vector3 } from 'three';
import { abilities } from '../gameplay/abilities';
import type { GameplayAudio } from '../audio/gameplay';
import { type ActorId, type Encounter, type EncounterEvent } from '../gameplay/encounter';
import type { WeaponSet } from '../gameplay/abilities';
import type { CoreEffects } from '../rendering/effects';
import type { createHud } from '../ui/hud';
import { duration, play, type Actor } from './actors';

type PresentationContext = {
  effects(): CoreEffects | undefined;
  weaponSet(set: WeaponSet): void;
  proficiency(family:'axe' | 'sword' | 'bow',amount:number): void;
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
        case 'proficiency': this.context.proficiency(event.family,event.amount); break;
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
          if (event.periodic) break;
          const effects = this.context.effects(), position = this.actors[event.actor].root.position;
          const skill = event.origin?.ability && abilities[event.origin.ability].tier!=='basic';
          const source = event.origin?.actor === 'player' ? this.encounter.player : event.origin ? this.encounter.enemies[event.origin.actor] : undefined;
          const target = event.actor === 'player' ? this.encounter.player : this.encounter.enemies[event.actor];
          if (!event.blocked && event.damage > 0 && event.actor !== 'player' && this.encounter.enemies[event.actor].rig !== 'skeleton' && event.weapon && ['axe', 'sword', 'bow'].includes(event.weapon)) {
            const dx = source ? target.x - source.x : Math.sin(target.yaw), dz = source ? target.z - source.z : Math.cos(target.yaw), length = Math.hypot(dx, dz) || 1;
            effects?.fluids.blood(event.position.x, event.position.y, event.position.z, dx / length, dz / length, !!skill || event.lethal);
          }
          if (event.weapon === 'staff' && event.actor === 'player' && !event.blocked && event.damage > 0) event.damageType==='burn' ? effects?.burst('fire',new Vector3(event.position.x,event.position.y+.85,event.position.z),9) : effects?.fluids.magic(event.position.x, event.position.y + .85, event.position.z);
          effects?.burst(event.blocked ? 'sparks' : 'hit', position, event.blocked ? 7 : skill ? 16 : event.weapon === 'axe' ? 11 : 8);
          break;
        }
        // These events are presented by GameplayAudio and the HUD below.
        case 'action': if (event.action==='berserking') this.context.effects()?.burst('sparks',this.actors.player.root.position,12); break;
        case 'projectileImpact':
          if (event.kind === 'bolt' && event.owner && event.owner !== 'player') event.damageType==='burn' ? this.context.effects()?.burst('fire',new Vector3(event.position.x,event.position.y ?? .85,event.position.z),9) : this.context.effects()?.fluids.magic(event.position.x, event.position.y ?? .85, event.position.z);
          break;
        case 'abilityCommitted': case 'abilityCancelled': case 'label': case 'outcome': break;
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
