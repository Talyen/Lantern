import type { EncounterView } from '../gameplay/state-view';
import type { AbilityId } from '../gameplay/abilities';
import type { ActorId, Timings } from '../gameplay/encounter';
import { actionSlotInputs } from '../input/bindings';
import { duration, type Actor } from './actors';
import type { EquipmentSets } from './equipment-sets';
import type { createInput } from './input';
import type { PointerAim } from './pointer-aim';
import type { SessionRuntime } from './runtime';

type CombatContext = {
  paused(): boolean;
  cancelImpact?(): void;
  safeArea(): boolean;
  clearHold(): void;
  blocking(): boolean;
};

/** Resolves physical input and prepared timing; runtime owns gameplay commands. */
export class CombatController {
  private readonly frameTimings: Timings = {
    player: { attack: 0, hit: 0, contacts: [] },
    enemy: { attack: 0, hit: 0, contacts: [] },
    caster: { attack: 0, hit: 0, contacts: [] },
  };
  constructor(
    private readonly actors: Record<ActorId, Actor>,
    private readonly input: Pick<ReturnType<typeof createInput>, 'suppress' | 'held' | 'pointer' | 'movement'>,
    private readonly pointerAim: Pick<PointerAim, 'resolve' | 'attack'>,
    private readonly equipment: Pick<EquipmentSets, 'abilityTimings'>,
    private readonly context: CombatContext,
    private readonly runtime: SessionRuntime,
  ) {}

  private get encounter(): EncounterView { return this.runtime.state; }

  timings(): Timings {
    // Simulation consumes these synchronously and snapshots accepted attacks.
    // Refresh live actor values without allocating a timing tree every frame.
    for (const id in this.actors) {
      const actor = this.actors[id], timing = this.frameTimings[id] ??= { attack: 0, hit: 0, contacts: [] };
      timing.attack = duration(actor, 'attack'); timing.hit = duration(actor, 'hit');
      timing.contacts = actor.contacts; timing.commitLead = actor.commitLead;
    }
    this.frameTimings.player.abilities = this.equipment.abilityTimings();
    return this.frameTimings;
  }

  releaseShield(): void {
    this.context.clearHold();
    this.runtime.character.actionBar.forEach((id, index) => {
      if (id === 'shield-basic') this.input.suppress(actionSlotInputs[index]);
    });
  }

  holdingShield(): boolean {
    return this.context.blocking() || this.runtime.character.actionBar.some((id, index) =>
      id === 'shield-basic' && this.input.held(actionSlotInputs[index]));
  }

  startAbility(id: AbilityId): void {
    if (this.context.paused()) return;
    const pointer = this.input.pointer();
    const aim = pointer ? id === 'arrow-rain' ? this.pointerAim.resolve(pointer, this.encounter.player.y)
      : this.pointerAim.attack(pointer, this.encounter, this.context.safeArea(), this.actors) : undefined;
    this.runtime.startAbility(id, aim, this.holdingShield());
  }

  swap(): void {
    if (this.context.paused()) return;
    if (this.runtime.swap()) this.releaseShield();
  }

  dodge(): void {
    if (!this.actors.player.actions.dodge || this.context.paused()) return;
    this.releaseShield();
    if (this.runtime.dodge(this.input.movement(), this.pointerAim.resolve(this.input.pointer(), this.encounter.player.y))) this.context.cancelImpact?.();
  }
}
