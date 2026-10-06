import { abilityMana } from './mastery';
import { abilityCooldown } from './action-commit';
import { boundaryDistance } from './area';
import { abilities, abilitySet, abilityUnlocked, type AbilityId } from './abilities';
import type { Adventure } from './adventure';
import { dodge, swapWeaponSet, useAbility, type Encounter, type EncounterEvent, type Movement, type AimPoint, type Timings } from './encounter';

type CommandContext = {
  paused(): boolean;
  impactHolding(): boolean;
  timings(): Timings;
  movement(): Movement | undefined;
  interruptApproach(): void;
  complete(events: EncounterEvent[]): void;
};

/** Eligibility, accepted actions and hit-stop buffering belong to gameplay. */
export class CombatCommands {
  constructor(private readonly encounter: Encounter, private readonly adventure: Adventure, private readonly context: CommandContext) {}
  startAbility(id: AbilityId, aim: AimPoint | undefined, holdingShield: boolean): void {
    const { encounter, adventure, context } = this;
    const navigation = context.movement();
    if (context.paused()) return;
    context.interruptApproach();
    if (!holdingShield) encounter.blocking = false;
    encounter.proficiency={...adventure.character.xp};
    if (!abilityUnlocked(id,adventure.character.xp)) {adventure.message('Requires '+(id==='berserking' ? 'Axe' : abilities[id].family)+' level '+abilities[id].level); return;}
    if (id==='arrow-rain') {
      const set=abilitySet(encounter.weaponSets,encounter.activeSet,id);
      if (set!==undefined) {
        if (!aim || boundaryDistance(encounter.layout.boundary,[aim.x,aim.z])<0) {adventure.message('Aim at the ground'); return;}
        if (Math.hypot(aim.x-encounter.player.x,aim.z-encounter.player.z)>encounter.setStats[set].reach) {adventure.message('Out of range'); return;}
        if (navigation?.attackGround) {const target=navigation.attackGround(encounter.player,aim); if (!target) {adventure.message('Target is blocked'); return;} aim=target;}
      }
    }
    if (context.impactHolding()) {
      if (abilitySet(encounter.weaponSets,encounter.activeSet,id)!==undefined && encounter.playerMana>=abilityMana(id,encounter.proficiency) && (!encounter.blocking || abilities[id].activation==='hold')) encounter.pending = { kind:'ability', ability:id, remaining:.15, aim };
      return;
    }
    const events = useAbility(encounter, id, context.timings().player, false, aim,navigation);
    context.complete(events);
    if (events.length || encounter.pending) return;

    const definition = abilities[id];
    const set = abilitySet(encounter.weaponSets, encounter.activeSet, id);
    if (set === undefined) {
      const family = definition.family;
      const item = family === 'shield' ? 'a Shield' : family === 'axe' ? 'an Axe' : `a ${family[0].toUpperCase() + family.slice(1)}`;
      adventure.message(`Equip ${item} in a weapon set`);
    } else if (encounter.playerMana < abilityMana(id,encounter.proficiency)) {
      adventure.message('Not enough mana');
    } else if (abilityCooldown(encounter,id)>0) {adventure.message('Ability is cooling down');
    } else if (encounter.blocking && definition.activation !== 'hold') {
      adventure.message('Release Shield to attack');
    }
  }

  swap(): boolean {
    const { encounter, adventure, context } = this;
    if (context.paused()) return false;
    context.interruptApproach();
    if (!encounter.weaponSets[(1-encounter.activeSet) as 0|1].main) {
      adventure.message('Other weapon set is empty');
      return false;
    }
    if (context.impactHolding()) {
      if(encounter.weaponSets[(1-encounter.activeSet) as 0|1].main) encounter.pending = { kind:'swap', remaining:.15 };
      return true;
    }
    context.complete(swapWeaponSet(encounter, false));
    return true;
  }

  dodge(movement: { x: number; z: number }, aim: AimPoint | undefined): boolean {
    const { encounter, adventure, context } = this;
    if (context.paused()) return false;
    context.interruptApproach();
    const events=dodge(encounter,movement,false,aim);
    context.complete(events);
    if (encounter.pending?.kind === 'dodge' && Math.max(encounter.dodgeCooldown, encounter.dodgeRemaining) > .15)
      adventure.message('Dodge is not ready');
    return events.some(event => event.type === 'action' && event.action === 'dodge');
  }
}
