# Skill progression

All 28 Combat, Magic, Gathering and Crafting tracks use one XP curve and level-20 tree conventions. [Skills](../src/gameplay/skills.ts) owns the curve, milestones, reward calculation and Rested multiplier. Levels and unlocks derive from saved XP; there are no skill points or separately saved levels. Only Axe, Sword, Bow, Woodcutting, Mining and Smithing currently earn XP. Other tracks retain truthful planned nodes.

## Curve and tree milestones

| Level | Cumulative XP |
| --- | ---: |
| 1 | 0 |
| 2 | 100 |
| 3 | 250 |
| 4 | 500 |
| 5 | 1,000 |
| 15 | 5,000 |
| 20 | 24,000 |

Interpolate linearly between anchors. After level 20, each level requires another 3,800 XP. Level 20 completes the tree, not the skill's level progression. Skills shows a 5/10/15/20 ruler; its marker stops at the tree's end while the heading keeps the actual level.

Combat/Magic majors follow learning order: Basic I and Skill I at 1, Basic II at 3, Ultimate I at 5, Skill II at 15 and Ultimate II at 20. Gathering/Crafting majors unlock at 1/3/5/10/15/20. Every tree's ten passives/minors use 2/4/6/7/9/11/13/16/18/20. Implemented effects keep their magnitudes; planned positions do not imply implemented effects. Smithing recipes retain independently authored level requirements.

## Awards and transaction ownership

| Activity | Base XP |
| --- | ---: |
| Axe, Sword or Bow effective damage | 2 per credited damage |
| Collected harvested material | 80 × resource level per unit |
| Sword / Shield forged | 250 each |
| Guard Helm forged | 350 |
| Weathered Mail forged | 500 |
| Iron Broadsword forged | 650 |
| Successful reclamation | 20 |

Rested adds 10% once at award time. Preserve fractional XP to six decimal places. Shared pure helpers reject invalid rewards and overflowing totals before publication; unsupported tracks cannot receive gameplay XP. The per-skill XP record and save/slot ownership remain unchanged. No progression conversion is performed: older development snapshots retain raw XP and use the common curve.

Encounter owns finite effective-damage credit and originating weapon attribution, including delayed damage after a swap. Overkill and damage restored by healing cannot replenish an enemy life's budget. Adventure shares learned-action handling across Axe/Sword/Bow: crossing unlocks emits one announcement per earned action, fills the first empty action slot and retains occupied assignments. Closing/reloading does not auto-fill deliberately cleared learned actions.

Gathering awards only the actual harvested quantity successfully collected. Partial pickups leave excess and its XP on the ground; player-dropped or transferred resources have no fresh harvest provenance. Reward preparation happens before collection commits, so rejected XP retains inventory and loot. Smithing publishes resources/output/XP or reclaimed item/returns/XP atomically; previews, cancellation and failed transactions earn nothing. See [gathering](GATHERING.md) and [Smithing](SMITHING.md).

## Initial balance budgets

The target is 3–5 hours of regular use of one skill, including exploration and resource acquisition. Initial rewards are tuning values, not measured playtime guarantees. The unfinished adventure still needs unfamiliar-player observation; no benchmark or recurring measurement is implied.

Without Rested, 24,000 XP equals 60 full 200-health enemy lives, 300 level-1 harvested units, or at least 37 Iron Broadsword crafts (with earlier recipe progression still required). A deterministic highest-learned-recipe craft/reclaim sequence reaches 24,080 XP in 39 pairs without Rested, consuming gross inputs of 150 Iron and 34 Wood before salvage returns. Crafting a full tree requires material acquisition; reclamation remains lossy and cannot sustain an unlimited craft/reclaim loop. A starter Sword craft awards 250 XP, immediately reaching level 3 and teaching the Guard Helm recipe. The current combat areas contain 1,600 enemy health per complete life cycle, worth 3,200 base XP: eight cycles without Rested or seven with uninterrupted Rested. At the existing renewal cadence those final cycles begin after 315 or 270 active minutes respectively, before travel. This incomplete-route budget is at or above the mastery target's upper end; expanding and observing the authored adventure remains necessary.

The current Homestead/Clearing contain five novice Mining deposits, each with three contacts and independent 45-active-minute renewal. A deterministic model collecting each cycle, updating the existing yield formula after collection, reaches level 20 on the sixth cycle: 85 contacts without Rested or 77 with uninterrupted Rested, beginning the final cycle after 225 active minutes. Travel, delayed pickups, missed nodes and interruptions change actual time; refreshing Rested requires a return home. Woodcutting's route stops and Smithing's material/recipe choices require their own outing evaluation. Renewal cadence, recipe costs and gathering duration are unchanged.

## Focused validation

Existing boundary checks protect finite combat credit through healing/travel, partial pickup and re-drop provenance, failed Smithing transactions and loss-making reclamation. Additional XP rejection cases protect collected materials and saved counters; the level-20 boundary protects earned actions and occupied slots. Normal handoff uses the sanity gate and one short owned interaction. Full suites and builds remain CI-first. Checks and arithmetic models do not establish final adventure balance or platform performance.
