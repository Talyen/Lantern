# Combat and equipment

Lantern uses fixed authored equipment. [The catalog](../src/gameplay/equipment.ts) owns item identities, slots, bag footprints and bonuses; [combat stats](../src/gameplay/combat-stats.ts) derives effective properties from equipped items. Inventory and stash copies have persistent instance IDs. There are no generated properties, rarity tiers, equipment proficiency gates, critical hits or elemental resistances.

Bow and Yew Longbow share the calibrated left-hand grip. Their authored YZ plane contains the shooting direction, with the curve ahead of the string; the generic one-handed grip previously turned the bows sideways. The correction applies to gameplay and both animation labs, without changing model pivots or motion keyframes.

## Shared slots and weapon sets

Helmet, Body, Gloves, Boots, left Ring, right Ring, Amulet and Belt are shared across both sets. Main hand and Off hand belong to set I or II; only the active set contributes. Swords and Axes support a Shield; Bows and Staffs use both hands. Items in the bag, stash and recovery overflow provide no bonuses.

Inventory’s toolbar icons show each set’s main-hand glyph with an I/II badge and both view and activate that prepared set. Right-click bag gear to equip, equipped gear to unequip, or drag onto an explicit receptacle. Rings fill an empty slot first, otherwise replace Left; drag chooses Right without a choice panel. Displaced gear returns to the vacated bag cells when it fits, otherwise another free position. A failed candidate or asset/motion preparation retains the original state. Editing equipment remains blocked during combat/actions; prepared-set activation follows action readiness rather than the equipment-edit combat restriction.

Hover/focus tooltips show the item name and useful fixed properties, without automatic comparisons, redundant category labels or enlarged art. The same painted item uses identical dimensions in bag, equipment and carry; [the art owner](../src/ui/inventory-art.ts) defines them. Ground labels remain separate. Shared armor/accessory art does not recolor or replace the Erika model; hand models remain private and compatible motions follow weapon family.

Catalog membership and weapon checks belong to `isItemId` and `isWeaponItem` in [equipment](../src/gameplay/equipment.ts). The catalog type requires combat values for every weapon identity and constrains hand slots; inventory validation and save decoding use these same checks before indexing catalog data.

## Combat values

Base health and mana are 100, mana recovery is 8 per active second, and movement speed is 3.2 m/s. Current ordinary Goblin and Skeleton enemies have 200 health and deal 20 direct damage. Values are prototype tuning, not final balance.

| Weapon | Basic damage | Attack rate | Reach / range |
| --- | ---: | ---: | ---: |
| Axe | 50 | 1.00 | 1.95 m |
| Sword | 50 | 1.00 | 1.95 m |
| Iron Broadsword | 70 | 0.80 | 2.20 m |
| Bow | 45 | 1.00 | 12 m |
| Yew Longbow | 60 | 0.85 | 16 m |
| Staff | 50 | 1.00 | 12 m |

Sweep and Piercing Shot deal 120% of equipped weapon damage. Their existing mana costs and separate cooldowns remain unchanged. Shield Basic halves a successfully blocked frontal hit; it supplies no passive armor.

| Shared equipment | Fixed benefit |
| --- | --- |
| Guard Helm | +8 armor |
| Weathered Mail | +12 armor |
| Quilted Coat | +20 mana capacity, +2 mana recovery/s |
| Duelist Gloves | +8% attack rate |
| Trail Boots | +5% movement speed |
| Iron Signet | +10% damage |
| Hearth Ring | +15 health capacity |
| Amber Amulet | +20 mana capacity |
| Leather Belt | +10 health capacity |

Bonuses to the same property add. Damage is weapon damage times one plus total damage bonus; attack rate is weapon rate times one plus total attack-rate bonus; movement speed follows the same rule. Health, mana, armor and mana recovery bonuses add to their base values.

All direct hits, including melee, arrows and magic, apply `raw damage × 100 / (100 + armor)`. A successful frontal block then halves that result. Blocking is an explicit fact independent of armor, and rear hits remain damaging without interrupting the player. Simulation retains fractional damage; displays round values only for readability.

Accepted attacks snapshot damage, reach/range, duration and contact markers. Duration and markers divide by effective attack rate, and the same rate drives attack animation playback. Released projectiles retain their launch damage and range after a swap. Armor uses the target's current equipped state when contact occurs. Enemy interruption remains attack-specific; player hits do not interrupt attacks or held defenses. Dodge and terrain collision retain their existing values.

Equipment changes never refill health or mana. Preserve current amounts and clamp them when a maximum falls. Potions still restore 40 health with an eight-second cooldown; safe fires restore 3% of effective maximum health per second. Travel preserves current resources and cooldowns. Death recovery restores effective maximum health; application relaunch starts with effective maximum health and mana. After eight active-play seconds clear of combat, passive recovery restores 0.5% of effective maximum health per second. Engaged/returning enemies, hostile projectiles and confirmed combat impacts restart that delay. Travel preserves it; menus/loading/background time do not advance it. Safe-fire recovery takes precedence at 3% per second rather than stacking with passive recovery.

