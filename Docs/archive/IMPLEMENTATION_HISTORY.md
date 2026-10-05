# Implementation history

These reports preserve the implementation and validation limits at the time of each pass. Present-tense statements and former settings are historical. Current guidance belongs to [the roadmap](../../ROADMAP.md).

## Implementation and validation

These are milestone commitments, not final balance values. Damage and armor formulas, combat timings, mana costs and regeneration, Skill and shared Ultimate cooldowns, outside-combat health regeneration rate, potion strength, authored item values and effects, drop chances, inventory and stash capacities, stack limits, skill thresholds, gathering duration, restoration and crafting costs, rested bonus strength and active-play duration, and enemy/resource return intervals belong to implementation and playtesting. Evaluate those values against the representative outing budget and first-adventure targets, keeping authored-only equipment and the agreed combat/proficiency rules intact. Keep representative player flows and the standard handoff gate described in [Development](../DEVELOPMENT.md) when implementing features. New or materially rewritten automated tests must meet the [test admission policy](../DEVELOPMENT_REFERENCE.md#testing-during-the-prototype-phase); milestone commitments and tuning values are not an automated coverage checklist.

## Selected library trials

- [x] Trial a bounded WebGPU weapon ribbon tied to baked attack contact windows; subsequently remove it in favor of local hit sparks.
- [x] Integrate navcat routing and Rapier grounded collision using explicit authored proxies; keep combat outcomes simulation-owned.
- [x] Compare simple/fluid portal visuals and retain the simpler gold/amber effect; later connect it to paired Scroll of Return travel.
- [ ] Validate supported Windows hardware and packaged release behavior before claiming Windows/macOS release readiness.

See [library decisions](../LIBRARY_TRIALS.md) and [performance evidence](../PERFORMANCE.md). Synty vegetation, authored enemy roles and compact linked areas remain the selected direction.

## October 2 look-and-feel pass

The owner selected expressive combat with selective hit pause and powerful-Skill shake, the detailed orb-led HUD without a Set I control, saved Resource Numbers, earned-refuge Homestead, scenery-only recomposition and a shallow stream/fixed rain in Clearing. Current area composition, shelter finish, contact effects and crafted current-menu treatment follow this direction. This historical pass did not implement title/slot screens, new areas, Ultimate abilities or scene reflections; subsequent work implemented title/slots, the Graveyard areas, Ultimates and scene reflections. Its final observed interaction/visual evidence belongs in the [HUD review record](../ui/concepts/hud-polish/README.md); full platform/performance acceptance remains separate.

## October 3 Sword and Bow mastery

The complete Sword/Bow trees are implemented: twelve abilities, twenty automatic weapon-specific passives, effective-damage XP, learning-order Skills presentation, saved XP/assignments and safe assignment of earned actions into empty slots. Executioner's Strike uses a planted physical cut; Rain of Arrows retains its adopted visuals in every area. Sword/Bow Ultimates use 50 mana and commit the shared readiness timer for 30 seconds; the concurrent Axe kit retains Berserking’s 60-second commitment in that same pool. Enemy hits no longer interrupt player actions, and available dodge cancels any attack preparation/recovery; attack costs commit at the first strike/release or successful Riposte. See [weapon mastery](../EQUIPMENT.md#sword-and-bow-mastery).

This completes the Sword/Bow action and progression implementations in milestones 2 and 4. Pre-boss Ultimate practice, 3–5-hour mastery pacing and the complete outing budget remain evaluation targets; the named boss remains outstanding. Starter Smithing, four-slot/title flow, individual renewal and saved outings were subsequently implemented; full Smithing progression remains future work.

## Axe kit and opening design — October 3

Axe Basic, Crushing Blow and earned Berserking are implemented; [Axe combat](../EQUIPMENT.md#axe-abilities-and-proficiency) owns values, finite effective-damage credit, assignment and temporary-effect rules. The new-character Axe Skill occupies Q; Berserking originally unlocked at 100 Axe XP; October 4 shared progression superseded that threshold with level 5 / 1,000 XP. Earning it fills the first empty action slot without replacing an assignment (default R when the first two slots are occupied). Axe alternates and passives remain deferred; Sword/Bow work stays separate. Full-route Ultimate pacing still needs the complete adventure.

The agreed opening is story-light, led by curiosity from refuge, environmental guidance and brief first-opportunity control hints rather than a standing objective tracker. New players start with an Axe; the original opening direction called for guaranteed first Sword, Shield, Bow and Staff copies across Homestead and Clearing rather than bundled into one camp reward. The existing optional Crypt should become a deliberate two-warrior/caster cover fight with an authored equipment reward and environmental ritual clues. The named boss is an undead ritual leader with readable spells and an interruptible summoning window producing a capped group of skeletons. The Axe kit did not implement these content/discovery changes. Subsequent work distributed Sword/Shield, Bow and Staff across Clearing rewards and implemented starter Smithing. The Crypt authored equipment reward/ritual clues, named boss and consolidated slice acceptance remain outstanding; the implemented discovery placement is recorded below.

## Individual renewal and saved outings — October 3

Every enemy, chest and depleted resource has an independent 45-minute active-play deadline, counting time in any area. Menus, loading, background and closed-app time do not count. Renewal waits for restored bounds and leftover source rewards to be off-screen with a safety margin, at least 12 m from the player, and free of actor overlap. Unseen destination preparation also protects the arrival. Chests open even with living enemies nearby; enemy lives return with normal loot and fresh finite proficiency budgets. Remaining source rewards expire on renewal, while player-dropped items remain independent and collected one-time equipment stays claimed.

Revision 9 saves enemy health/budgets/reward completion, chests, resource progress/depletion, ground loot/provenance, renewal timers, open return portals, committed cooldowns and the last safe campfire alongside character progress. Normal startup restores full health at that safe fire, with Homestead fallback; legacy saves begin a fresh outing at Homestead once. Title/Play, four named character slots and Return to Title surround this saved outing; settings remain shared and save recovery is silent. The 45-minute cadence is a chosen starting value, not a completed outing-balance evaluation.

## Starter Smithing and damage vocabulary — October 3

The Homestead forge/anvil opens a learned-only Forge/Reclaim sheet using the selected [Workshop layout](../ui/concepts/smithing/README.md). Five fixed catalogue recipes unlock through level 10; two-second foreground forging consumes Bag then unlocked Stash materials and creates Bag gear atomically. Cancellation/full Bag retains resources. Reclamation is a level-1 major: direct permanent salvage of unequipped metal gear returns authored materials/precious-metal value and 20 base XP, without confirmation or Undo. Heat Seasoned at 2 grants 15% Burn Resistance; Hammer Arm at 4 grants 5% physical melee damage. Recipe unlocks remain separate from the talent tree.

One additional Iron deposit in Homestead and one in Clearing retain normal gathering/renewal rules. No new models, textures, motions or random equipment properties were prepared. [Smithing](../SMITHING.md) owns costs, XP, matching returns, persistence and focused acceptance. Complete-adventure reward pacing, the full level-20 profession and crafted/found loadout evaluation remain future work.

The shared damage vocabulary is Physical, Burn, Freeze, Poison, Bleed and Nature, with Stun defined separately as loss of control. The goblin caster now casts a direct Burn-damage fireball with its existing timings and collision; Staff uses Nature and Bone Caster uses Freeze. Armor continues reducing all direct hits. Native TSL presentation and existing fire pools remain in the shared pipeline.

## Distributed discoveries and interruption rules — October 3

First Sword/Shield discoveries remain in the Clearing camp chest; Bow is in the trail cache near gathering stops and Staff is in the optional woodland cache. Other authored rewards remain at their sources. The opening is Clearing-only and uses existing props; earlier collected claims, saved drops and opened chests remain intact. Additional boss/route rewards remain future work.

Enemy attacks now have explicit ordinary melee, ordinary caster, protected and heavy-breakable policies, separate from reward rank. Current encounter difficulty stays ordinary: melee late commitment resists normal hits but yields to Crushing Blow/Executioner's Strike; caster preparation remains interruptible. Protected preparation and heavy-breakable preparation are available for future authored attacks, with interruptible recovery and death taking precedence. See [enemy attack interruption](../EQUIPMENT.md#enemy-attack-interruption). Elite encounters and the named boss remain outstanding.

## Shared skill progression — October 4

All 28 tracks use one XP curve, with the full tree at level 20 / 24,000 XP and continued levels afterward. Combat/Magic majors follow 1/1/3/5/15/20 learning order; profession majors use 1/3/5/10/15/20, with ten shared passive milestones through 20. Sword/Bow final Ultimates now unlock at 20 and Berserking at 5. Shared pure award calculations apply Rested once and retain finite enemy credit, collected-only harvest provenance and atomic crafting. No XP conversion is performed for old development snapshots.

[Progression](../PROGRESSION.md) owns source rewards and deterministic budgets. The 3–5-hour mastery target still needs complete-adventure observation. Axe's Physical/Bleed/Rage roster is selected design direction; its new actions, wound cash-out and momentum remain future implementation. This milestone does not activate planned tracks or their placeholder effects.
