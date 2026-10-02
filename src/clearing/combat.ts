import { abilities, abilitySet, type AbilityId } from '../gameplay/abilities';
import type { Adventure } from '../gameplay/adventure';
import {
  dodge, swapWeaponSet, useAbility,
  type ActorId, type Encounter, type EncounterEvent, type Timings,
} from '../gameplay/encounter';
import { actionSlotInputs } from '../input/bindings';
import { duration, type Actor } from './actors';
import type { EquipmentSets } from './equipment-sets';
import type { createInput } from './input';
import type { PointerAim } from './pointer-aim';

type CombatContext = {
  paused(): boolean;
  safeArea(): boolean;
  interruptApproach(): void;
  clearHold(): void;
  blocking(): boolean;
  present(events: EncounterEvent[]): void;
};

/** Translates accepted player commands into simulation events and presentation. */
export class CombatController {
  constructor(
    private readonly encounter: Encounter,
    private readonly adventure: Adventure,
    private readonly actors: Record<ActorId, Actor>,
    private readonly input: ReturnType<typeof createInput>,
    private readonly pointerAim: PointerAim,
    private readonly equipment: EquipmentSets,
    private readonly context: CombatContext,
  ) {}

  timings(): Timings {
    const timing = (actor: Actor) => ({
      attack: duration(actor, 'attack'), hit: duration(actor, 'hit'),
      contacts: actor.contacts, commitLead: actor.commitLead,
    });
    return {
      player: { ...timing(this.actors.player), abilities: this.equipment.abilityTimings() },
      enemy: timing(this.actors.enemy), caster: timing(this.actors.caster),
    };
  }

  releaseShield(): void {
    this.context.clearHold();
    this.adventure.character.actionBar.forEach((id, index) => {
      if (id === 'shield-basic') this.input.suppress(actionSlotInputs[index]);
    });
  }

  holdingShield(): boolean {
    return this.context.blocking() || this.adventure.character.actionBar.some((id, index) =>
      id === 'shield-basic' && this.input.held(actionSlotInputs[index]));
  }

  startAbility(id: AbilityId): void {
    if (this.context.paused()) return;
    this.context.interruptApproach();
    if (!this.holdingShield()) this.encounter.blocking = false;
    const pointer = this.input.pointer();
    const aim = pointer
      ? this.pointerAim.attack(pointer, this.encounter, this.context.safeArea(), this.actors)
      : undefined;
    const events = useAbility(this.encounter, id, this.timings().player, false, aim);
    this.context.present(events);
    if (events.length || this.encounter.pending) return;

    const definition = abilities[id];
    const set = abilitySet(this.encounter.weaponSets, this.encounter.activeSet, id);
    if (set === undefined) {
      const family = definition.family;
      const item = family === 'shield' ? 'a Shield' : family === 'axe' ? 'an Axe' : `a ${family[0].toUpperCase() + family.slice(1)}`;
      this.adventure.message(`Equip ${item} in a weapon set`);
    } else if (this.encounter.playerMana < definition.mana) {
      this.adventure.message('Not enough mana');
    }
  }

  swap(): void {
    if (this.context.paused()) return;
    this.context.interruptApproach();
    this.releaseShield();
    this.context.present(swapWeaponSet(this.encounter, false));
  }

  dodge(): void {
    if (!this.actors.player.actions.dodge || this.context.paused()) return;
    this.context.interruptApproach();
    this.releaseShield();
    const aim = this.pointerAim.resolve(this.input.pointer(), this.encounter.player.y);
    this.context.present(dodge(this.encounter, this.input.movement(), false, aim));
  }
}
