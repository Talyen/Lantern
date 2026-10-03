# Combat and equipment

Lantern uses fixed authored equipment. [The catalog](../src/gameplay/equipment.ts) owns item identities, slots, bag footprints and bonuses; [combat stats](../src/gameplay/combat-stats.ts) derives effective properties from equipped items. Inventory and stash copies have persistent instance IDs. There are no generated properties, rarity tiers, equipment proficiency gates, critical hits or elemental resistances.

Bow and Yew Longbow share the calibrated left-hand grip. Their authored YZ plane contains the shooting direction, with the curve ahead of the string; the generic one-handed grip previously turned the bows sideways. The correction applies to gameplay and both animation labs, without changing model pivots or motion keyframes.

## Shared slots and weapon sets

Helmet, Body, Gloves, Boots, left Ring, right Ring, Amulet and Belt are shared across both sets. Main hand and Off hand belong to set I or II; only the active set contributes. Swords and Axes support a Shield; Bows and Staffs use both hands. Items in the bag, stash and recovery overflow provide no bonuses.

Inventory’s toolbar icons show each set’s main-hand glyph with an I/II badge and both view and activate that prepared set. Right-click bag gear to equip, equipped gear to unequip, or drag onto an explicit receptacle. Rings fill an empty slot first, otherwise replace Left; drag chooses Right without a choice panel. Displaced gear returns to the vacated bag cells when it fits, otherwise another free position. A failed candidate or asset/motion preparation retains the original state. Editing equipment remains blocked during combat/actions; prepared-set activation follows action readiness rather than the equipment-edit combat restriction.

Hover/focus tooltips show the item name and useful fixed properties, without automatic comparisons, redundant category labels or enlarged art. The same painted item uses identical dimensions in bag, equipment and carry; [the art owner](../src/ui/inventory-art.ts) defines them. Ground labels remain separate. Shared armor/accessory art does not recolor or replace the Paladin model; hand models remain private and compatible motions follow weapon family.

Catalog membership and weapon checks belong to `isItemId` and `isWeaponItem` in [equipment](../src/gameplay/equipment.ts). The catalog type requires combat values for every weapon identity and constrains hand slots; inventory validation and save decoding use these same checks before indexing catalog data.

## Combat values

Base health and mana are 100, mana recovery is 8 per active second, and movement speed is 3.2 m/s. Both current enemies have 200 health and deal 20 direct damage. Values are prototype tuning, not final balance.

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

All direct hits, including melee, arrows and magic, apply `raw damage × 100 / (100 + armor)`. A successful frontal block then halves that result. Blocking is an explicit fact independent of armor, so armored rear hits still interrupt normally. Simulation retains fractional damage; displays round values only for readability.

Accepted attacks snapshot damage, reach/range, duration and contact markers. Duration and markers divide by effective attack rate, and the same rate drives attack animation playback. Released projectiles retain their launch damage and range after a swap. Armor uses the target's current equipped state when contact occurs. Existing interruption rules, dodge and terrain collision remain unchanged.

Equipment changes never refill health or mana. Preserve current amounts and clamp them when a maximum falls. Potions still restore 40 health with an eight-second cooldown; safe fires restore 3% of effective maximum health per second. Travel preserves current resources and cooldowns. Death recovery restores effective maximum health; application restart starts with effective maximum health and mana. No passive health regeneration is added here.

## Guaranteed discoveries and persistence

Reward equipment lists belong to the [clearing area](../src/levels/areas/clearing.json), not hard-coded chest behavior.

| Source | Equipment |
| --- | --- |
| Guarded camp chest | Sword, Shield, Bow, Staff, Guard Helm, Weathered Mail, Duelist Gloves |
| Caster defeat | Iron Broadsword, Yew Longbow, Amber Amulet |
| Trail cache near the approach's mineral stops | Quilted Coat, Trail Boots, Leather Belt |
| Optional woodland cache east of the approach | Iron Signet, Hearth Ring |

The camp chest retains two Scrolls of Return and two Health Potions per session. Current enemy scroll chances remain unchanged. Explicit `guard: null` enables unguarded equipment-only caches; omitted guard retains legacy camp-guard behavior. Ground objects use the same [pickup and retention rules](LOOT.md).

Claims become permanent only on successful collection. Uncollected rewards survive travel/death during the session and are offered again after application restart. Collected rewards do not duplicate after restart, dropping, selling in future work or enemy renewal. Each catalog identity currently has one guaranteed source. The legacy serialized name `campClaims` is retained for compatibility and now covers every guaranteed equipment discovery.

Character revision 7 retains `lantern.character.v1` and the existing backup/recovery owner. Revisions 1–6 preserve item IDs, placements, sets, stash, skill progress, restoration, Rested and earlier claims; older characters initialize new shared slots empty. Stats are derived and never saved as a second source of truth.

## Focused acceptance

Use one owned normal-settings preview and one relevant gear interaction. Inspect hover properties, right-click equip/unequip, explicit ring dragging, truthful set activation and unchanged resources as appropriate to the change. Refine a visible weakness in the same session; do not run the full combat/reward flow on every UI task.

Existing encounter/adventure tests protect armor versus blocking, contact/recovery scaling, projectile snapshots, shared-slot validation/displacement, claims and save migration. Finish with the normal [task handoff](DEVELOPMENT.md#working-alongside-other-agents); full suites remain CI-first. Gold, shops, Smithing, proficiency, Ultimates and worn-armor art remain subsequent roadmap work.
