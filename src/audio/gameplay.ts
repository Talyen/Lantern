import type { ActorId, ActorState, Encounter, EncounterEvent, Motion } from '../gameplay/encounter';
import type { AdventureEvent } from '../gameplay/adventure';
import { GameAudio, type SoundCue, type SoundPosition } from './audio';

/** Maps numeric action/results to the authored mix; animation replays stay silent. */
export class GameplayAudio {
  private footsteps = new Map<ActorId, { x: number; z: number; phase: number; count: number }>();
  constructor(readonly audio: GameAudio) {}
  encounter(events: EncounterEvent[], state: Encounter): void {
    for (const event of events) {
      if (event.type === 'action') {
        const actor = event.actor === 'player' ? state.player : state.enemies[event.actor];
        if (event.action === 'dodge') this.audio.play('dodge', actor);
        else if (event.action === 'land') this.audio.play('land', actor);
        else if (event.action === 'attack') {
          if (event.weapon === 'staff') this.audio.play('magicCharge', actor, {key:`charge-${event.actor}`});
          else if (event.actor !== 'player') this.audio.play('raiderWindup', actor, {key:`windup-${event.actor}`});
          else if (event.weapon === 'axe' || event.weapon === 'sword') this.audio.play(event.weapon === 'axe' ? 'axeSwing' : 'swordSwing', actor);
        } else {
          this.audio.stop(`charge-${event.actor}`);
          if (event.weapon === 'bow') this.audio.play('bowRelease', actor);
          else if (event.weapon === 'staff') this.audio.play('magicRelease', actor);
          else if (event.actor !== 'player') this.audio.play('axeSwing', actor);
        }
      } else if (event.type === 'impact') {
        const actor = event.actor === 'player' ? state.player : state.enemies[event.actor];
        this.audio.play(event.blocked ? 'block' : event.weapon === 'staff' ? 'magicImpact' : event.weapon === 'bow' ? 'arrowImpact' : 'bodyImpact', actor);
        if (!event.blocked) this.audio.play(event.actor === 'player' ? event.lethal ? 'playerDeath' : 'playerHurt' : event.lethal ? 'enemyDeath' : 'enemyHurt', actor);
      } else if (event.type === 'projectileImpact') this.audio.play(event.kind === 'arrow' ? 'arrowImpact' : 'magicImpact', event.position);
      else if (event.type === 'outcome') this.audio.play(event.won ? 'victory' : 'defeat');
    }
    for (const id of ['player', 'enemy', 'caster'] as const) {
      const actor = id === 'player' ? state.player : state.enemies[id];
      if (actor.attackTime < 0 || actor.contactIndex > 0 || actor.hp <= 0) { this.audio.stop(`charge-${id}`); this.audio.stop(`windup-${id}`); }
    }
  }
  adventure(events: AdventureEvent[]): void {
    const mapping = {chestOpen:'chestOpen',returnCast:'returnCast',portalOpen:'portalOpen',portalClose:'portalClose',fireDiscovered:'fireDiscovered',healing:'healing'} as const;
    for (const event of events) {
      if (event.type === 'lootDrop' || event.type === 'lootLand' || event.type === 'lootPickup') {
        const cue: SoundCue = event.item === 'scroll' ? event.type === 'lootPickup' ? 'scrollPickup' : 'scrollDrop'
          : ['wood','stone','iron'].includes(event.item) ? event.type === 'lootPickup' ? 'reward' : event.type === 'lootLand' ? 'woodLand' : 'woodDrop'
          : event.type === 'lootPickup' ? 'equipmentReward' : event.type === 'lootLand' ? 'equipmentLand' : 'equipmentDrop';
        // Paper appearance is enough; avoid a second near-identical sound on landing.
        if (event.item !== 'scroll' || event.type !== 'lootLand') this.audio.play(cue,event.position);
      } else {
        if (event.type === 'portalOpen' || event.type === 'portalClose') this.audio.stop('return-cast');
        this.audio.play(mapping[event.type], event.position, event.type === 'returnCast' ? {key:'return-cast'} : {});
      }
    }
  }
  locomotion(id: ActorId, actor: ActorState, gait: number, motion: Motion | null, paused: boolean): void {
    const previous = this.footsteps.get(id), phase = Math.floor(gait * 2);
    const count = previous?.count ?? 0;
    this.footsteps.set(id, {x:actor.x,z:actor.z,phase,count});
    if (paused || actor.hp <= 0 || motion !== 'run' || !previous) return;
    const distance = Math.hypot(actor.x-previous.x,actor.z-previous.z);
    if (distance < .001 || distance > 1 || phase === previous.phase) return;
    this.audio.play('footstep', actor, {gain:id === 'player' ? 1 : .65});
    if (id === 'player' && count % 2 === 0) this.audio.play('gear', actor);
    this.footsteps.get(id)!.count++;
  }
  ambience(fires: {id:string;position:SoundPosition;camp:boolean}[], portal: SoundPosition | null, lantern: SoundPosition | null): void {
    this.audio.keepLoops(new Set(['woodland',...fires.map(fire=>`fire-${fire.id}`),...(portal ? ['portal-hum'] : []),...(lantern ? ['personal-lantern'] : [])]));
    this.audio.loop('woodland', 'woodland');
    // Keep at most the six nearest authored flames, including optional scenery.
    for (const fire of fires) this.audio.loop(`fire-${fire.id}`, fire.camp ? 'fire' : 'flame', fire.position);
    if (portal) this.audio.loop('portal-hum', 'portalHum', portal);
    else this.audio.stop('portal-hum');
    if (lantern) this.audio.loop('personal-lantern', 'flame', lantern, .2);
    else this.audio.stop('personal-lantern');
  }
  reset(): void { this.audio.clearArea(); this.footsteps.clear(); }
}
