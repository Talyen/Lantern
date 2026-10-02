# Animation review and authoring

Lantern uses Mixamo motions baked independently to Paladin J Nordstrom and Goblin D Shareyko. Weapon models come from the converted Synty library. The aim is readable preparation, decisive contact, short recovery, and footwork that agrees with movement while the player faces the cursor.

This review records the original 17 prepared clips, the source-selection correction, and the new equipment profiles. Source inspection, actual-rig comparisons and native WebGPU gameplay checks establish the changes below. A compatible rig and a passing build do not establish good hand placement, convincing foot contact, or smooth transitions.

## Confirmed causes

The old Paladin forward selection was a backward run. Its generic **sword and shield run** title hid the source's actual direction. Source hip samples match the explicitly described **Sword And Shield Backward Run**: both advance along source-world +Y, whereas the explicit forward source advances along −Y. The exported/runtime character forward basis is already +Z. Select the right motion at the catalog/export owner; rotating the entire character 180 degrees or playing every clip backward would break aim and other actions.

The Goblin's generic **Running** selection was described as **Turn To Silly Run Away**. Its default hit reaction was a pistol-holding reaction. The player's roll was **Dive Roll While Holding Rifle**. These are source-selection problems, even when their retargeted bones bind successfully.

Dodge also activated an invulnerability effect that alternated brightness over the whole canvas. That filter has been removed. Dodge immunity remains simulation state; the ground, scenery and UI must keep stable brightness throughout a roll. Damage feedback stays local to the struck actor.

## Original clip inventory

Durations below describe the previous prepared clips. Recommendations concern observed source suitability and action timing; three comparative poses per original clip support the inventory below. All 17 sources remain available on their own rigs in the comparison lab as **Previous …** entries.

| Rig / previous clip | Previous duration | Source or behavior issue | Replacement / recommendation |
| --- | ---: | --- | --- |
| Player / sword and shield idle | 8.67 s | Broad shield stance was the default even without equipment; generic title gave little selection evidence. | Explicit Shield Idle for shield loadouts; Axe Idle for one-handed weapons, Bow Idle for Bow, and a short casting preparation pose for Staff. Inspect loop settling and grips. |
| Player / sword and shield run | 0.53 s | Confirmed backward source selected for forward movement. | Shield Forward for forward travel, separate Shield Backward and left/right strafe loops. Axe and Bow have their own directional families. |
| Player / sword and shield slash | 1.67 s | Full source recovery held input; generic 42% contact landed at about 0.70 s. | Retain this compatible source as Sword Attack with a trimmed, cooked action and explicit 0.26 s contact. |
| Player / sword and shield impact | 0.70 s | Long reaction lock and shield-specific pose applied to every loadout. | Axe-specific reaction from the left cooked to about 0.30 s; inspect transition back to each weapon stance. |
| Player / sword and shield death | 2.30 s | Generic title obscured the actual fall; no weapon/grip comparison existed. | Explicit Sword And Shield Falling Back Death cooked to about 1.35 s. Check ground intersection and final held pose. |
| Player / Dive Roll | 3.00 s | Rifle-holding source compressed into a 0.45 s dodge; canvas-wide invulnerability flash compounded the motion. | Dive Roll From Standing, trim the rolling interval, scale playback to the unchanged 0.45 s dodge, and keep scene brightness stable. |
| Player / sword and shield block idle | 1.37 s | Prepared as an alternate idle, without a functional shield block. | Explicit Shield Block for a held shield stance and upper-body movement blend. Inspect shield direction at idle and half-speed movement. |
| Player / sword and shield attack | 1.30 s | Alternate generic attack; inherited percentage contact and whole-clip lock. | Keep as a comparison source. Prefer the reviewed Sword Attack profile; promote alternatives only after assigning their own trim and contact. |
| Player / sword and shield slash (2) | 3.53 s | Long alternate action/recovery is unsuitable as a responsive basic attack without editing. | Keep for comparison; select a single readable strike interval before considering an alternate/combo. No combo system is introduced. |
| Player / sword and shield run (2) | 0.53 s | Its sampled planted-foot travel also matches the backward source. | Keep for comparison. Use explicitly described forward/backward/strafe sources and compare planted-foot travel before promoting this alternative. |
| Goblin / Orc Idle | 5.33 s | Source explicitly describes Male Orc Standing Idle; broadly suitable, but weapon placement was absent. | Retain as Goblin Idle and inspect the equipped Axe through the loop. |
| Goblin / Running | 1.63 s | Source describes Turn To Silly Run Away, including behavior inappropriate for pursuit. | Use an explicit forward Axe locomotion source. At the Goblin's 1.45 m/s pursuit speed, use the selected Axe walking stride rather than stretching a sprint; the runtime role is still named `run`. |
| Goblin / standing melee attack horizontal | 2.40 s | Generic title matched a different source than the explicit Axe attack; full lock/contact percentage lacked a weapon-specific review. | Explicit Right To Left Attack With Axe, cooked to about 1.05 s with contact at 0.46 s, preserving a readable enemy wind-up. |
| Goblin / Hit Reaction | 2.60 s | Source describes Reaction To Getting Hit To The Left While Holding A Pistol; long weapon-inappropriate reaction. | Axe-specific reaction from the left baked to Goblin and cooked to about 0.35 s. |
| Goblin / Dying | 4.33 s | Source describes Death Hit From The Back Falling On One Knee; long staged fall and directional assumption. | Explicit falling-back death baked to Goblin and cooked to about 1.55 s. Inspect its final grounded pose. |
| Goblin / Standing Melee Attack Horizontal | 2.40 s | This alternate source explicitly describes Right To Left Attack With Axe, unlike the previous default with a similar title. | Promote this exact source into Goblin Attack with the reviewed trim/contact above. |
| Goblin / Run | 0.63 s | Source describes Female Ninja Run; silhouette and hand posture do not support the equipped Axe. | Keep for comparison; use the explicit Axe locomotion source calibrated to actual pursuit movement. |

