# Animation authoring

Lantern uses Mixamo motions baked independently to Erika Archer, Goblin D Shareyko and the graveyard Skeleton rig. Current player preparation and acceptance belong to [protagonist appearance](PROTAGONISTS.md). Weapon models come from the converted Synty library. Aim for readable preparation, decisive contact, short recovery and footwork that agrees with movement while the player faces the cursor.

## Source selection

Select clips using their catalog description and actual-rig poses, including planted-foot travel relative to motion. Generic names can conceal backward locomotion or weapon-inappropriate gestures. Correct the selected source at the catalog/export owner; do not rotate the whole character or reverse every clip to compensate. Compatible bones and passing checks do not establish convincing grips, contact or transitions.

Dodge immunity is simulation state. Keep scene/UI brightness stable through rolls and damage feedback local to the struck actor. Comparison-only Previous clips do not define current gameplay timing; selected profiles own trims and markers.

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

Mixamo acquisition and compatible bakes use 60 fps with no keyframe reduction. Actual clip duration can differ from the manifest target by up to half a 60 fps frame: a 0.68 s target produces approximately 0.683 s, and the 0.45 s dodge produces 0.45 s. Gameplay locks use the prepared clip duration; contacts/releases use the same catalog metadata as the presentation. Do not restore percentage-based contacts or independently maintained timing tables in the coordinator. The animation viewer steps by one 60 fps frame.

[Motion loading](../src/animation/combat-animations.ts) owns compatible catalogs, profile selection and lazy clip loading. [Actor presentation](../src/session/actors.ts) owns verified track binding, transitions, gait phase and animation playback. [Encounter simulation](../src/gameplay/encounter.ts) owns action locks, hit resolution, immunity and projectiles. [The coordinator](../src/session/session.ts) owns transactional equipment preparation and cancellation across menus, travel and reset.

Directional weights use actual collision-resolved displacement relative to cursor-facing yaw. Directional loops share a normalized gait phase; playback advances from actual speed and the selected stride calibration. Starts, stops and reversals ease without running continuously into a wall. The shield movement layer retains the blocking upper body while walking legs follow directional travel. Scheduled gait actions fade out even though their manually phased playback rate is zero, so contact poses fully replace locomotion. All available fingers are retargeted, including the previously omitted ring and little fingers. Staff combines a steady Mixamo carrying arm/finger grip with its free-arm cast; the Shield grip faces forward in the block pose.

