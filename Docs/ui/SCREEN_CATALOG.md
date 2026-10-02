# UI screen and component coverage

The [design system](../UI_DESIGN.md) owns visual/interaction rules; [the workflow](WORKFLOW.md) owns how to advance a row. This is a design inventory, not a report of functional defects. Baseline: source inspected October 2, 2026; refresh owners/status before implementation because concurrent tasks can add screens.

Status meanings: **Existing** = current prototype behavior; **Concept** = generated visual study only; **Specified** = resolved brief/layout/states; **Implemented** = integrated presentation; **Inspected** = relevant functional/visual review recorded. A concept does not imply runtime migration.

## Player surfaces

| Surface | Player goal and key states | Current owner | Design coverage / next step |
| --- | --- | --- | --- |
| Inventory / Equipment | Organize, compare, equip; two hand sets and shared slots; empty/selected/equipped/pending/failure/full/overflow | [adventure UI](../../src/ui/adventure.ts), [markup](../../index.html), [inventory controller](../../src/clearing/inventory.ts) | Existing + Concept A/B/C; choose treatment, make compact study and functional slice |
| Stash / transfer | Inspect Bag and Stash, store/take exact quantities; destination/full/partial/selection/busy | Same adventure UI and controller | Existing; reuse Inventory grid/detail, design compact container switch |
| Split / carry / placement | Choose quantity and destination; carried/cancel/valid/invalid/outside drop | Same adventure UI; [inventory model](../../src/gameplay/inventory.ts) | Existing; specify alternate operation and nested Escape behavior with Inventory |
| Combat HUD / resources | Read health/mana, supplies and readiness without losing combat focus; low/empty/damage/paused | [HUD](../../src/ui/hud.ts), [orb CSS](../../src/ui/orbs.css) | Existing; preserve orb identity, establish safe play-space composition |
| Action bar / weapon swap | Use six assigned abilities, potion/return, identify set/binding; ready/cooldown/unavailable/hold/empty | [combat UI](../../src/ui/combat.ts), [input actions](../../src/input/bindings.ts) | Existing; define distinct state language and readable binding/cooldown treatment |
| Skills / assignment | Choose family/ability and assign to slots when allowed; selected/locked/incompatible/carry/drop/cancel | Same combat UI; [ability model](../../src/gameplay/abilities.ts) | Existing; coordinate editor with its real shared action bar |
| Options — Graphics / Sound | Adjust preferences, understand values and recover failed application; live change/reset/pending/error | [Options](../../src/ui/options.ts), [Graphics](../GRAPHICS.md), [Audio](../AUDIO.md) | Existing; migrate shell/control rows, preserve defaults and live application |
| Keybindings | Inspect and edit primary/secondary inputs; capture/conflict/clear/defaults/Apply/Cancel | [Keybindings](../../src/ui/keybindings.ts), input actions | Existing; preserve draft semantics; compact columns and focus/capture clarity |
| Campfire Travel | Choose discovered safe destination; none/available/enemies nearby/transition failure | Adventure UI; [travel owner](../RUNTIME.md#travel-and-fire-safety) | Existing; compact destination selection and truthful availability |
| Shelter restoration | Understand material requirements and repair; missing/ready/committing/failure/restored | Adventure UI; [Gathering](../GATHERING.md) | Existing; clear cost/available values, one main action, retained-material failure |
| Loot labels / world prompts | Recognize/select loot or contextual interaction; crowded/hover/focus/out of reach/full | [loot UI](../../src/ui/loot.ts), [Loot](../LOOT.md#labels-and-visual-treatment), [interaction actions](../../src/clearing/interaction-actions.ts) | Existing; retain name-only labels and useful brief prompts |
| Rested / skill progress | Understand active benefit and actual progress; active/expired/changed | Adventure UI; [skills](../../src/gameplay/skills.ts) | Existing; define compact secondary status/progress treatment |
| Victory / Defeat / Return Home | Read outcome and available next action; transition/pending/failure | HUD; [clearing](../../src/clearing/clearing.ts) | Existing; restrained outcome treatment and recoverable return flow |
| Startup / loading / asset and graphics errors | Enter play or understand required recovery; preparing/unsupported/missing/failed/retry | [entry](../../src/entry.ts), HUD; [renderer](../../src/rendering/renderer.ts), [save recovery](../RUNTIME.md#save-recovery) | Existing startup/error paths; inventory all actual error presentations before layout work |

## Future and development surfaces

| Surface | Scope | Design plan |
| --- | --- | --- |
| Shop / buy / sell | Roadmap and concurrent gameplay work; refresh actual owner first | Reuse item detail, comparison, cost/quantity and pending/error patterns; currency only from real model |
| Smithing / recipe / craft | Planned gameplay | Define recipe-known/material/choice/output states with owner; share item/material rows |
| Proficiency / unlocks | Broader progression planned; partial skill display exists | Present real progress/unlock conditions without general character levels |
| Front-end / continue / new adventure | No dedicated player title menu in inspected entry flow | Establish save/session rules first; avoid speculative screens or destructive reset actions |
| Future map/journal/quests | No requirement established by this UI request | Add only after the gameplay roadmap supplies a concrete player goal |
| Level authoring, animation/character labs | Development routes | Share readability/focus primitives as useful; preserve tool workflows and shared native WebGPU pipeline |

## Shared coverage families

Menu shells; primary/secondary/icon/consequential buttons; view switches; labels/values; selects/toggles/sliders; resource/progress meters; binding badges; item/ability cells; detail/comparison; tooltips/context prompts; quantity input; drag ghost/placement; inline feedback; confirmation/recovery. Start with the families consumed by Inventory and Options. Each family inherits the [component contracts](../UI_DESIGN.md#shared-component-contracts).

## Review record

Append a concise entry when a screen is inspected: date; surface; integrated revision; intended effect; relevant interaction and viewport/input; refinement made; remaining limits. Private capture paths may be recorded as plain code paths; never embed licensed captures in tracked files. Keep entries bounded and current; older evidence belongs with the task archive rather than a growing mandatory checklist.

October 2, 2026: documentation foundation and original Inventory direction concepts only. No runtime UI was changed; functional, responsive, gamepad and accessibility inspection remains outstanding.
