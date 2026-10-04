# Smithing

Smithing is a small, predictable profession supporting equipment choices and returning home. The Homestead anvil opens it from the start; shelter restoration remains a separate optional upgrade. The existing converted forge/anvil and two additional Iron deposits are reused art, not new model or texture preparation.

## Recipes and progression

[Smithing](../src/gameplay/smithing.ts) owns recipe costs, XP, eligibility and candidate transactions. [Equipment](../src/gameplay/equipment.ts) owns fixed identities, properties and recoverable construction materials. Levels derive from the existing saved Smithing XP using the shared non-weapon curve.

| Recipe | Smithing level | Cost | Base XP |
| --- | ---: | --- | ---: |
| Sword | 1 | 2 Iron, 1 Wood | 250 |
| Shield | 1 | 2 Iron, 3 Wood | 250 |
| Guard Helm | 3 | 3 Iron | 1,000 |
| Weathered Mail | 6 | 4 Iron | 3,000 |
| Iron Broadsword | 10 | 4 Iron, 1 Wood | 4,000 |

The same recipe always awards the same base XP; no first-craft bonus or random quality exists. Rested adds its existing 10% to crafting and reclamation XP. Costs do not change with level and require no gold or intermediate ingots. New recipes appear only upon learning and receive a completion announcement. Recipe unlocks are independent of talent nodes.

The unchanged novice deposits yield three Iron each; Homestead has one and Clearing has two. Their existing Mining, ground-drop provenance, cancellation and 45-minute active-play renewal rules apply. All five recipes cost 15 Iron plus 5 Wood, with shelter restoration requiring another 3 Iron, 12 Wood and 6 Stone. Two novice Iron cycles supply 18 Iron before salvage and higher-level yield changes. These are starting values, not observed complete-adventure pacing.

## Talents

The Skills screen contains the real starter major/minor bonuses alongside clearly planned later talent positions, not recipe nodes. [Node definitions](../src/gameplay/skill-nodes.ts) derive activation from XP.

| Talent | Kind / level | Benefit |
| --- | --- | --- |
| Reclamation | Major / 1 | Reclaim unequipped metal gear for matching materials and a little Smithing XP. |
| Heat Seasoned | Minor / 3 | Forge exposure grants 15% Burn Resistance. |
| Hammer Arm | Minor / 6 | Hammer work grants 5% more physical melee damage. |

Bonuses activate automatically, require no points, and are character benefits rather than changed item properties. Hammer Arm affects actual physical melee contacts, including multi-contact attacks; it does not affect arrows, Staff magic, poison or arrow-rain pulses. Heat Seasoned applies to Burn damage after direct-hit armor and blocking. No XP or forging-speed talent is included.

## Forge and Reclaim

[The Smithing sheet](../src/ui/smithing-panel.ts) implements the chosen [Workshop sheet concept](ui/concepts/smithing/README.md): mode tabs, a list on the left, details on the right, and level/XP above. It uses the existing item atlas and shared reading/heading styles. Text and controls remain functional DOM elements.

Click the anvil to approach; menus pause the world. Forge lists learned recipes, properties, exact costs, Bag/Stash contributions and the effective XP reward. Consume Bag materials first, then unlocked Stash. Output always enters Bag and never auto-equips. Check room after material consumption; a full Bag blocks the entire craft even with free Stash space.

Forging takes two foreground seconds. Selection and tabs lock while progress advances; Cancel, Escape, outside dismissal, another menu and session disposal cancel without spending materials or awarding anything. Background time does not advance the craft. Completion revalidates station reach, safety, level, materials and placement, then commits materials, output and XP together through Adventure. Pending crafts are not persisted.

Reclaim lists eligible unequipped Bag/Stash instances, including Bag recovery entries. Select an item to inspect matching returns and XP. Reclaim is immediate and permanent: no confirmation or Undo. Clear selection after completion; repeated input cannot act on a neighboring item.

| Metal equipment | Guaranteed return |
| --- | --- |
| Axe, Shield | 1 Iron, 1 Wood |
| Sword, Guard Helm, Iron Signet | 1 Iron |
| Weathered Mail, Iron Broadsword | 2 Iron |
| Hearth Ring | 8 Gold |
| Amber Amulet | 10 Gold |

These are the catalogue's current substantial metal constructions; primarily wooden, cloth and leather gear is not classified as metal equipment. Learned recipes and item origin do not restrict reclamation. Precious-metal value enters the wallet; materials enter the source container. Each completed item grants 20 base Smithing XP, no gathering XP, and does not undo its permanent collection claim. A failed return retains the complete item and XP. Reforging and reclaiming always loses some materials; selling versus reclaiming remains a preparation choice.

## Damage vocabulary

[Damage types](../src/gameplay/damage.ts) are Physical, Burn, Freeze, Poison, Bleed and Nature. Delivery and statuses are separate: Burn damage need not cause Burning, and Freeze damage need not slow. Stun describes loss of control, with resistance concerning its duration; its first applying attack will implement runtime control behavior.

Ordinary melee/arrows use Physical. Player Staff bolts use Nature, Bone Caster bolts use Freeze, and the goblin caster's fireball uses Burn. Poison Arrow's ongoing effect uses Poison. Authored enemy damage types are validated; legacy caller fixtures receive deterministic defaults.

Armor retains its reduction for every direct hit, with existing blocking and dodge rules. Burn Resistance then multiplies remaining Burn damage by 0.85. Periodic delivery remains separate from direct-hit armor. Goblin fireballs retain the original cast/recovery, committed aim, speed, hit radius and wall collision. The warm charge, round fireball, trail and small impact use native node materials and existing bounded fire particles through the shared pipeline; no new spell art or character motion is imported.

## Persistence and focused evidence

Adventure owns reach checks, atomic publication, stat/proficiency refresh and normal autosave. Existing saved XP already includes Smithing; unlocks and bonuses are derived, so no save-version change or stored unlock list is required. Existing outings, claims, resources and character slots remain intact.

The targeted transaction/combat checks in [smithing.test.ts](../tests/smithing.test.ts) protect concrete loss, duplication, stale-item, wallet-return and unlimited-XP paths. Owned normal-settings inspection covers the workshop and sheet at 1280 × 800, missing-material feedback, cancellation retaining all resources, successful Bag-first/Stash-second forging with a recipe reveal, and permanent stored-item reclamation returning materials to Stash. Private gameplay captures belong to the task archive; original UI concepts are tracked separately. A real walking transition into Clearing and a Burn-tagged caster projectile were inspected at gameplay scale; its round warm head and fading trail remained readable, with no reported renderer error. Whole-adventure balance and cross-platform performance remain unverified.
