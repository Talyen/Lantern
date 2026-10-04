import { arrowRainSequence } from './arrow-rain-sequence';
import { hit } from './encounter-damage';
import type { Encounter, EncounterEvent, Movement, Timings } from './encounter-model';

/** Numeric effects keep rewards independent from particle density and render clocks. */
export function stepCombatEffects(state: Encounter, dt: number, timing: Timings, events: EncounterEvent[], movement?: Movement): void {
  if (state.phase==='lost') return;
  for (const id of state.enemyIds) {
    const poison=state.enemies[id].poison;
    if (!poison) continue;
    const elapsed=poison.firstStep ?? dt; poison.firstStep=undefined;
    advancePoison(state,id,elapsed,timing,events,dt-elapsed);
  }
  for (const rain of state.rains) {
    const elapsed=rain.firstStep ?? dt; rain.firstStep=undefined; rain.age+=elapsed*rain.rate;
    const contacts=arrowRainSequence.pulses;
    while (rain.pulse<3 && rain.age>=contacts[rain.pulse]) {
      const offset=Math.max(0,dt-(rain.age-contacts[rain.pulse])/rain.rate); rain.pulse++;
      for (const id of state.enemyIds) {
        const enemy=state.enemies[id];
        if (enemy.home && enemy.hp>0 && Math.hypot(enemy.x-rain.x,enemy.z-rain.z)<=arrowRainSequence.radius && Math.abs(enemy.y-rain.y)<.8 && (!movement || movement.lineOfSight(rain,enemy))) {
          hit(state,id,timing,events,'bow',undefined,offset,rain.damage,{actor:'player',ability:'arrow-rain',id:rain.id},false,rain.damageType ?? 'physical');
        }
      }
    }
  }
  state.rains=state.rains.filter(rain=>rain.age<arrowRainSequence.duration);
}

/** Refresh advances the previous dose to impact before replacing its snapshot. */
export function advancePoison(state:Encounter,id:string,elapsed:number,timing:Timings,events:EncounterEvent[],offset=0): void {
  const enemy=state.enemies[id],poison=enemy.poison;
  if (!poison || enemy.hp<=0) return;
  const consumed=Math.min(poison.remaining,elapsed);
  poison.remaining=Math.max(0,poison.remaining-consumed); poison.nextTick-=consumed;
  while (poison.nextTick<=1e-9 && enemy.hp>0) {
    hit(state,id,timing,events,'bow',undefined,offset+consumed+poison.nextTick,poison.damage,{actor:'player',ability:'poison-arrow',id:poison.impactId},true,'poison');
    poison.nextTick+=.5;
  }
  if (!poison.remaining || enemy.hp<=0) enemy.poison=undefined;
}
