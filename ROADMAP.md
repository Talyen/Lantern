# Lantern roadmap

## Direction

Build a small, connected section of a continuing Diablo-style fantasy action RPG. Keep deliberate, responsive combat, keyboard movement, and the current isometric camera. Ground loot, equipment, local character persistence, and a Homestead support a continuing adventure rather than temporary upgrades or a run reset.

Combat, exploration, and equipment discoveries drive each outing. Gathering and Homestead restoration support the adventure with modest functional upgrades, beginning with shelter and storage. Restoration is an encouraged early goal, not a requirement for reaching new areas. Branching authored woodland routes lead through optional discoveries toward a nearby area and a named woodland boss, then reveal a lead toward the next adventure. Ordinary packs provide momentum and a sense of power while positioning, priority targets, and occasional dodges still matter; elites demand careful positioning, timing, and defensive play. Weapon choice changes the player's combat style, beginning with swords and bows.

Improve skills by using them. Each sword/bow set has a free left-click Basic, one Skill, and one Ultimate. Start with the Skill and earn the Ultimate during the first complete adventure. Further Sword and Bow proficiency unlocks alternate abilities and modest passive bonuses; characters remain flexible, with selected abilities and equipment defining combat style. There is no general player level for now, and proficiency does not gate equipment. Gathering and crafting begin with Woodcutting, Mining, and Smithing. Keep gathering to brief, worthwhile stops along adventure routes. The first complete slice proves combat and discovery, gathering, returning home, restoration, storage, automatic rested benefits, and repeat outings, including a handcrafted side encounter and the named boss, before broader world or skill expansion.

## Milestone 1 — First playable clearing

- [x] Local, repeatable Synty scenery and projected rock pipeline.
- [x] Establish a private, resumable Mixamo acquisition pipeline.
- [x] Export a compatible animated mannequin and a baked ImageGen forest floor.
- [x] Add desktop movement, camera follow, one enemy, attacks, health, victory, defeat, and retry.
- [x] Verify the encounter and asset lab in a browser; run the production build.

Acceptance: a player can start the encounter, defeat the goblin with two hits, lose after five hits, retry, and inspect both rock surfaces. Private vendor art stays out of Git.

## Milestone 2 — Finish the combat foundation

- [x] Add a local A/B lab for the Mixamo motion library on one Synty warrior.
- [x] Wire Mixamo motions into combat with independent actor set selectors and wanderer move choices.
- [x] Replace the mannequin with the Synty warrior and Mixamo motions.
- [x] Choose the default compatible Mixamo motions; correct weapon grips, directional foot contact, and damage timing. Bow string/nocking and runtime hand/foot IK remain art refinements.
- [ ] Give the raider readable windup, strike, and recovery phases. Add impact audio, stronger hit response, and restrained visual feedback; tune movement and strike timing together.
- [x] Add a dodge with brief invulnerability, recovery, and cooldown; defer stamina.
- [x] Add a ranged caster with readable, avoidable magical projectiles as a solo clearing encounter (`/?area=clearing&enemy=caster`). Mixed raider/caster combat remains outstanding.
- [ ] Support swords and bows as the first player weapon families, with distinct close-range and ranged combat styles. Give each set a free left-click Basic, one mana-spending Skill, and one mana-spending Ultimate. Skills use a shared regenerating mana pool and separate short cooldowns. Ultimates use that same mana pool and share a long cooldown: using either Ultimate starts the cooldown for both sets. Basic attacks and dodge require no mana. Keep Skill and Ultimate controls consistent across weapon sets.
- [ ] Equip two weapon sets and swap between sword and bow during combat. Each set retains its own selected abilities; proficiency unlocks choices rather than requiring a permanent specialty.
- [ ] Establish both combat rhythms: ordinary packs the player can clear with momentum, and elite encounters that reward reading attacks and exploiting openings.
- [ ] Make combat spaces readable: large blocking props affect both actors, routes remain clear, and foreground scenery does not hide threats.
- [ ] Review the weathered autumn woodland palette across future areas: copper/rust/ochre foliage, quiet warm-brown paths and sparse burgundy accents. Keep stone warm gray, preserve amber refuge and validate actor readability in the shared lighting profiles. See [Art Direction](Docs/ART_DIRECTION.md).

Acceptance: players can fight with a sword or bow, swap equipped weapon sets during combat, recognize incoming attacks, deliberately dodge them, and exploit recovery windows. Ordinary packs feel different from elites, and mixed melee/caster combat remains readable. Each set starts with its Skill; milestone 4 adds earned Ultimates and alternate choices. Skill cooldowns remain separate across swaps, while mana and the Ultimate cooldown remain shared.

