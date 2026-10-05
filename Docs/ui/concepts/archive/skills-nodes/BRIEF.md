# Skills node redesign brief

**Superseded:** use [the adopted horizontal brief](../../skills-horizontal/BRIEF.md). The upward direction, scrolling roots, XP display and profession Basic/Skill/Ultimate proposal below are historical.

## Scope and status

Active concept round requested October 2, 2026. Supersedes [first-round assignment/layout design](../skills/BRIEF.md), preserves its 28-track roster and progression-first goal. Player goal: understand upward skill growth, inspect action/passive unlocks, and assign available actions using the actual gameplay bar.

Intended visible effect: an Inventory-sized charcoal sheet with distinctly larger illustrated ability nodes and smaller illustrated passive nodes, connected in a readable upward sequence. Restrained ivory/brass framing supports the icons without ornate card grids or an internal assignment section.

Current runtime owners remain [combat UI](../../../../../src/ui/combat.ts), [ability model](../../../../../src/gameplay/abilities.ts), [skills](../../../../../src/gameplay/skills.ts), [character](../../../../../src/gameplay/character.ts) and [adventure](../../../../../src/gameplay/adventure.ts). No runtime owner is changed in this concept task.

## Roster

- Combat: Sword, Axe, Mace, Dagger, Spear, Greatsword, Greathammer, Bow, Crossbow, Staff, Wand, Shield, Defense, Evasion.
- Magic: Burn, Freeze, Nature, Healing.
- Gathering: Woodcutting, Mining, Herbalism.
- Crafting: Smithing, Leatherworking, Tailoring, Woodworking, Alchemy, Cooking, Jewelcrafting.

## Adopted interaction changes

- K opens Skills; menu fills most of the 1280 × 800 minimum viewport, similar to Inventory/Equipment, leaving the bottom gameplay action bar reachable.
- Remove Assigned Abilities and every duplicate action-bar strip from the menu.
- Drag an unlocked assignable action node onto the real bar. Clicking an empty bar slot opens a compact anchored list of available assignable actions; choose one to fill that slot.
- Keyboard focus/activation on an empty slot offers the same picker; focusable nodes supply the same information as mouse hover. Escape cancels carrying/picker before closing Skills, then returns focus to gameplay.
- Every track supports larger Basic/Skill/Ultimate ability nodes and smaller passive-bonus nodes. Each node has its own art even while planned/locked; tiny badges supplement identity.
- Passives never drag into slots or appear among assignable actions. Locked/planned actions cannot be assigned; missing equipment is a different state from learning availability.
- Keep actual assignment safety outside combat. Browsing and viewing tooltips remain possible without changing the loadout.
- Existing ability IDs and user bindings drive the future picker. Browsing roots/categories leaves all six assignments unchanged.
- Planned tracks remain inspectable. All example future node names, bonuses and numbers are mockup data, not implemented rewards or XP sources.
- Preserve existing skill XP and other character state in eventual implementation; weapon/magic practice remains independent future progression.

## Layout question

Explore root icons along panel bottom with progression growing straight upward: a focused selected tree, parallel horizontally browsable trees, and grouped-list navigation as a comparison. Multiple tree lanes must scroll with their roots and remain readable rather than fit all 28 tracks at once. Root ordering/category composition and A/B/C choice remain open.

A root sits below Basic; Skill rises above Basic; Ultimate is highest. Small passive nodes sit beside this linear progression. Connections are visual ordering, not point spending or an invented prerequisite system. No general character level or proficiency gate on equipment.

## Art and evidence

[The gallery](README.md) records six active layout/state studies plus initial generated outputs retained for correction provenance. All generated images and input references are original UI-only art; no licensed gameplay screenshots or models were submitted. Exact prompts, SHA-256, date and tool provenance live beside the images.

Use raster imagery as composition/icon-style reference only; DOM owns text, controls, states and eventual runtime layout. Concepts do not prove 40px hit areas, contrast, viewport fit, picker focus containment, safe mutations or gameplay. This task uses static visual review and the change-aware sanity handoff, not gameplay previews or benchmarks.
