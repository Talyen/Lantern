# Combat and equipment

Lantern uses fixed authored equipment. [The catalog](../src/gameplay/equipment.ts) owns item identities, slots, bag footprints and bonuses; [combat stats](../src/gameplay/combat-stats.ts) derives effective properties from equipped items. Inventory and stash copies have persistent instance IDs. There are no generated properties, rarity tiers, equipment proficiency gates, critical hits or elemental resistances.

## Shared slots and weapon sets

Helmet, Body, Gloves, Boots, left Ring, right Ring, Amulet and Belt are shared across both sets. Main hand and Off hand belong to set I or II; only the active set contributes. Swords and Axes support a Shield; Bows and Staffs use both hands. Items in the bag, stash and recovery overflow provide no bonuses.

Inventory's set tabs edit only hand slots. Drag or select and Equip; rings offer explicit Left Ring/Right Ring destinations, initially choosing the first empty ring slot, then Left. Each ring requires its own item instance. Equipment displacement computes an unpublished candidate; failed bag placement or hand-model/motion preparation leaves the original state intact. Changing equipment remains unavailable during combat or an action.

The selected item shows its fixed properties and the effective-stat changes against its destination. Ground labels retain names only. Shared gear uses distinct icons and small category silhouettes on the ground; it does not replace or recolor the Paladin model. Hand models remain privately prepared Synty assets, with animations selected by compatible weapon family rather than item identity.

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

Character revision 6 retains `lantern.character.v1` and the existing backup/recovery owner. Revisions 1–5 preserve item IDs, placements, sets, stash, skill progress, restoration, Rested and earlier claims; older characters initialize new shared slots empty. Stats are derived and never saved as a second source of truth.

## Focused acceptance

Use one owned preview with normal graphics. Open a cache, collect equipment by label, inspect a comparison, equip it and verify no resource refill. Defeat the guard/caster, collect rewards, equip shared armor and Sword/Shield plus Bow, and use Skills to assign their Basics. Compare a few connected hits, swap sets and verify shared benefits persist. Select ring destinations, inspect the alternate hand models, and reload to confirm equipment and claims survive. Revisit an obvious visual weakness in the same session.

Existing encounter/adventure tests protect armor versus blocking, contact/recovery scaling, projectile snapshots, shared-slot validation/displacement, claims and save migration. Finish with the normal [task handoff](DEVELOPMENT.md#working-alongside-other-agents); full suites remain CI-first. Gold, shops, Smithing, proficiency, Ultimates and worn-armor art remain subsequent roadmap work.