## Milestone 3 — Loot, recovery, and Homestead

- [ ] Use one [item drops and pickups system](Docs/LOOT.md) for enemies, chests, world supplies, and gathering. Scatter collectible gold, health potions, equipment, and materials as small recognizable 3D objects with a brief toss, tumble, settling, and restrained sounds.
- [ ] Collect equipment by clicking its label or ground object, walking within 1.5 m when needed. Loot clicks take priority over attacks; movement, attacks, dodge, menus, death, and travel cancel the approach. Failed pickup leaves loot intact; collected gear goes into Inventory without auto-equipping.
- [ ] Auto-collect gold, materials, consumables, scrolls, and other currencies within 1.5 m after landing, including during combat. Fill stacks to 99, then start additional stacks if space permits; leave quantities that cannot fit on the ground.
- [ ] Give every nearby on-screen drop a persistent name-only Gothic label on a smoky backplate, with ivory names, muted-gold currency, separated crowded rows, and matched object/label hover. Keep labels visible over scenery at a stable screen size; start with a 12 m display radius. See [loot presentation](Docs/LOOT.md#labels-and-visual-treatment).
- [ ] Preserve all uncollected ground loot through death and area travel without a despawn timer; application restart refreshes ground loot while collected character progress uses the broader save system below.
- [ ] Add a compact inventory and equipment menu with generous carrying capacity and stackable supplies. Return trips should serve restoration, crafting, shopping, and preparation rather than frequent unloading. Start with a few authored equipment items with distinct tradeoffs and clear stat comparisons rather than strictly increasing power; defer random affixes and rarity systems.
- [ ] Accumulate gold in a separate character wallet without inventory slots or a 99-stack limit. Health potions form consumable stacks; using one heals immediately and starts a shared cooldown.
- [ ] Regenerate health slowly outside combat. Potions provide urgent recovery, and safe campfires provide reliable recovery between outings. Passive regeneration must not soften ongoing fights.
- [x] Add a minimal, safe woodland Homestead; safe campfires restore 3% maximum health per second nearby.
- [ ] Introduce brief Woodcutting and Mining stops along combat and exploration routes before restoration requires their materials: Woodcutting yields Wood, and Mining yields Stone and Iron, using the shared [ground-drop and auto-pickup rules](Docs/LOOT.md#drops-and-collection). Hide comes from chests, supplies, and enemy drops. Deepen skill progression and Smithing in milestone 4.
- [ ] Show shelter restoration requirements and progress at the repair site. Restore shelter and unlock a persistent stash using gathered materials only; require no gold payment or mandatory special quest component. Keep Homestead growth focused on modest functional upgrades; restoration does not gate the onward route or boss.
- [ ] Returning to restored shelter automatically refreshes a modest temporary rested bonus to proficiency, gathering, and crafting progress, without waiting or a separate rest interaction. Measure its duration during active play; keep the bonus separate from direct combat power.
- [ ] Add a small Homestead shop selling potions and basic equipment, with the ability to sell unwanted gear.
- [x] Add Scrolls of Return with a two-second, non-interruptible cast. Movement and damage do not cancel it; combat continues during the cast. Death takes precedence before completion. Enter the summoned portal to go home; its paired home portal returns to the departure point, then closes.
- [x] Return to Homestead after death with restored health and collected scrolls retained; preserve session enemy health/defeat and scroll drops. The clearing chest retains its open/remaining-scroll state during the session; timed enemy repopulation remains future work.
- [ ] Save gold, inventory, equipment, potion count, gathered materials, stash contents, and Homestead restoration progress locally. Restarting the application begins at the clearing midpoint with full health and refreshed adventure areas.

Implemented subset: Inventory (B), owned/equipped Axe, Sword, Shield, Bow and Staff, compatible weapon basics, frontal shield blocking, three starter Scrolls of Return, 50% enemy scroll drops, nearby scroll auto-pickup and a stack cap of 99. The guarded clearing chest gives two return scrolls and the four additional equipment items once per character. Woodcutting yields three Wood and 30 XP per tree, shows stumps, updates collision/navigation and regrows after 120 active gameplay seconds. Wood and Woodcutting/Axe Combat XP save locally alongside equipment, scrolls and discovered fires. Campfire Travel (E) lists discovered destinations; home starts unlocked and the clearing fire is discovered on foot; enemy threats disable fire use and destinations. Restarting begins at the clearing midpoint with full health and refreshed adventure areas. Gold, potions, unified physical loot and labels, authored equipment stat tradeoffs, shops, Mining, restoration, stash, and rested bonuses remain outstanding.

Acceptance: the player can defeat an enemy and open a chest to see animated ground rewards, select equipment by name-only label or object, walk over to collect it without attacking, and equip it separately in Inventory. Supplies auto-collect after landing during combat; partial stack collection leaves excess on the ground, and gold enters a wallet. Crowded labels remain readable. Approaches can be cancelled, and unreachable or full-inventory attempts preserve loot. Uncollected drops survive travel and death until application restart; collected character progress survives restarting. The player can use a potion, buy supplies, sell unwanted equipment, travel home and back, discover shelter requirements, gather materials through the same drop system during brief route stops, carry supplies without frequent forced unloading, restore shelter, store items, and automatically refresh a rested bonus on returning to restored shelter. Restoration helps preparation but is not required to advance. Restoration and stored items survive restarting. See [loot acceptance flows](Docs/LOOT.md#implementation-acceptance) for focused interaction and visual review.

## Milestone 4 — Weapon proficiency, Woodcutting, Mining, and Smithing

- [ ] Award Sword or Bow proficiency through combat with that weapon family. Start each family with its Basic and Skill, earn its Ultimate through practice during the first complete adventure, then unlock a small set of alternate Skills and Ultimates plus modest passive bonuses. Let players freely select one Skill and one Ultimate for each equipped weapon set whenever safe outside combat, combining those choices with equipment benefits to make distinct builds. Found weapons remain usable regardless of proficiency.
- [ ] Develop Woodcutting progress through harvesting Wood from trees, building on the basic restoration interactions and shared [ground drops](Docs/LOOT.md#drops-and-collection).
- [ ] Develop Mining progress through gathering Stone and Iron from mineral deposits with the same ground-drop and auto-pickup rules. One interaction starts a brief period of automatic mining; movement cancels it, and collecting resources awards skill progress.
- [ ] Add Smithing at the Homestead, using mined ore and known recipes to make a small set of useful weapons or armor with predictable strengths and tradeoffs. Making equipment develops Smithing.
- [ ] Give crafted equipment and found equipment useful roles: crafting offers dependable alternatives, while authored drops offer other appealing strengths and tradeoffs worth changing plans for.
- [ ] Present skill progress and unlocks in compact menus. Save weapon proficiency, Woodcutting, Mining, Smithing, unlocks, selected weapon-set abilities, and gathered resources locally alongside existing character progress.

Acceptance: the player can improve Sword and Bow proficiency through use, earn an Ultimate during the first complete adventure, unlock alternate abilities and modest passives, freely change each set’s selected Skill and Ultimate whenever safe, make meaningful ability/equipment choices, gather Wood, Stone, Iron, and Hide, improve Woodcutting, Mining, and Smithing, and craft useful alternatives to found equipment at home. Returning to restored shelter refreshes the rested bonus for subsequent skill practice. Skill progress, ability selections, and resources survive restarting.

## Milestone 5 — Connected adventure and complete-loop evaluation

Area definitions and reciprocal walking travel are implemented for Homestead and the terminal clearing; the blockout remains an unfinished art and sizing trial. The complete adventure and broader state systems below remain outstanding. Integrate a rough branching route while milestones 2–4 are developing so combat, gathering, and home visits can be evaluated together; do not wait for every subsystem to be finished before testing the loop. Existing local renderer measurements are established evidence in [Performance](Docs/PERFORMANCE.md), with broader hardware validation outstanding.

- [x] Establish area definitions and linked gate travel between Homestead and the clearing, retaining health and session enemy/drop state.
- [ ] Build a compact branching authored woodland section with a clear main route, optional side paths, and an unlockable return shortcut. Introduce shelter restoration requirements early without gating advancement. Include an approach, introductory fight, chest/supplies, brief harvesting stops for Wood, Stone, and Iron, ordinary packs, and a harder mixed or elite encounter. Aim for a three-to-five-minute introductory combat route, with exploration, gathering, crafting, and repeat outings extending the adventure.
- [ ] Add one handcrafted side encounter with a distinct fight and authored reward.
- [ ] Extend the first slice into a nearby area culminating in a named woodland boss. Its readable attacks and openings should test dodge, sword/bow swapping, and the earned Ultimate. Defeating it reveals a lead toward the next adventure.
- [ ] Carry character health, equipment, inventory, and skill progress across area transitions. Health, equipment, scroll inventory, Wood and basic Woodcutting/Axe Combat XP are retained across travel, alongside session enemy/drop state; broader skills remain. Clearing chest state and uncollected scroll drops persist during the session; preserve defeated enemies until their return is due.
- [ ] Let ordinary enemies return after enough time away from an area. Apply repopulation when revisiting; enemies do not appear beside the player in an active area. A home visit alone does not immediately refresh enemies.
- [ ] Replenish harvested trees and mineral deposits after sufficient time away from their area, applying renewal on revisit. Use brief resource stops to support adventure preparation rather than dedicated mandatory gathering trips.
- [ ] Renew special fights, including elites, the side encounter, and the boss, plus their chests after sufficient time away. Apply renewal on revisit, without spawning threats beside the player. Repeat rewards provide loot; character unlocks, opened shortcuts, and Homestead restoration remain permanent and are not awarded again or undone by renewal or application restart.
- [ ] Observe unfamiliar players exploring branches, fighting ordinary packs and the boss, gathering briefly, returning home to restore shelter, craft, shop, and prepare, and setting out again. Evaluate whether fights maintain momentum and danger, swapping creates useful choices, and the boss rewards readable defensive play. Check that gathering is worthwhile, crafted and found equipment both have value, and home visits and automatic rested benefits feel useful without becoming compulsory. Evaluate loot discovery, skill unlock pacing, portal use, and whether repeat rewards and renewal timing encourage tedious farming or excessive reward accumulation.
- [ ] Validate the expanded section on Windows and another GPU family; measure loading time and build size alongside frame pacing. Trim shadows, draw calls, textures, and payload where measurements justify it.
- [ ] Decide which private art can ship in a browser build. Review deployment packaging and applicable purchase terms before distribution.

Acceptance: players can explore the branching woodland, open a return shortcut, complete the handcrafted side encounter, reach the nearby area, and defeat its named boss with character state intact across travel. Shelter restoration supports preparation without gating those destinations. Players can restore shelter and storage, automatically refresh rested benefits, and undertake a second outing. They can swap sword and bow sets, earn and use an Ultimate, make meaningful ability/equipment choices, gather briefly, and craft or shop at home without frequent unloading. After time away they can revisit renewed resources, ordinary and special fights, and chests for repeat loot while permanent progress remains intact. Found and crafted gear both offer useful tradeoffs. Record playtest findings and measured hardware limits without claiming untested platform support.

## Beyond the first complete slice

- Expand the connected world and enemy challenges around the loot-driven adventure loop.
- Extend gathering and crafting beyond Woodcutting, Mining, and Smithing as substantial progression paths alongside combat. Hide acquisition does not yet commit the first slice to Leatherworking.
- Add more weapon families and deepen their abilities and passive progression after sword and bow playtesting.
- Consider Leech and other healing effects only after evaluating the outside-combat regeneration, potion, and safe-fire recovery loop.

Broader expansion remains beyond the first slice. Two equipped weapon sets with Basic / Skill / Ultimate, shared regenerating mana and Ultimate cooldown, authored equipment tradeoffs, optional shelter restoration with automatic rested benefits, branching routes with a side encounter and named boss, and time-away renewal for resources, fights, and chests are established direction. Permanent character progress survives renewed encounters and repeat rewards.

## Implementation and validation

These are milestone commitments, not final balance values. Combat timings, mana costs and regeneration, Skill and shared Ultimate cooldowns, outside-combat health regeneration rate, potion strength, equipment tradeoffs, inventory and stash capacities, stack limits, skill thresholds, gathering duration, restoration and crafting costs, rested bonus strength and active-play duration, and enemy/resource return intervals belong to implementation and playtesting. Keep representative player flows, a few high-value automated checks, and the standard handoff gate described in [Development](Docs/DEVELOPMENT.md) when implementing features.

## Selected library trials

- [x] Add a bounded WebGPU weapon ribbon tied to baked attack contact windows.
- [x] Integrate navcat routing and Rapier grounded collision using explicit authored proxies; keep combat outcomes simulation-owned.
- [x] Compare simple/fluid portal visuals and retain the simpler gold/amber effect, without Homestead travel.
- [ ] Validate supported Windows hardware and packaged release behavior before claiming Windows/macOS release readiness.

See [library decisions](Docs/LIBRARY_TRIALS.md) and [performance evidence](Docs/PERFORMANCE.md). Synty vegetation, authored enemy roles and compact linked areas remain the selected direction.
