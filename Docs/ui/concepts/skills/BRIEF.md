# Skills screen brief

## Scope and status

Concept exploration, requested October 2, 2026. Player goal: understand skill growth and the next useful benefit, then assign available combat abilities. Intended visible effect: a crafted charcoal sheet whose selected-skill progress leads, with restrained brass and original readable icons consistent with Inventory/Stash.

Current source owners: [combat UI](../../../../src/ui/combat.ts), [skills](../../../../src/gameplay/skills.ts), [character state](../../../../src/gameplay/character.ts), [adventure](../../../../src/gameplay/adventure.ts). Direct consumers include menu-controller/input and harvesting. This task records original visual studies only.

## Roster

Names and inclusion are owner-selected. Categories organize navigation without classes or specialization gates.

- Combat: Sword, Axe, Mace, Dagger, Spear, Greatsword, Greathammer, Bow, Crossbow, Staff, Wand, Shield, Defense, Evasion.
- Magic: Burn, Freeze, Nature, Healing.
- Gathering: Woodcutting, Mining, Herbalism.
- Crafting: Smithing, Leatherworking, Tailoring, Woodworking, Alchemy, Cooking, Jewelcrafting.

## Chosen flow and content

- K opens Skills; centered heading and × close. Browse a grouped list beside selected-skill detail.
- Lead with skill identity, derived level, numeric XP and progress; show real current benefits and next defined improvements.
- Inspect planned tracks without invented rewards, XP sources or recipes. Clearly distinguish unavailable progression from locked abilities and missing equipment.
- Preserve existing Woodcutting/Mining and Axe Combat progress in eventual integration, displaying the latter as Axe. Add saved tracks later without resetting character state.
- Future magical practice may advance both weapon and magic tracks. This study defines no earning amounts or sources.
- Named ability icons reveal useful effects/costs/cooldowns/compatibility on hover and keyboard focus.
- Select ability then slot; drag and keyboard equivalent reach the same outcome. Six slots Q/E/R/G/LMB/RMB live inside relevant combat detail. Bindings ultimately come from preferences.
- Browsing remains possible in combat; assignment remains unavailable. Existing abilities may be assigned without currently compatible equipment, with truthful readiness context.
- Escape cancels carrying/selection before closing; return focus to gameplay. Retain last browsed skill for the session, initially Sword.
- Noncombat tracks show useful progression content without action assignment controls.

## Layout, states and art

Target 1280 × 800 minimum content viewport and normal desktop windows. Independently scroll navigation/content where required, without shrinking essential targets to fit 28 tracks.

[Layout variants](README.md#compare-the-layouts) hold content/state constant and compare wide workspace, ordered progression spine and compact workbench. Interaction sheets cover hover, selection, assignment outcome, locked placeholder, combat restriction, gathering benefit, planned crafting/magic, keyboard focus, drag, cancellation, missing equipment and reaching the full roster.

Art is original text-only ImageGen output; the sole edit uses an inspected original generated UI concept. No Synty/Mixamo art or gameplay captures were submitted. Keep raster text and state chrome out of eventual runtime implementation.

## Evidence and open decisions

Exact prompts, output filenames and SHA-256 are recorded beside every image. [Critiques and limitations](README.md#production-boundaries-and-review) distinguish design intent from generated inaccuracies.

Owner selected roster, progression-first goal, grouped navigation/detail, inspectable planned tracks, independent weapon/magic practice, icon/hover detail and ability-then-slot assignment. **A/B/C composition is still open.** Runtime implementation, save migration, actual input/contrast/viewport validation and XP gameplay remain subsequent work; concept images establish none of them.
