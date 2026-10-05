import { abilityMana } from '../gameplay/mastery';
import { abilityCooldown } from '../gameplay/action-commit';
import { boundaryDistance } from '../gameplay/area';
import type { Movement } from '../gameplay/encounter-model';
import { abilities, abilitySet, abilityUnlocked, type AbilityId } from '../gameplay/abilities';
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
  impactHolding(): boolean;
  cancelImpact?(): void;
  navigation?(): Movement | undefined;
  safeArea(): boolean;
  interruptApproach(): void;
  clearHold(): void;
  blocking(): boolean;
  present(events: EncounterEvent[]): void;
};

/** Translates accepted player commands into simulation events and presentation. */
export class CombatController {
  private readonly frameTimings: Timings = {
    player: { attack: 0, hit: 0, contacts: [] },
    enemy: { attack: 0, hit: 0, contacts: [] },
    caster: { attack: 0, hit: 0, contacts: [] },
  };
  constructor(
    private readonly encounter: Encounter,
    private readonly adventure: Adventure,
    private readonly actors: Record<ActorId, Actor>,
    private readonly input: Pick<ReturnType<typeof createInput>, 'suppress' | 'held' | 'pointer' | 'movement'>,
    private readonly pointerAim: Pick<PointerAim, 'resolve' | 'attack'>,
    private readonly equipment: Pick<EquipmentSets, 'abilityTimings'>,
    private readonly context: CombatContext,
  ) {}

  /** Commands and frame steps share one gameplay commit before presentation. */
  complete(events: EncounterEvent[]): void {
    this.adventure.applyCombatEvents(this.encounter, events);
    this.context.present(events);
  }

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
    let aim = pointer ? id==='arrow-rain' ? this.pointerAim.resolve(pointer,this.encounter.player.y) : this.pointerAim.attack(pointer,this.encounter,this.context.safeArea(),this.actors) : undefined;
    this.encounter.proficiency={...this.adventure.character.xp};
    if (!abilityUnlocked(id,this.adventure.character.xp)) {this.adventure.message('Requires '+(id==='berserking' ? 'Axe' : abilities[id].family)+' level '+abilities[id].level); return;}
    if (id==='arrow-rain') {
      const set=abilitySet(this.encounter.weaponSets,this.encounter.activeSet,id);
      if (set!==undefined) {
        if (!aim || boundaryDistance(this.encounter.layout.boundary,[aim.x,aim.z])<0) {this.adventure.message('Aim at the ground'); return;}
        if (Math.hypot(aim.x-this.encounter.player.x,aim.z-this.encounter.player.z)>this.encounter.setStats[set].reach) {this.adventure.message('Out of range'); return;}
        const navigation=this.context.navigation?.();
        if (navigation?.attackGround) {const target=navigation.attackGround(this.encounter.player,aim); if (!target) {this.adventure.message('Target is blocked'); return;} aim=target;}
      }
    }
    if (this.context.impactHolding()) {
      if (abilitySet(this.encounter.weaponSets,this.encounter.activeSet,id)!==undefined && this.encounter.playerMana>=abilityMana(id,this.encounter.proficiency) && (!this.encounter.blocking || abilities[id].activation==='hold')) this.encounter.pending = { kind:'ability', ability:id, remaining:.15, aim };
      return;
    }
    const events = useAbility(this.encounter, id, this.timings().player, false, aim,this.context.navigation?.());
    this.complete(events);
    if (events.length || this.encounter.pending) return;

    const definition = abilities[id];
    const set = abilitySet(this.encounter.weaponSets, this.encounter.activeSet, id);
    if (set === undefined) {
      const family = definition.family;
      const item = family === 'shield' ? 'a Shield' : family === 'axe' ? 'an Axe' : `a ${family[0].toUpperCase() + family.slice(1)}`;
      this.adventure.message(`Equip ${item} in a weapon set`);
    } else if (this.encounter.playerMana < abilityMana(id,this.encounter.proficiency)) {
      this.adventure.message('Not enough mana');
    } else if (abilityCooldown(this.encounter,id)>0) {this.adventure.message('Ability is cooling down');
    } else if (this.encounter.blocking && definition.activation !== 'hold') {
      this.adventure.message('Release Shield to attack');
    }
  }

  swap(): void {
    if (this.context.paused()) return;
    this.context.interruptApproach();
    if (!this.encounter.weaponSets[(1-this.encounter.activeSet) as 0|1].main) {
      this.adventure.message('Other weapon set is empty');
      return;
    }
    this.releaseShield();
    if (this.context.impactHolding()) {
      if(this.encounter.weaponSets[(1-this.encounter.activeSet) as 0|1].main) this.encounter.pending = { kind:'swap', remaining:.15 };
      return;
    }
    this.complete(swapWeaponSet(this.encounter, false));
  }

  dodge(): void {
    if (!this.actors.player.actions.dodge || this.context.paused()) return;
    this.context.interruptApproach();
    this.releaseShield();
    const aim = this.pointerAim.resolve(this.input.pointer(), this.encounter.player.y);
    const events=dodge(this.encounter,this.input.movement(),false,aim);
    if (events.some(event=>event.type==='action' && event.action==='dodge')) this.context.cancelImpact?.();
    this.complete(events);
    if (this.encounter.pending?.kind === 'dodge' && Math.max(this.encounter.dodgeCooldown, this.encounter.dodgeRemaining) > .15)
      this.adventure.message('Dodge is not ready');
  }
}
