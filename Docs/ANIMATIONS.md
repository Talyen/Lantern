# Animation review and authoring

Lantern uses Mixamo motions baked independently to Erika Archer, Goblin D Shareyko and the graveyard Skeleton rig. The original Paladin audit below remains historical source-selection evidence. Weapon models come from the converted Synty library. The aim is readable preparation, decisive contact, short recovery, and footwork that agrees with movement while the player faces the cursor.

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

The five base roles remain `idle`, `run`, `attack`, `hit` and `death`. Profiles additionally select `backward`, `left`, `right`, walking legs for `block`, `chop`, `mine`, starter Skill actions and player `dodge`. The imported Mixamo anatomical left moves +X and right moves −X; runtime weights respect that verified basis. A `run` role means the locomotion loop; an enemy walking stride can occupy it without changing simulation behavior. Previous audit clips remain selectable in the lab and are excluded from gameplay defaults.

| Prepared action | Manifest duration target | Contact / release |
| --- | ---: | ---: |
| Player Axe Attack | 0.68 s | Contact 0.28 s |
| Player Sword Attack | 0.62 s | Contact 0.26 s |
| Player Bow Attack | 0.80 s | Arrow release 0.53 s |
| Player Staff Attack | 0.75 s | Bolt release 0.32 s |
| Player Axe Chop | 0.80 s | Tree contact 0.32 s |
| Player Pickaxe Mine | 0.90 s | Mineral contact 0.36 s |
| Player Hit / Death | 0.30 / 1.35 s | — |
| Player Dodge | 0.45 s simulation | — |
| Goblin Axe Attack | 1.05 s | Contact 0.46 s |
| Goblin Cast | 1.60 s | Bolt release 0.80 s |
| Goblin Hit / Death | 0.35 / 1.55 s | — |

Bakes sample at 30 fps, so actual clip duration can differ from the manifest target by up to half a 30 fps frame. For example, a 0.68 s target currently produces approximately 0.67 s, while the roll produces approximately 0.47 s and is scaled to the 0.45 s simulation clock. Gameplay locks use the prepared clip duration; contacts/releases use the same catalog metadata as the presentation. Do not restore percentage-based contacts or independently maintained timing tables in the coordinator.

[Motion loading](../src/animation/combat-animations.ts) owns compatible catalogs, profile selection and lazy clip loading. [Actor presentation](../src/clearing/actors.ts) owns verified track binding, transitions, gait phase and animation playback. [Encounter simulation](../src/gameplay/encounter.ts) owns action locks, hit resolution, immunity and projectiles. [The coordinator](../src/clearing/clearing.ts) owns transactional equipment preparation and cancellation across menus, travel and reset.

Directional weights use actual collision-resolved displacement relative to cursor-facing yaw. Directional loops share a normalized gait phase; playback advances from actual speed and the selected stride calibration. Starts, stops and reversals ease without running continuously into a wall. The shield movement layer retains the blocking upper body while walking legs follow directional travel. Scheduled gait actions fade out even though their manually phased playback rate is zero, so contact poses fully replace locomotion. All available fingers are retargeted, including the previously omitted ring and little fingers. Staff combines a steady Mixamo carrying arm/finger grip with its free-arm cast; the Shield grip faces forward in the block pose.

Attack, ability, dodge and weapon-swap requests can occupy one pending slot for 150 ms. The most recent request replaces the previous one and can start when the existing action/cooldown permits it. The buffer does not cancel attack or hit locks, change committed attack facing, or extend dodge immunity. Menus, death, travel, reset and input clearing discard pending commands. Dodge preserves its 2.4 m distance, 0.45 s duration, 0.25 s immunity and one-second cooldown.

## Equipment and harvesting flows

