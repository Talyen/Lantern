import type { ActorId, ActorState, Encounter, EncounterEvent, Motion } from '../gameplay/encounter';
import type { AdventureEvent } from '../gameplay/adventure';
import type { AreaDefinition } from '../levels/types';
import { type GameAudio, type SoundCue, type SoundPosition } from './audio';

type AuthoredFire = Pick<AreaDefinition['effects']['fires'][number], 'id' | 'position' | 'role'>;
type AmbientFlame = { key: string; position: SoundPosition; camp: boolean; distance: number };

/** Maps numeric action/results to the authored mix; animation replays stay silent. */
export class GameplayAudio {
  private footsteps = new Map<ActorId, { x: number; z: number; phase: number; count: number }>();
  private fireDefinitions?: readonly AuthoredFire[];
  private authoredFlames: AmbientFlame[] = [];
  private nearestFlames: AmbientFlame[] = [];
  private loopKeys = new Set<string>();
  constructor(readonly audio: GameAudio) {}
  encounter(events: EncounterEvent[], state: Encounter): void {
    for (const event of events) {
      if (event.type==='impact' && event.periodic) continue;
      if (event.type === 'action') {
        const actor = event.actor === 'player' ? state.player : state.enemies[event.actor];
        if (event.action === 'battleCry') this.audio.play('battleCry', actor);
        else if(event.action === 'berserking') this.audio.play('gear', actor, { gain: .6 });
        else if (event.action === 'dodge') this.audio.play('dodge', actor);
        else if (event.action === 'land') this.audio.play('land', actor);
        else if (event.action === 'attack') {
          if (event.weapon === 'staff') this.audio.play('magicCharge', actor, {key:`charge-${event.actor}`});
          else if (event.actor !== 'player' && state.enemies[event.actor].rig !== 'skeleton') this.audio.play('raiderWindup', actor, {key:`windup-${event.actor}`});
          else if (event.actor === 'player' && !['thrust','riposte','executioner','onslaught'].includes(state.playerAction?.ability ?? '') && (event.weapon === 'axe' || event.weapon === 'sword')) this.audio.play(event.weapon === 'axe' ? 'axeSwing' : 'swordSwing', actor);
        } else {
          if (event.ability && ['thrust','riposte','executioner','onslaught'].includes(event.ability)) this.audio.play('swordSwing',actor);
          this.audio.stop(`charge-${event.actor}`);
          if (event.weapon === 'bow') this.audio.play('bowRelease', actor);
          else if (event.weapon === 'staff') this.audio.play('magicRelease', actor);
          else if (event.actor !== 'player') this.audio.play(event.weapon === 'sword' ? 'swordSwing' : 'axeSwing', actor);
        }
      } else if (event.type === 'impact') {
        const actor = event.actor === 'player' ? state.player : state.enemies[event.actor];
        const skill=event.origin?.ability==='sweep' || event.origin?.ability==='piercing-shot' || event.origin?.ability==='crushing-blow';
        this.audio.play(event.blocked ? 'block' : event.weapon === 'staff' ? 'magicImpact' : event.weapon === 'bow' ? 'arrowImpact' : 'bodyImpact', actor, {gain:skill ? 1.12 : 1,rate:event.blocked ? 1 : event.weapon==='axe' ? .92 : event.weapon==='sword' ? 1.05 : 1});
        if (!event.blocked) this.audio.play(event.actor === 'player' ? event.lethal ? 'playerDeath' : 'playerHurt' : state.enemies[event.actor].rig === 'skeleton' ? event.lethal ? 'skeletonDeath' : 'skeletonHurt' : event.lethal ? 'enemyDeath' : 'enemyHurt', actor);
      } else if (event.type === 'projectileImpact') this.audio.play(event.kind === 'arrow' ? 'arrowImpact' : 'magicImpact', event.position);
      else if (event.type === 'outcome') this.audio.play(event.won ? 'victory' : 'defeat');
    }
    for (const id of ['player', ...state.enemyIds]) {
      const actor = id === 'player' ? state.player : state.enemies[id];
      if (actor.attackTime < 0 || actor.contactIndex > 0 || actor.hp <= 0) { this.audio.stop(`charge-${id}`); this.audio.stop(`windup-${id}`); }
    }
  }
  adventure(events: AdventureEvent[]): void {
    const mapping = {chestOpen:'chestOpen',returnCast:'returnCast',portalOpen:'portalOpen',portalClose:'portalClose',fireDiscovered:'fireDiscovered',healing:'healing',potionUse:'healing'} as const;
    for (const event of events) {
      if (event.type==='abilityLearned' || event.type==='enemyRenewed') continue;
      if (event.type === 'healthRecovered') continue;
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
    if (!previous) { this.footsteps.set(id, {x:actor.x,z:actor.z,phase,count:0}); return; }
    const { x, z, phase: oldPhase, count } = previous;
    previous.x = actor.x; previous.z = actor.z; previous.phase = phase;
    if (paused || actor.hp <= 0 || motion !== 'run') return;
    const distance = Math.hypot(actor.x-x,actor.z-z);
    if (distance < .001 || distance > 1 || phase === oldPhase) return;
    this.audio.play('footstep', actor, {gain:id === 'player' ? 1 : .65});
    if (id === 'player' && count % 2 === 0) this.audio.play('gear', actor);
    previous.count++;
  }
  ambience(fires: readonly AuthoredFire[], listener: SoundPosition, portal: SoundPosition | null, lantern: SoundPosition | null, ambience: 'woodland' | 'quiet' = 'woodland', rain = false): void {
    if (this.fireDefinitions !== fires) {
      this.fireDefinitions = fires;
      this.authoredFlames = fires.map(fire => ({key:`fire-${fire.id}`,position:{x:fire.position[0],z:fire.position[1]},camp:fire.role==='campfire',distance:0}));
    }
    // Refill before stable sorting so ties always retain authored order.
    this.nearestFlames.length = 0;
    for (const flame of this.authoredFlames) {
      flame.distance = Math.hypot(flame.position.x-listener.x,flame.position.z-listener.z);
      this.nearestFlames.push(flame);
    }
    this.nearestFlames.sort((a, b) => a.distance - b.distance);
    this.nearestFlames.length = Math.min(6, this.nearestFlames.length);
    this.loopKeys.clear(); if(rain)this.loopKeys.add('rain'); if (ambience === 'woodland') this.loopKeys.add('woodland');
    for (const fire of this.nearestFlames) this.loopKeys.add(fire.key);
    if (portal) this.loopKeys.add('portal-hum');
    if (lantern) this.loopKeys.add('personal-lantern');
    this.audio.keepLoops(this.loopKeys);
    if (ambience === 'woodland') this.audio.loop('woodland', 'woodland');
    if(rain)this.audio.loop('rain','rain');
    // Keep at most the six nearest authored flames, including optional scenery.
    for (const fire of this.nearestFlames) this.audio.loop(fire.key, fire.camp ? 'fire' : 'flame', fire.position);
    if (portal) this.audio.loop('portal-hum', 'portalHum', portal);
    else this.audio.stop('portal-hum');
    if (lantern) this.audio.loop('personal-lantern', 'flame', lantern, .2);
    else this.audio.stop('personal-lantern');
  }
  reset(): void { this.audio.clearArea(); this.footsteps.clear(); this.fireDefinitions = undefined; this.authoredFlames.length = 0; this.nearestFlames.length = 0; this.loopKeys.clear(); }
}