## Canonical motion profiles and clocks

[The motion manifest](../assets/motion-profiles.json) owns stable clip IDs, exact source selections, source trims, intended cooked duration, contact/release times and locomotion speed calibration. Preparation verifies private source identity and bakes each selection to its own rig. Titles are display labels, not selection keys. Source catalogs, hashes and licensed files remain private.

The five base roles remain `idle`, `run`, `attack`, `hit` and `death`. Profiles additionally select `backward`, `left`, `right`, walking legs for `block`, `chop` and player `dodge`. The imported Mixamo anatomical left moves +X and right moves −X; runtime weights respect that verified basis. A `run` role means the locomotion loop; an enemy walking stride can occupy it without changing simulation behavior. Previous audit clips remain selectable in the lab and are excluded from gameplay defaults.

| Prepared action | Manifest duration target | Contact / release |
| --- | ---: | ---: |
| Player Axe Attack | 0.68 s | Contact 0.28 s |
| Player Sword Attack | 0.62 s | Contact 0.26 s |
| Player Bow Attack | 0.80 s | Arrow release 0.53 s |
| Player Staff Attack | 0.75 s | Bolt release 0.32 s |
| Player Axe Chop | 0.80 s | Tree contact 0.32 s |
| Player Hit / Death | 0.30 / 1.35 s | — |
| Player Dodge | 0.45 s simulation | — |
| Goblin Axe Attack | 1.05 s | Contact 0.46 s |
| Goblin Cast | 1.60 s | Bolt release 0.80 s |
| Goblin Hit / Death | 0.35 / 1.55 s | — |

Bakes sample at 30 fps, so actual clip duration can differ from the manifest target by up to half a 30 fps frame. For example, a 0.68 s target currently produces approximately 0.67 s, while the roll produces approximately 0.47 s and is scaled to the 0.45 s simulation clock. Gameplay locks use the prepared clip duration; contacts/releases use the same catalog metadata as the presentation. Do not restore percentage-based contacts or independently maintained timing tables in the coordinator.