New characters start with an equipped Axe; migration preserves existing equipment and progress. The defeated clearing camp chest offers Sword, Shield, Bow and Staff until each is permanently claimed on collection, alongside its session scroll and potion rewards. Inventory with **B** shows both weapon sets, supplies, Woodcutting/Mining progress, Axe Combat XP and Rested; the repaired shelter opens the paired Stash. Equipment and prepared motions commit together; failed preparation retains the working loadout. Equipping Bow or Staff clears that set's off-hand slot and returns its Shield to the bag only if it fits. Empty hands disable weapon attacks. Previewing lab equipment does not mutate these saves.

Attack abilities commit aim when accepted. The default **left click** slot starts with Axe Basic; Skills can change that assignment. Clicking the visible enemy body picks its centre; free-space clicks retain ground aim. Loot and world-object clicks take priority over the assigned ability. Bow preparation starts at the raised draw pose rather than lowering an already aimed bow. Axe and Sword resolve melee contacts; Bow and Staff release a projectile at their marker, with swept travel, terrain obstruction and one damage application per enemy. Basic attacks remain available at home and after victory so new weapons can be inspected. Weapon changes preserve enemy and reward state.

**Hold the assigned Shield Basic input** with a Shield to block toward the cursor. Blocking halves movement speed and incoming damage in the frontal 120-degree arc, prevents attacks, and ends on release or dodge. Rear hits retain the normal reaction. **Shift** dodges in held movement direction or, while stationary, the latest aim direction.

Contextual left-click gathering repeats Axe Chop or Pickaxe Mine with temporary tool attachments, regardless of combat equipment. Pickaxe Mine uses the retained downward Axe strike source baked to Erika with its own cooked duration and contact marker. Gathering profiles bypass the Staff carrying-arm modification. Each valid contact drops a resource; collected quantities award XP once. Three starting contacts deplete a node. See [gathering and shelter](GATHERING.md) for selection, cancellation, renewal and progression.