Attack, ability, dodge and weapon-swap requests can occupy one pending slot for 150 ms. The most recent request replaces the previous one and can start when the existing action/cooldown permits it. Buffering does not change committed attack facing or extend dodge immunity. An available dodge now cancels player attack preparation/recovery immediately; spending follows the [commitment rules](EQUIPMENT.md#sword-and-bow-mastery). Menus, death, travel, reset and input clearing discard pending commands. Dodge preserves its 2.4 m distance, 0.45 s duration, 0.25 s immunity and one-second cooldown.

## Equipment and harvesting flows

New characters start with an equipped Axe; migration preserves existing equipment and progress. The clearing camp chest opens independently of enemies and offers its [authored equipment rewards](EQUIPMENT.md#guaranteed-discoveries-and-persistence) until claimed on collection, alongside renewing scroll/potion rewards. Inventory with **B** shows both weapon sets and supplies; Skills with **K** shows derived proficiency/gathering levels; the repaired shelter opens the paired Stash. Equipment and prepared motions commit together; failed preparation retains the working loadout. Equipping Bow or Staff clears that set's off-hand slot and returns its Shield to the bag only if it fits. Empty hands disable weapon attacks. Previewing lab equipment does not mutate these saves.

Attack abilities commit aim when accepted. The default **left click** slot starts with Axe Basic; Skills can change that assignment. Clicking the visible enemy body picks its centre; free-space clicks retain ground aim. Loot and world-object clicks take priority over the assigned ability. Bow preparation starts at the raised draw pose rather than lowering an already aimed bow. Axe and Sword resolve melee contacts; Bow and Staff release a projectile at their marker, with swept travel, terrain obstruction and one damage application per enemy. Basic attacks remain available at home and after victory so new weapons can be inspected. Weapon changes preserve enemy and reward state.

**Hold the assigned Shield Basic input** with a Shield to block toward the cursor. Blocking halves movement speed and incoming damage in the frontal 120-degree arc, prevents attacks, and ends on release or dodge. Rear hits retain full post-armor damage; ordinary enemy hits do not interrupt player actions or held defense. **Shift** dodges in held movement direction or, while stationary, the latest aim direction.

Contextual left-click gathering repeats Axe Chop or Pickaxe Mine with temporary tool attachments, regardless of combat equipment. Pickaxe Mine uses the retained downward Axe strike source baked to Erika with its own cooked duration and contact marker. Gathering profiles bypass the Staff carrying-arm modification. Each valid contact drops a resource; collected quantities award XP once. Three starting contacts deplete a node. See [gathering and shelter](GATHERING.md) for selection, cancellation, renewal and progression.

Axe effective damage grants two base Axe Combat XP per newly reached enemy health point independently of Woodcutting, with the shared Rested multiplier. Gathering levels, Rested, shared regenerating mana and the starter Sword/Bow Skills are implemented; Sword/Bow mastery, Onslaught and earned Ultimates are implemented; stamina and ammunition consumption remain deferred. See [weapon mastery](EQUIPMENT.md#sword-and-bow-mastery). Damage and projectile range derive from equipped weapons, accepted ability definitions and mastery; see [combat values](EQUIPMENT.md#combat-values). Ability costs and cooldowns belong to [`abilities.ts`](../src/gameplay/abilities.ts); see [starter Skills](#starter-skills-and-gathering-presentation) for their motions.

## Solo caster

The placement observations below record the earlier 100-health encounter; current ordinary enemies have 200 health and chest access is independent of enemy defeat.

The caster in Forest Clearing’s separate woodland glade uses its own instance of the Goblin rig with a Staff. Its free-arm Mixamo cast is independently baked from the verified casting source, with a 1.6-second action and 0.8-second release marker. The staff arm retains the compatible carrying pose and a grip clip baked to Goblin, rather than borrowing Paladin tracks. The camp raider remains present with its existing Axe profile. Gameplay loads each enemy’s compatible equipment profile directly.

The native WebGPU placement review on macOS used normal graphics settings in one managed session. Neither enemy engaged at the player start. Walking off the approach into the caster glade activated only the caster; a forward dodge and two aimed attacks defeated it with full player health while the camp guard stayed idle at 100 health. The caster's own health bar followed its body, and a fern was moved off the approach after visual inspection. Focused simulation checks cover independent aggro, per-frame player clocks, damage targeting, guard-specific chest access, per-enemy rewards and both enemy snapshots through travel. This is targeted acceptance, not cross-platform validation.

## Animation viewer

The development route `/?lab=animations` defaults to one nearly full-window character. **Preview A/B** switches the active character; **Compare A / B** restores side-by-side inspection. The right inspector contains rig, equipment, search, clip and contact/release controls; **Controls** collapses it. Playback, speed, frame step, view and scrubbing remain at the bottom. **Fullscreen** expands the viewer and **Fit character** frames the current character and equipment.

Drag to orbit, right-drag to pan and scroll for close inspection. Space toggles playback when focus is outside form controls. Single-view scrubbing uses the active clip's duration. Matched cycle lengths apply only in comparison mode; A and B retain their prepared clips and independent temporal histories when switching views.

The viewer uses the same native WebGPU/FSR pipeline and shared Golden lighting. Inspection disables lens blur and bloom, without changing saved gameplay graphics preferences. The optional **Player lantern** uses the gameplay belt attachment and owner-bounce recipe, follows the selected rig and changes no save data. Gathering previews use the gameplay temporary Axe/Pickaxe attachments and do not overwrite the Staff arm pose during chopping/mining. Hidden lanes retain their comparison state and are resized before rendering again.

Erika Archer is the prototype player appearance, with her authored outfit and compatible player profiles. Her separated authored quiver is visible only with a committed Bow-family loadout. See [protagonist preparation and acceptance](PROTAGONISTS.md).

## Comparison and acceptance

Open the [animation comparison route](../src/labs/animations/animation-lab.ts) on the development server with `/?lab=animations`. Each lane selects its own Player/Goblin rig and weapon model, browses that rig's compatible clips, and retains independent temporal history in the shared native WebGPU pipeline. Use normal/half/quarter speed, frame steps, linked cycle lengths, scrub, and the contact/release marker to inspect hand placement and timing. Goblin has Axe and Staff gameplay profiles; Staff supplies the separate caster fight in the normal clearing. Other lab equipment models do not imply weapon-specific Goblin gameplay motions.

Paused previews retain their pose and stop scheduling frames after temporal history and camera damping settle. Orbiting, resizing, scrubbing, frame steps and selection changes wake the preview; Play resumes from the retained pose. Hidden lab windows stop rendering and resume without advancing through the time spent hidden.

Inspect one affected action/transition in a normal-settings preview and use the change-aware sanity gate. Broaden playable/catalog validation only for changed preparation or a requested audit. Checks do not establish other-platform performance or visual quality.

Remaining art limits: Bow mesh/string deformation and nocking are not authored yet; retargeting has no runtime hand/foot IK; Staff locomotion shares the Axe directional family with a steady carrying arm. Future weapon-specific hit/death/roll refinements should use the retained source catalog and actual gameplay-scale comparisons rather than generic clip titles.

## Starter Skills and gathering presentation

Sword/Bow actions use selected compatible clips baked independently to the current player rig. Recipes, trims, blend intervals and contact/release markers belong to [motion profiles](../assets/motion-profiles.json); the runtime loads selected compatible families rather than the full private source catalog. The comparison lab's Skills filter supports source audition.

The action bar activates the compatible equipped set automatically. Action locks, costs, cooldowns, hit arcs and projectile range come from [ability definitions](../src/gameplay/abilities.ts) and [weapon mastery](EQUIPMENT.md#sword-and-bow-mastery). Motions do not grant invulnerability or change simulation outcomes.

Click-to-harvest presents the temporary Axe/Pickaxe and compatible gathering motion regardless of the equipped weapon. Owned equipment and the active combat set remain unchanged; interruption restores their presentation.

## Ultimate motion and Synty effects study

Open `/?lab=animations&study=ultimates` in an owned development preview. This is a development-only complete-sequence review on the actual Forest Clearing ground with three practice Goblins, the current player, gameplay's camera/graphics settings, and the shared Golden lighting/pipeline. It changes no character saves or rewards; its rain presentation is shared with gameplay.

The current study keeps **Rain of Arrows** and reviews **Executioner's Strike** with optional Shield; Crescent Wave is set aside, no longer offered, and its motion is no longer loaded. Replay, pause, slow playback or scrub the sequence. Effects Off isolates character motion and practice reactions. Sound follows the existing mix and can be muted locally; seeking stays silent. Close view supports contact inspection; Gameplay view restores the saved distance. A sequence includes its effect tail and a quiet interval before looping. Hidden views suspend rendering and playback without catch-up.

Arrow Rain shares the adopted skyward variant of the compatible joined Mixamo bow draw/release. The arms raise together toward a 58-degree skyward aim, using sampled two-bone arm poses without stretching the skeleton; the head follows the aim and the original footwork remains intact. A brief held draw leads to release at 0.93 seconds, followed by lowering through the 1.5-second motion. Gameplay's Piercing Shot clip remains unchanged.

One Synty arrow follows the draw hand and bow rest while nocked. Its release position and direction are captured from the release pose, so forward/backward seeking and replay reproduce the same flight even after the character lowers the bow. A short restrained trail accompanies the ascending arrow. The projected target footprint appears after release as a faint, uneven brown perimeter with soft edges and no filled centre; staggered falling arrows, local impact sparks/dust, spaced practice hit reactions and briefly embedded shafts retain the landing treatment. The sequence lasts 4.8 seconds. Rain choreography is shared with gameplay; damage pulses remain simulation-owned. Its numeric balance remains provisional. Bow/string deformation remains a future authored-art refinement.

Synty supplies the dust and ground-break textures, spark mesh and arrows. Plume 0.1.1 owns the dust/spark particle systems and curves; TSLFX 0.6.0 supplies projected impact rings. Lantern owns ability choreography, ground receivers and complete-sequence clocks. The earlier partial Unity particle-module replay was removed; the normal animation lab retains its existing motion inspection. Effects project only onto the actual ground receiver, use node materials, and remain in the single shared visual pipeline. No gameplay weapon trail or separate rendering graph is introduced.

The design references are Blizzard's [animated damage-area demonstration](https://www.youtube.com/watch?v=3BnHvNZ_4YM), [VFX hierarchy and combat timing](https://news.blizzard.com/en-gb/article/23746639/diablo-iv-quarterly-updatedecember-2021#DanielBriggs), and GGG's [Ranger showcase](https://www.youtube.com/watch?v=iw870QM1V5k), including Rain of Arrows around 8:52. Ground footprint, travel, impacts and aftermath are reviewed together at gameplay scale.

Prepare the private art as described in [asset preparation](ASSET_PREPARATION.md#ultimate-study-assets). Unused comparison motions and particle-study art stay outside build staging. The adopted Rain motion, dust/spark recipe and its two private dependencies have explicit gameplay references; see [Ultimate study assets](ASSET_PREPARATION.md#ultimate-study-assets). The [library-trial contract](LIBRARY_TRIALS.md#ultimate-vfx-library-trial) owns the peer override, native-only preparation, lifecycle and upgrade limitations.

### Sword/Bow action preparation

The manifest now prepares Thrust, Executioner's Strike and Onslaught for both Sword loadouts; Riposte uses the compatible Sword attack for its triggered counter and a held blade-preparation pose for its stance. The first Executioner Power Slash candidate lifted the feet and was rejected. The adopted Overhead Bashing Swing source retains planted feet, with the contact reviewed at 0.74 seconds in its 1.05-second cooked action. Bow reuses its Basic shot for Poison/Multishot, shares the authored skyward Rain clip with the lab and extends the joined draw for Deadeye. Onslaught contacts were refined to 0.31/0.69/1.11 seconds after the actual-rig review, retaining its 1.25-second action. Every prepared role supplies explicit contact markers; pose playback follows the snapshotted attack rate.

## Axe Skill and Berserking motions

Crushing Blow independently bakes **Downward Attack With Axe** (`50032fca84ef`) to Erika rather than using the gathering action at runtime. Its 0.15–2.05-second source interval is cooked toward 0.95 seconds, with reviewed contact at 0.38 seconds. Berserking independently bakes **Battlecry With Axe** (`cc64b1879065`), using its 0.5–1.6-second source interval cooked to 0.5 seconds. Both belong to the Axe and Axe + Shield profiles and the lab's Skills filter. Attack-rate bonuses drive Crushing Blow playback/contact together; the battle cry keeps its authored rate.


## Axe Double Strike candidates

Two local Mixamo **Two Hit Combo Attack With Axe** sources were baked to Erika for the [Axe mastery design](EQUIPMENT.md#axe-mastery-design-in-progress). Ver. 3 (`8592ac65ac9f`) lasts 2.73 seconds at source timing; Ver. 1 (`6a6969484303`) lasts 4.67 seconds. Ver. 3 is the recommended candidate for compact pressure. Ver. 1 has a long overhead preparation with more off-hand involvement; its equipped Shield visibly crosses the Axe's path. The shorter candidate still needs combat-scale contact and transition refinement before adoption.

The manifest retains both source-timed clips and `axe-double-strike-review`: Ver. 3's 0.25–2.35-second interval cooked toward 1.05 seconds (1.05 seconds at 60 fps). This is a timing trial, with no approved hit markers or gameplay assignment. In `/?lab=animations`, choose **All motions**, search **Axe Double Strike**, then compare the source variants or select the timing trial with Axe and Axe + Shield. The lab reads the separate per-rig `study.json` without modifying the shared gameplay catalog. These comparison clips remain outside the gameplay build dependency closure.