## Guaranteed discoveries and persistence

Reward equipment lists belong to the [clearing area](../src/levels/areas/clearing.json), not hard-coded chest behavior.

| Source | Equipment |
| --- | --- |
| Camp chest | Sword, Shield, Bow, Staff, Guard Helm, Weathered Mail, Duelist Gloves |
| Caster defeat | Iron Broadsword, Yew Longbow, Amber Amulet |
| Trail cache near the approach's mineral stops | Quilted Coat, Trail Boots, Leather Belt |
| Optional woodland cache east of the approach | Iron Signet, Hearth Ring |

The camp chest gives two Scrolls of Return and two Health Potions per opening, with individual active-play renewal. Current enemy scroll chances remain unchanged. All chests, including equipment-only caches, open independently of enemies; guard metadata is removed. Ground objects use the same [pickup and retention rules](LOOT.md).

Ordinary enemies also have a 15% chance per life to drop one equipment identity from their area-authored `equipmentDrops` pool. Pools reuse existing fixed catalog items; every listed item has equal selection weight. These repeatable drops carry no discovery claim, can be sold, and remain eligible after a guaranteed copy has been claimed. Successful and failed rolls are retained with the enemy life in the saved outing; only renewal permits another roll.

Claims become permanent only on successful collection. Uncollected rewards survive travel, death and relaunch in the saved outing, expiring when their source renews. Guaranteed rewards on renewal offer only equipment that remains unclaimed. Collected guaranteed rewards do not duplicate after relaunch, dropping, selling or source renewal. Each catalog identity currently has one guaranteed source. The legacy serialized name `campClaims` is retained for compatibility and now covers every guaranteed equipment discovery.