[Motion loading](../src/animation/combat-animations.ts) owns compatible catalogs, profile selection and lazy clip loading. [Actor presentation](../src/clearing/actors.ts) owns verified track binding, transitions, gait phase and animation playback. [Encounter simulation](../src/gameplay/encounter.ts) owns action locks, hit resolution, immunity and projectiles. [The coordinator](../src/clearing/clearing.ts) owns transactional equipment preparation and cancellation across menus, travel and reset.

Directional weights use actual collision-resolved displacement relative to cursor-facing yaw. Directional loops share a normalized gait phase; playback advances from actual speed and the selected stride calibration. Starts, stops and reversals ease without running continuously into a wall. The shield movement layer retains the blocking upper body while walking legs follow directional travel. Scheduled gait actions fade out even though their manually phased playback rate is zero, so contact poses fully replace locomotion. All available fingers are retargeted, including the previously omitted ring and little fingers. Staff combines a steady Mixamo carrying arm/finger grip with its free-arm cast; the Shield grip faces forward in the block pose.

Attack and dodge requests can occupy one pending slot for 150 ms. The most recent request replaces the previous one and can start when the existing action/cooldown permits it. The buffer does not cancel attack or hit locks, change committed attack facing, or extend dodge immunity. Menus, death, travel, reset and input clearing discard pending commands. Dodge preserves its 2.4 m distance, 0.45 s duration, 0.25 s immunity and one-second cooldown.

## Equipment and harvesting flows

New and migrated characters own and equip an Axe. The defeated clearing camp chest grants Sword, Shield, Bow and Staff once per character alongside its scrolls. Inventory with **B** shows owned items, main/off-hand slots, Wood, Woodcutting XP and Axe Combat XP. Equipment and prepared motions commit together; failed preparation retains the working loadout. Equipping Bow or Staff clears the off-hand slot and keeps any Shield owned. Empty hands disable weapon attacks. Previewing lab equipment does not mutate these saves.

**Left click** attacks with committed aim. Clicking the visible enemy body picks its centre; free-space clicks retain ground aim. Bow preparation starts at the raised draw pose rather than lowering an already aimed bow. Axe and Sword resolve melee contacts; Bow and Staff release a projectile at their marker, with swept travel, terrain obstruction and one damage application. Basic attacks remain available at home and after victory so new weapons can be inspected. Weapon changes preserve enemy and reward state.

**Hold right mouse** with a Shield to block toward the cursor. Blocking halves movement speed and incoming damage in the frontal 120-degree arc, prevents attacks, and ends on release or dodge. Rear hits retain the normal reaction. **Shift** dodges in held movement direction or, while stationary, the latest aim direction.

**Hold E** within 1.8 m of a standing tree's trunk surface with an Axe to step into striking distance and repeat the distinct Axe Chop action. Rewards occur at contact: one Wood and 10 Woodcutting XP. Three contacts fell the tree and show a stump; movement, attacks, dodge, damage, menus or leaving reach interrupt chopping. Tree identities survive scenery batching, and felling updates collision/navigation. Regrowth follows 120 active gameplay seconds across areas, pauses with play and waits if an actor overlaps the trunk. Tree depletion is session state; Wood and XP persist. Chopping does not rebake lighting.

A damaging Axe combat contact grants 10 Axe Combat XP independently of Woodcutting. Levels, skill bonuses, combos, stamina, ammunition consumption, mana costs, skills and ultimates remain deferred. The initial weapon comparison uses the existing 50-point player damage and a 12 m projectile range.

## Solo caster

The caster in Forest Clearing’s separate woodland glade uses its own instance of the Goblin rig with a Staff. Its free-arm Mixamo cast is independently baked from the verified casting source, with a 1.6-second action and 0.8-second release marker. The staff arm retains the compatible carrying pose and a grip clip baked to Goblin, rather than borrowing Paladin tracks. The camp raider remains present with its existing Axe profile. Gameplay loads each enemy’s compatible equipment profile directly.

