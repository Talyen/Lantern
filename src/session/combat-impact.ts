import type { EncounterEvent } from '../gameplay/encounter';

/** Real time consumes a bounded stop; gameplay never catches that time up. */
export class CombatImpact {
  private stop = 0;
  private shake = 0;
  private seen: number[] = [];
  get holding(): boolean { return this.stop > 0; }
  clear(): void { this.stop = this.shake = 0; this.seen.length = 0; }
  present(events: readonly EncounterEvent[]): void {
    for (const event of events) {
      if (event.type !== 'impact' || event.periodic || event.blocked || event.actor === 'player' || event.origin?.actor !== 'player') continue;
      const { id, ability } = event.origin;
      if (this.seen.includes(id)) continue;
      const skill = ability === 'crushing-blow' || ability === 'sweep' || ability === 'piercing-shot' || ability === 'multishot' || ability === 'executioner' || ability === 'onslaught' || ability === 'riposte' || ability === 'deadeye';
      if (!skill && event.weapon !== 'axe' && event.weapon !== 'sword') continue;
      this.seen.push(id); if (this.seen.length > 64) this.seen.shift();
      this.stop = Math.min(.07, Math.max(this.stop, skill ? .055 : .035));
      if (skill) this.shake = .12;
    }
  }
  advance(dt: number): number {
    const held = Math.min(dt, this.stop);
    this.stop = Math.max(0, this.stop - dt);
    this.shake = Math.max(0, this.shake - dt);
    return Math.max(0, dt - held);
  }
  offset(enabled: boolean): { x: number; y: number } {
    if (!enabled) { this.shake = 0; return {x:0,y:0}; }
    if (this.shake <= 0) return {x:0,y:0};
    const t = .12 - this.shake, weight = this.shake / .12;
    return {x: Math.sin(t * 115) * 3 * weight * weight, y: Math.sin(t * 147) * 1.6 * weight * weight};
  }
}