Axe effective damage grants 0.2 base Axe Combat XP per newly reached enemy health point independently of Woodcutting, with the shared Rested multiplier. Gathering levels, Rested, shared regenerating mana and the starter Sword/Bow Skills are implemented; Sword/Bow mastery, Onslaught and earned Ultimates are implemented; stamina and ammunition consumption remain deferred. See [weapon mastery](EQUIPMENT.md#sword-and-bow-mastery). Basics deal 50 damage and starter Skills deal 60; player projectiles retain a 12 m range. Ability costs and cooldowns belong to [`abilities.ts`](../src/gameplay/abilities.ts); see [starter Skills](#starter-skills-and-gathering-presentation) for their motions.

## Solo caster

The caster in Forest Clearing’s separate woodland glade uses its own instance of the Goblin rig with a Staff. Its free-arm Mixamo cast is independently baked from the verified casting source, with a 1.6-second action and 0.8-second release marker. The staff arm retains the compatible carrying pose and a grip clip baked to Goblin, rather than borrowing Paladin tracks. The camp raider remains present with its existing Axe profile. Gameplay loads each enemy’s compatible equipment profile directly.

The native WebGPU placement review on macOS used normal graphics settings in one managed session. Neither enemy engaged at the player start. Walking off the approach into the caster glade activated only the caster; a forward dodge and two aimed attacks defeated it with full player health while the camp guard stayed idle at 100 health. The caster's own health bar followed its body, and a fern was moved off the approach after visual inspection. Focused simulation checks cover independent aggro, per-frame player clocks, damage targeting, guard-specific chest access, per-enemy rewards and both enemy snapshots through travel. This is targeted acceptance, not cross-platform validation.

## Animation viewer

The development route `/?lab=animations` defaults to one nearly full-window character. **Preview A/B** switches the active character; **Compare A / B** restores side-by-side inspection. The right inspector contains rig, equipment, search, clip and contact/release controls; **Controls** collapses it. Playback, speed, frame step, view and scrubbing remain at the bottom. **Fullscreen** expands the viewer and **Fit character** frames the current character and equipment.

Drag to orbit, right-drag to pan and scroll for close inspection. Space toggles playback when focus is outside form controls. Single-view scrubbing uses the active clip's duration. Matched cycle lengths apply only in comparison mode; A and B retain their prepared clips and independent temporal histories when switching views.

The viewer uses the same native WebGPU/FSR pipeline and shared Golden lighting. Inspection disables lens blur and bloom, without changing saved gameplay graphics preferences. The optional **Player lantern** uses the gameplay belt attachment and owner-bounce recipe, follows the selected rig and changes no save data. Gathering previews use the gameplay temporary Axe/Pickaxe attachments and do not overwrite the Staff arm pose during chopping/mining. Hidden lanes retain their comparison state and are resized before rendering again.

Erika is the sole player appearance, with authored geometry/UVs/textures and all compatible player profiles. Her original quiver/arrows appear only with committed Bow-family equipment. See [protagonist preparation and acceptance](PROTAGONISTS.md).

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

Remaining art limits: Bow mesh/string deformation and nocking are not authored yet; retargeting has no runtime hand/foot IK; Staff locomotion shares the Axe directional family with a steady carrying arm. Future weapon-specific hit/death/roll refinements should use the retained source catalog and actual gameplay-scale comparisons rather than generic clip titles. The action-bar addition below extends this basic pass with starter Skills; earned Ultimates and progression bonuses remain later work.

## Starter Skills and gathering presentation

Sword Sweep uses **Stable Sword Outward Slash**, source `601fe909df8a`, independently baked to Paladin. Bow Piercing Shot joins **Standing Aim Overdraw** (`0e01e003edfb`) and **Standing Aim Recoil** (`57f928ff818a`) with an 80 ms pose transition. Recipes, trims and contact markers stay in the motion manifest. Runtime loads only these selected compatible clips; the full catalog remains private. The comparison lab exposes a Skills filter for source audition.

The action bar activates the compatible equipped set automatically. A Skill uses its own action lock/contact marker, shared mana and independent cooldown, while Basic and dodge remain free. Sword Basic uses a focused 90-degree arc; Sweep covers the forward 180 degrees at the same reach. Piercing Shot keeps the 12 m arrow range, crosses each enemy once and stops at terrain. Neither adds invulnerability.

Click-to-harvest presents the basic Generic Axe tool and the existing Paladin Axe Chop action, even when a Sword, Bow or Staff is equipped. Its owned item state and active combat set remain unchanged, and interruption restores their presentation.

Native review of the action-bar addition confirmed the Paladin Sweep and bow draw/recoil source poses, automatic set activation and hold/release Shield Basic. A focused clearing flow defeated the guard, opened/collected chest rewards, configured both sets and assigned abilities through selection and dragging. F healed during live combat; T and paired portal clicks completed the home/return loop. With no owned Axe, a clicked tree granted 30 Woodcutting XP and restored Sword + Shield presentation after felling. Hover picking remained available with cosmetic Outlines off. Keyboard conflict swapping, mouse/secondary movement remapping, Apply/Cancel and saved layout/controls were checked in the managed browser. This is local native WebGPU acceptance, not a hardware performance result. The pass deferred measurements under the resource policy at that time; current reviews use the single owned GPU session described in [Development](DEVELOPMENT_REFERENCE.md#private-assets-and-resource-use).

## Ultimate motion and Synty effects study

Open `/?lab=animations&study=ultimates` in an owned development preview. This is a development-only complete-sequence review on the actual Forest Clearing ground with three practice Goblins, Erika, gameplay's camera/graphics settings, and the shared Golden lighting/pipeline. It changes no character saves or rewards; its rain presentation is shared with gameplay.

The current study keeps **Rain of Arrows** and reviews **Executioner's Strike** with optional Shield; Crescent Wave is set aside, no longer offered, and its motion is no longer loaded. Replay, pause, slow playback or scrub the sequence. Effects Off isolates character motion and practice reactions. Sound follows the existing mix and can be muted locally; seeking stays silent. Close view supports contact inspection; Gameplay view restores the saved distance. A sequence includes its effect tail and a quiet interval before looping. Hidden views suspend rendering and playback without catch-up.

Arrow Rain authors a study-only skyward variant of the compatible joined Mixamo bow draw/release. The arms raise together toward a 58-degree skyward aim, using sampled two-bone arm poses without stretching the skeleton; the head follows the aim and the original footwork remains intact. A brief held draw leads to release at 0.93 seconds, followed by lowering through the 1.5-second motion. Gameplay's Piercing Shot clip remains unchanged.

One Synty arrow follows the draw hand and bow rest while nocked. Its release position and direction are captured from the release pose, so forward/backward seeking and replay reproduce the same flight even after the character lowers the bow. A short restrained trail accompanies the ascending arrow. The projected target footprint appears after release as a faint, uneven brown perimeter with soft edges and no filled centre; staggered falling arrows, local impact sparks/dust, spaced practice hit reactions and briefly embedded shafts retain the landing treatment. The sequence lasts 4.8 seconds. Rain choreography is shared with gameplay; damage pulses remain simulation-owned. Its numeric balance remains provisional. Bow/string deformation remains a future authored-art refinement.

Synty supplies the dust and ground-break textures, spark mesh and arrows. Plume 0.1.1 owns the dust/spark particle systems and curves; TSLFX 0.6.0 supplies projected impact rings. Lantern owns ability choreography, ground receivers and complete-sequence clocks. The earlier partial Unity particle-module replay was removed; the normal animation lab retains its existing motion inspection. Effects project only onto the actual ground receiver, use node materials, and remain in the single shared visual pipeline. No gameplay weapon trail or separate rendering graph is introduced.

The design references are Blizzard's [animated damage-area demonstration](https://www.youtube.com/watch?v=3BnHvNZ_4YM), [VFX hierarchy and combat timing](https://news.blizzard.com/en-gb/article/23746639/diablo-iv-quarterly-updatedecember-2021#DanielBriggs), and GGG's [Ranger showcase](https://www.youtube.com/watch?v=iw870QM1V5k), including Rain of Arrows around 8:52. Ground footprint, travel, impacts and aftermath are reviewed together at gameplay scale.

Prepare the private art as described in [asset preparation](ASSET_PREPARATION.md#ultimate-study-assets). Study motions and particle art have no production references and stay outside build staging. The [library-trial contract](LIBRARY_TRIALS.md#ultimate-vfx-library-trial) owns the peer override, native-only preparation, lifecycle and upgrade limitations.

### Sword/Bow action preparation

The manifest now prepares Thrust, Executioner's Strike and Onslaught for both Sword loadouts; Riposte uses the compatible Sword attack for its triggered counter and a held blade-preparation pose for its stance. The first Executioner Power Slash candidate lifted the feet and was rejected. The adopted Overhead Bashing Swing source retains planted feet, with the contact reviewed at 0.74 seconds in its 1.05-second cooked action. Bow reuses its Basic shot for Poison/Multishot, shares the authored skyward Rain clip with the lab and extends the joined draw for Deadeye. Every prepared role supplies explicit contact markers; pose playback follows the snapshotted attack rate.

## Axe Skill and Berserking motions

Crushing Blow independently bakes **Downward Attack With Axe** (`50032fca84ef`) to Erika rather than using the gathering action at runtime. Its 0.15–2.05-second source interval is cooked toward 0.95 seconds, with reviewed contact at 0.38 seconds. Berserking independently bakes **Battlecry With Axe** (`cc64b1879065`), using its 0.5–1.6-second source interval cooked to 0.5 seconds. Both belong to the Axe and Axe + Shield profiles and the lab's Skills filter. Attack-rate bonuses drive Crushing Blow playback/contact together; the battle cry keeps its authored rate.

An owned native-WebGPU session inspected both actions on Erika with and without Shield, using the contact and mid-cry poses and normal gameplay playback. The selected downward strike keeps the Shield clear; the cry opens the chest and arms without using a damage reaction. Original FBXs remain private and unchanged. The owned gameplay flow earned Berserking from Crushing Blow, retained other assignments, activated its recorded vocal cue and reviewed the timed HUD state. These are local interaction/motion observations, not cross-platform or final listening-based mix approval.