The native WebGPU placement review on macOS used normal graphics settings in one managed session. Neither enemy engaged at the player start. Walking off the approach into the caster glade activated only the caster; a forward dodge and two aimed attacks defeated it with full player health while the camp guard stayed idle at 100 health. The caster's own health bar followed its body, and a fern was moved off the approach after visual inspection. Focused simulation checks cover independent aggro, per-frame player clocks, damage targeting, guard-specific chest access, per-enemy rewards and both enemy snapshots through travel. This is targeted acceptance, not cross-platform validation.

## Comparison and acceptance evidence

The observations below record the original equipment/motion review. Its studio/silver lighting choices and menu-based Restart/inspection controls have since been retired or moved to development authoring; current gameplay uses the shared Golden preset.

Open the [animation comparison route](../src/labs/animations/animation-lab.ts) on the development server with `/?lab=animations`. Each lane selects its own Player/Goblin rig and weapon model, browses that rig's compatible clips, and retains independent temporal history in the shared native WebGPU pipeline. Use normal/half/quarter speed, frame steps, linked cycle lengths, scrub, and the contact/release marker to inspect hand placement and timing. Goblin has Axe and Staff gameplay profiles; Staff supplies the separate caster fight in the normal clearing. Other lab equipment models do not imply weapon-specific Goblin gameplay motions.

The representative automated flows cover v1 save migration, unique equipment rewards, two-hand Shield return, separate saved progression, contact/release timing, buffered aim and recovery boundaries, frontal/rear block damage, swept terrain obstruction and exactly-once ranged damage. A presented-pose regression verifies that contact actions fully replace manually phased locomotion. Level flows cover systematic tree identity, depletion/regrowth, occupancy and removed/restored collision/navigation.

Native WebGPU browser observations on macOS:

- All 17 Previous sources were compared at three poses on their own rigs, alongside their replacements. Numerical sampling covers all 51 prepared clips and confirms the old forward selections have backward planted-foot travel, while the selected forward/backward/strafe families oppose the corresponding displacement.
- WASD forward/backward/strafe movement settles to idle; dodge crosses its compact roll and returns to idle with the canvas brightness filter empty throughout. Local character feedback remains, and actor/equipment silhouettes were reviewed in studio, golden and silver references.
- Axe and Sword each defeated the Goblin with two damaging contacts. The chest granted all four items, and equipment/Animations selections stayed aligned without resetting the encounter. Bow body clicks damaged the enemy after the centre-picking correction; Staff released a visible bolt at home. Shield hold/movement selected its guard and walking layers. Damage direction/reduction is covered by the simulation flow.
- Standing against the engaged Goblin produced defeat. Return Home restored 100 health and retained equipment/Wood/XP; the menu Restart restored a playable encounter. Rock inspection entered its close view and returned successfully.
- Three chops produced three Wood and 30 Woodcutting XP, a stump, and a completed navigation-worker update without errors. The lighting fingerprint stayed unchanged during chopping. Felling survived Homestead travel and return; regrowth was observed during continued play. The exact 120-second/occupancy rules are verified by the level flow. The cross-area lighting fingerprint comparison was not a controlled cache-reuse measurement and is not used as evidence for travel-cache behavior.
- Motion-only preparation now refreshes all ten retained gallery entries; their sample URLs resolve to compatible prepared clips. Licensed captures and detailed pose/flow evidence remain private.

This historical pass used playable asset validation and the former full gate. New animation edits use one affected action/transition in a normal preview and the fast `npm run check`; full playable/catalog validation is targeted to changed preparation or a requested audit. A passing check describes its stable source snapshot; it does not establish other-platform performance or eliminate every art cleanup opportunity.

The raider now checks its committed forward swing arc and retains the attack pose through nonlethal hits during the final 0.16 s before contact. Earlier/recovery hits stagger; lethal hits always stop it. Local hit particles and recorded action/impact audio support the exchange; see [gameplay sound](AUDIO.md).

Remaining art limits: Bow mesh/string deformation and nocking are not authored yet; retargeting has no runtime hand/foot IK; Staff locomotion shares the Axe directional family with a steady carrying arm. Future weapon-specific hit/death/roll refinements should use the retained source catalog and actual gameplay-scale comparisons rather than generic clip titles. Skills, ultimates, levels and progression bonuses remain outside this basic pass.
