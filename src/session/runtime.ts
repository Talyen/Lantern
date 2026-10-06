import type { Adventure, AdventureEvent } from '../gameplay/adventure';
import { GateTravel, type Gate } from '../gameplay/area';
import { stepEncounter, stepExploration, type Encounter, type EncounterEvent, type Input, type Movement, type Timings } from '../gameplay/encounter';
import type { GatheringAction, GatheringEvent } from '../gameplay/gathering-action';
import type { AreaDefinition } from '../levels/types';

export type SessionFeedback = { combat: EncounterEvent[]; gathering: GatheringEvent[]; adventure: AdventureEvent[] };
type RuntimeContext = {
  area(): AreaDefinition;
  movement(): Movement | undefined;
  timings(): Timings;
  interruptApproach(releaseLock?: boolean): void;
  defeated(): void;
};

/** Authoritative tick and immediate command commits; no DOM, actor, audio or renderer dependencies. */
export class SessionRuntime {
  private events: EncounterEvent[] = [];
  readonly travel = new GateTravel();
  constructor(private readonly encounter: Encounter, private readonly adventure: Adventure,
    private readonly gathering: GatheringAction, private readonly context: RuntimeContext) {}

  complete(events: EncounterEvent[]): void {
    this.adventure.commit(() => this.adventure.applyCombatEvents(this.encounter, events));
    if (events.some(event => event.type === 'hit' && event.actor === 'player')) this.context.interruptApproach(false);
    if (events.some(event => event.type === 'outcome' && !event.won)) this.context.defeated();
    this.events.push(...events);
  }

  advance(dt: number, input: Input, weatherDt = dt): Gate | undefined {
    const area = this.context.area();
    this.gathering.cancelIfInterrupted(input, input.block ?? false);
    if (input.paused) return;
    if (this.encounter.pending?.kind === 'ability' && this.encounter.pending.ability === 'shield-basic' && !input.block) this.encounter.pending = null;
    const timing = this.context.timings(), movement = this.context.movement();
    this.adventure.markAreaChanged(area.id);
    this.complete(this.encounter.phase === 'won' || area.kind === 'safe'
      ? stepExploration(this.encounter, dt, input, movement, timing)
      : stepEncounter(this.encounter, dt, input, timing, movement));
    if (this.encounter.phase !== 'loading' && this.adventure.currentArea) this.adventure.commit(() => this.adventure.step(this.encounter, area, dt));
    if (this.encounter.player.hp > 0) this.adventure.commit(() => this.gathering.advance(dt));
    if (this.encounter.player.hp > 0 && !['lost', 'loading'].includes(this.encounter.phase)) {
      this.advanceWeather(weatherDt);
      if (this.adventure.castRemaining === 0) return this.travel.check(area.gates, [this.encounter.player.x, this.encounter.player.z]);
    }
  }

  advanceWeather(dt: number): void {
    if (this.encounter.player.hp > 0 && !['lost', 'loading'].includes(this.encounter.phase)) this.adventure.advanceWeather(dt);
  }

  takeFeedback(): SessionFeedback {
    const combat = this.events;
    this.events = [];
    return { combat, gathering: this.gathering.takeEvents(), adventure: this.adventure.takeEvents() };
  }
}
