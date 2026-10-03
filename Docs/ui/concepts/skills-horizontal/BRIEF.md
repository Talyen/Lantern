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
- The level ruler immediately above the skill row marks 10, 20, 30, 40, 50 and the current derived level. It is a level track, not fractional XP progress; 50 is not a cap.
- The same live action bar remains below/outside the sheet. Drag existing action nodes onto slots, activate an empty slot for an available-ability picker, or rearrange existing bar actions. Passive and future nodes never assign.
- Empty-slot picker also works outside Skills using a sheet-hidden modal mode, preventing attacks through the popup. Keyboard activation offers the same choices. Escape cancels carrying/picker before closing; focus returns to the target slot or gameplay.
- Native dialog places the real bar in the modal top layer, physically outside the sheet. There is no duplicate Assigned Abilities area. Menus retain pause and existing outside-combat assignment safety.
- Category/skill navigation never changes action assignments. Each category retains its last browsed skill for the session; initial selection is Sword.

## Progression decisions

The owner chose existing abilities plus planned nodes, requested proposed milestone thresholds and selected generic profession placeholders. Major targets are provisionally 1/10/20/30/40/50; minor targets are 3/6, 13/16, 23/26, 33/36 and 43/46. Only future tooltips label these targets as proposed. Current Basics, Sweep, Piercing Shot and Shield Basic remain available from the start; they are not gated by prospective positions.

No new ability effects, passive effects or XP earning rules. Woodcutting, Mining and Axe retain current sources; other tracks show unavailable progression truthfully. All 28 XP records persist in revision 8 with lossless older-save migration. Levels remain derived by the existing formula, not independently saved.

## Owners and acceptance

[Skills](../../../../src/gameplay/skills.ts) and [node definitions](../../../../src/gameplay/skill-nodes.ts) own tracks/milestones. [Character save](../../../../src/gameplay/character-save.ts) owns validated revision migration. [Skills panel](../../../../src/ui/skills-panel.ts), [styles](../../../../src/ui/skills.css) and [icons](../../../../src/ui/skill-icons.ts) own presentation. [Combat UI](../../../../src/ui/combat.ts) retains bar/hold/drag state and delegates actual assignments to Adventure.

The current mockup gallery retains original image inputs, exact prompts and hashes. Inspect one owned normal-settings preview at 1280 × 800; exercise hover/focus, planned nodes, all-category navigation, assignment/cancellation and preservation. Focused save regressions protect migration and all-track round trips. Finish with the change-aware sanity gate, documenting actual visual evidence and material limits. No full local suite or benchmark.

October 3 Axe addition: the existing Axe Basic remains available, Crushing Blow occupies its live Skill node and Berserking occupies its first Ultimate node. The real Berserking requirement is Axe level 2 / 100 XP; its visible level label and tooltip replace the prospective requirement for that live action. Locked Berserking remains inspectable but cannot be assigned, and the picker only offers unlocked actions. The adopted six-position composition and future placeholders remain intact.