The [current character save](RUNTIME.md#save-recovery) retains `lantern.character.v1` and backup recovery. Migration preserves item IDs, placements, sets, stash, skill progress, restoration, Rested and earlier claims; older characters initialize new shared slots empty. Stats are derived and never saved as a second source of truth.

## Focused acceptance

Use one owned normal-settings preview and one relevant gear interaction. Inspect hover properties, right-click equip/unequip, explicit ring dragging, truthful set activation and unchanged resources as appropriate to the change. Refine a visible weakness in the same session; do not run the full combat/reward flow on every UI task.

Existing encounter/adventure tests protect armor versus blocking, contact/recovery scaling, projectile snapshots, shared-slot validation/displacement, claims and save migration. Finish with the normal [task handoff](DEVELOPMENT.md#working-alongside-other-agents); full suites remain CI-first. Smithing and worn-armor art remain subsequent roadmap work; Sword/Bow mastery is described below.

## Sword and Bow mastery

Sword/Bow progression now lives in [skills](../src/gameplay/skills.ts), [abilities](../src/gameplay/abilities.ts) and [mastery](../src/gameplay/mastery.ts). Level, unlocks and passives derive from saved XP; weapons require no proficiency to equip. New characters retain the integrated Axe Basic and Crushing Blow start. The Sword/Bow starter Skill choices are Sweep and Multishot.

| Level | Sword | Bow |
| --- | --- | --- |
| 1 | Sword Basic; Sweep | Bow Basic; Multishot |
| 3 | Thrust | Poison Arrow |
| 5 | Executioner's Strike | Rain of Arrows |
| 15 | Riposte | Piercing Shot |
| 50 | Onslaught | Deadeye Shot |

The twelve actions can share any six slots. Earned actions fill the first empty slot without replacement; a full bar leaves them available in Skills. Assignments require safe conditions. Locked actions remain inspectable. No skill points or separate saved unlock list exists.

New abilities use the following initial tuning:

- Thrust: 130% weapon damage, narrow single target and +0.45 m reach.
- Riposte: a 0.75-second stance that prevents one frontal melee hit and counters its attacker for 200% damage if still within reach. No Shield is required. Rear, arrow and magical hits remain damaging. Base cost is 20 mana with a six-second cooldown, committed on the prevented hit; an unused stance expires free.
- Executioner's Strike: 350% weapon damage to one target. Existing protected raider attacks are explicitly breakable; protected attacks opt out through `EnemyState.interruption`, while designated heavy windows permit the cut. Its reviewed planted overhead source uses a 1.05-second action and 0.74-second contact, before attack-rate scaling.
- Onslaught: three frontal cuts for 100%, 150% and 200% damage. Dodge stops remaining cuts without refunding the first committed cut.
- Poison Arrow: Basic shot timing, 60% immediate damage and 80% damage over four seconds. One Poison effect ticks every 0.5 seconds. Reapplication refreshes duration, replaces the damage snapshot and retains the next tick. Poison does not cause repeated flinches, hit pause or hurt sounds. No poison resistance system is introduced.
- Multishot: five arrows over 60 degrees, 80% damage each, with at most one damaging arrow per enemy per use. Base cost is 25 mana with a five-second cooldown.
- Rain of Arrows: cursor ground targeting within Bow range, approximately 2.2 m radius and three pulses totaling 300% weapon damage. Invalid or blocked targets spend nothing. Its existing skyward release, falling arrows, footprint and aftermath remain the same indoors and outdoors. Particle count never decides damage.
- Deadeye Shot: one manually aimed non-piercing arrow for 500% weapon damage, with a 1.4-second action and release at 1.05 seconds before attack-rate scaling.

Every Sword/Bow Ultimate costs 50 mana and starts the one shared Ultimate timer at 30 seconds across both sets and repeated assignments. Berserking retains its separately selected 60-second duration in that same readiness pool. Other Skills retain independent cooldowns. Preparation quotes costs but spends them only at the first swing/release, including a miss. Dodge before that moment is free. Dodge after commitment gives no refund; released projectiles and rain continue. Basic cadence is retained. Enemy hits no longer interrupt player attacks, movement or held defense; damage, armor, frontal Shield reduction and post-hit immunity remain. Death still ends actions.

### Effective damage and passive benefits

Each enemy life retains its lowest reached health through session travel and death. One base XP is awarded per point of damage pushing health below that minimum, attributed to the originating Sword/Bow action even after a swap. Overkill and restored damage earn nothing. Rested applies its existing multiplier. The concurrently integrated finite Axe credit and its 0.2 scale remain intact; gathering progression is unchanged. Application relaunch preserves the outing and finite reward budgets; the developer Restart command deliberately creates a fresh outing. Renewal uses active-play time, so closed-app time does not advance it.

Combat XP thresholds are level 1/0, 2/100, 3/250, 4/500, 5/1000, 15/5000 and 50/24000, with interpolation between anchors and the final slope continuing beyond level 50. The first Ultimate targets roughly five ordinary enemy lives of dedicated use; 3–5-hour full mastery and pre-boss practice remain provisional until the adventure is expanded and observed.

| Level | Sword passive | Bow passive |
| --- | --- | --- |
| 2 | Honed Edge I: +3% damage | Steady Aim I: +3% damage |
| 4 | Measured Cuts I: +2% attack rate | Smooth Draw I: +2% attack rate |
| 7 | Long Reach I: +0.10 m reach | Long Shot I: +1 m range |
| 10 | Economy I: −5% Skill mana | Economy I: −5% Skill mana |
| 20 | Heavy Hand: +5% Executioner's Strike damage | Arrowstorm: +5% Rain damage |
| 25 | Honed Edge II: +3% damage | Steady Aim II: +3% damage |
| 30 | Measured Cuts II: +2% attack rate | Smooth Draw II: +2% attack rate |
| 35 | Long Reach II: +0.10 m reach | Long Shot II: +1 m range |
| 40 | Economy II: −5% Skill mana | Economy II: −5% Skill mana |
| 50 | Relentless: +5% Onslaught damage | Deadeye Mastery: +5% Deadeye damage |

Bonuses affect their weapon's actions, not global character power. Like damage bonuses add alongside equipment bonuses, attack-rate bonuses add, reach/range bonuses add and Skill discounts total 10%; Ultimates receive no discount. Accepted attacks snapshot those benefits, costs, damage, timing and range. Already released projectiles, Poison and rain retain their originating snapshots.

## Axe abilities and proficiency

New characters retain the Axe Basic on LMB and begin with Crushing Blow on Q. Existing saves retain their action assignments. Crushing Blow deals 200% of equipped Axe damage to the nearest reachable target in a 60-degree frontal arc at the equipped reach. Its independently baked downward action targets 0.95 seconds with a 0.38-second contact; actual prepared duration owns the lock. It costs 25 mana at its first strike and has a six-second cooldown. It breaks current enemy windups, including the raider's late commitment. Future protected attacks remain protected unless their simulation explicitly opens a heavy-interruption window.

Berserking unlocks at 100 saved Axe Combat XP (level 2). Effective Axe damage awards 0.2 base XP per newly reached health point, with Rested applied once. Each enemy life retains its lowest health through healing, death recovery and area travel; overkill and re-damaging healed health earn no additional credit. Existing saved XP is retained. Crossing the threshold fills the third action slot (default R) only when empty; occupied slots and deliberately cleared saved assignments remain intact. Skills exposes the real requirement and only permits unlocked assignments.

The compatible Axe battle cry lasts 0.5 seconds and remains planted. Ordinary damage does not interrupt this action; death before completion cancels it without mana or cooldown consumption. Completion commits 50 mana and starts the single shared 60-second Ultimate cooldown. For eight active gameplay seconds, the equipped Axe's post-equipment damage, attack rate and movement speed multiply by 1.4, 1.3 and 1.2. Swaps keep the timer running but remove all three benefits while a different weapon is active. Accepted attacks retain their original snapshots; expiry restores base equipment properties, and death ends the buff. Menus/backgrounding pause gameplay clocks; travel preserves the buff and shared cooldown.

The action bar uses distinct Axe motifs, real casting/cooldown states, a compact timed Berserking badge and brief first-opportunity hints with current bindings. The badge dims outside Axe combat. The saved outing retains committed cooldowns across application relaunch; the temporary Berserking effect is not restored. Four independent adventures and title navigation remain front-end roadmap work. Values above are initial tuning rather than final balance.
