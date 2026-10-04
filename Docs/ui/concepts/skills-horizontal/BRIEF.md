# Skills horizontal interface — adopted brief

## Goal and status

Owner selected the six-step horizontal grouping and requested implementation October 2, 2026. Player goal: understand skill level and proposed progression, inspect available/planned nodes, and assign existing actions. Intended appearance: an Inventory-sized warm charcoal sheet with a six-node horizontal spine, ten quieter passive nodes between majors, a level ruler and a complete active-category skill row.

## Roster

- Combat: Sword, Axe, Mace, Dagger, Spear, Greatsword, Greathammer, Bow, Crossbow, Staff, Wand, Shield, Defense, Evasion.
- Magic: Burn, Freeze, Nature, Healing.
- Gathering: Woodcutting, Mining, Herbalism.
- Crafting: Smithing, Leatherworking, Tailoring, Woodworking, Alchemy, Cooking, Jewelcrafting.

## Layout and behavior

- Combat/Magic/Gathering/Crafting tabs above the selected skill header. Every active-category root fits simultaneously, including all fourteen Combat entries at 1280 × 800. No skill carousel, horizontal navigation scroll or XP bar.
- Six major nodes run left to right. Combat/Magic roles: Basic I, Basic II, Skill I, Skill II, Ultimate I, Ultimate II. Two smaller passive nodes occupy each of the five gaps.
- Gathering/Crafting use Major 1–6 and Minor 1–10. Each node retains individual icon identity and useful hover/focus information; planned art is visible under a tiny lock indicator.
- The level ruler immediately above the skill row marks 5, 10, 15, 20 and the current derived level. It is a level track, not fractional XP progress; 20 completes the tree and is not a skill level cap.
- The same live action bar remains below/outside the sheet. Drag existing action nodes onto slots, activate an empty slot for an available-ability picker, or rearrange existing bar actions. Passive and future nodes never assign.
- Empty-slot picker also works outside Skills using a sheet-hidden modal mode, preventing attacks through the popup. Keyboard activation offers the same choices. Escape cancels carrying/picker before closing; focus returns to the target slot or gameplay.
- Native dialog places the real bar in the modal top layer, physically outside the sheet. There is no duplicate Assigned Abilities area. Menus retain pause and existing outside-combat assignment safety.
- Category/skill navigation never changes action assignments. Each category retains its last browsed skill for the session; initial selection follows the equipped weapon family (Axe uses its retained Axe Combat identity), falling back to Sword.

## Progression decisions

These paragraphs record the initial October 2 placeholder scope. The [October 3 implementation](#october-3-mastery-implementation) below supersedes Sword/Bow/Axe availability, thresholds and XP sources.

The owner chose existing abilities plus planned nodes, requested proposed milestone thresholds and selected generic profession placeholders. The historical major targets were 1/10/20/30/40/50 with minor targets 3/6, 13/16, 23/26, 33/36 and 43/46; [shared level-20 progression](../../../PROGRESSION.md) now supersedes those targets. Current tooltips use the standard level and explicitly identify undefined bonuses or unavailable actions. Current Basics, Sweep, Piercing Shot and Shield Basic remain available from the start; they are not gated by prospective positions.

No new ability effects, passive effects or XP earning rules. Woodcutting, Mining and Axe retain current sources; other tracks show unavailable progression truthfully. All 28 XP records persist in revision 8 with lossless older-save migration. Levels remain derived by the existing formula, not independently saved.

## Owners and acceptance

[Skills](../../../../src/gameplay/skills.ts) and [node definitions](../../../../src/gameplay/skill-nodes.ts) own tracks/milestones. [Character save](../../../../src/gameplay/character-save.ts) owns validated revision migration. [Skills panel](../../../../src/ui/skills-panel.ts), [styles](../../../../src/ui/skills.css) and [icons](../../../../src/ui/skill-icons.ts) own presentation. [Combat UI](../../../../src/ui/combat.ts) retains bar/hold/drag state and delegates actual assignments to Adventure.

The current mockup gallery retains original image inputs, exact prompts and hashes. Inspect one owned normal-settings preview at 1280 × 800; exercise hover/focus, planned nodes, all-category navigation, assignment/cancellation and preservation. Focused save regressions protect migration and all-track round trips. Finish with the change-aware sanity gate, documenting actual visual evidence and material limits. No full local suite or benchmark.

## October 3 mastery implementation

Sword/Bow now use the owner-selected learning order: Basic I, Skill I, Basic II, Ultimate I, Skill II, Ultimate II. The six large nodes retain the horizontal composition; ten chronological passives form a quieter secondary row. Learned/locked states and tooltips use real definitions and thresholds. Earned actions fill the first empty bar slot and never replace an assignment. Any six unlocked actions may be assigned safely; all Ultimates share one cooldown. Other categories retain their existing planned nodes. [Weapon mastery](../../../EQUIPMENT.md#sword-and-bow-mastery) owns the complete roster, passives, XP curve and initial tuning.


October 3 Axe addition: the existing Axe Basic remains available, Crushing Blow occupies its live Skill node and Berserking occupies its first Ultimate node. Its original Berserking requirement was Axe level 2 / 100 XP; shared progression now requires level 5 / 1,000 XP; its visible level label and tooltip replace the prospective requirement for that live action. Locked Berserking remains inspectable but cannot be assigned, and the picker only offers unlocked actions. The adopted six-position composition and future placeholders remain intact.

October 4 shared progression: every track uses the same XP curve and level-20 major/minor schedules. The ruler ends at 20 while the heading shows the true level beyond it. Planned nodes show their standard level and remain unavailable; progression details and source rewards belong to [Progression](../../../PROGRESSION.md).
