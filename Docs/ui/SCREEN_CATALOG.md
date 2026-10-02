# UI screen and component coverage

The [design system](../UI_DESIGN.md) owns visual/interaction rules; [the workflow](WORKFLOW.md) owns how to advance a row. This is a coverage inventory, not a requirement to preserve prototype UI. The owner requested first-principles design and a prolonged design-only phase with guiding questions. Baseline: source inspected October 2, 2026; refresh data owners before future implementation because concurrent tasks can add systems.

Status meanings: **Existing** = current prototype behavior; **Concept** = generated visual study only; **Specified** = resolved brief/layout/states; **Implemented** = integrated presentation; **Inspected** = relevant functional/visual review recorded. A concept does not imply runtime migration.

## Player surfaces

| Surface | Player goal and key states | Current owner | Design coverage / next step |
| --- | --- | --- | --- |
| Inventory / Equipment | Understand loadout and exchange gear; paper doll, spatial bag, name/useful-property hover tooltip, direct item actions; empty/equipped/hover/focus/carry/pending/failure | [adventure UI](../../src/ui/adventure.ts), [markup](../../index.html), [inventory controller](../../src/clearing/inventory.ts) | [Design exploration](concepts/inventory-layouts/README.md): A materials, #1 family, 40% equipment left / 60% bag right, outline empty glyphs; no inspector/selection or prototype build |
| Stash / transfer | Inspect carried/stored items and move quantities; destination/full/partial/hover/carry/busy | Same adventure UI and controller | Prototype operations exist; design storage organization/direct transfer from player goals, shared art scale and useful tooltips |
| Split / carry / placement | Choose quantity and destination; carried/cancel/valid/invalid/outside drop | Same adventure UI; [inventory model](../../src/gameplay/inventory.ts) | Existing; specify alternate operation and nested Escape behavior with Inventory |
| Combat HUD / resources | Read urgent health/mana and readiness without losing combat focus; low/empty/damage/paused | [HUD](../../src/ui/hud.ts), [orb CSS](../../src/ui/orbs.css) | Prototype source; guiding questions and alternative shapes/grouping/hierarchy; no inherited orb arrangement |
| Action bar / weapon swap | Use six assigned abilities, potion/return, identify set/binding; ready/cooldown/unavailable/hold/empty | [combat UI](../../src/ui/combat.ts), [input actions](../../src/input/bindings.ts) | Existing; define distinct state language and readable binding/cooldown treatment |
| Skills / assignment | Understand abilities and assign them when allowed; selected/locked/incompatible/carry/drop/cancel | Same combat UI; [ability model](../../src/gameplay/abilities.ts) | Data/actions exist; design discovery, grouping and assignment afresh with guiding questions |
| Options — Graphics / Sound | Adjust preferences, understand values and recover failed application; change/reset/pending/error | [Options](../../src/ui/options.ts), [Graphics](../GRAPHICS.md), [Audio](../AUDIO.md) | Settings owners define available values/defaults; design organization/controls/application policy with guiding questions |
| Keybindings | Understand/edit inputs and resolve conflicts; capture/clear/defaults/commit/cancel | [Keybindings](../../src/ui/keybindings.ts), input actions | Design grouping, capture feedback and commit/cancel behavior from player needs; don't inherit prototype layout/flow |
| Campfire Travel | Choose discovered safe destination; none/available/enemies nearby/transition failure | Adventure UI; [travel owner](../RUNTIME.md#travel-and-fire-safety) | Existing; compact destination selection and truthful availability |
| Shelter restoration | Understand material requirements and repair; missing/ready/committing/failure/restored | Adventure UI; [Gathering](../GATHERING.md) | Existing; clear cost/available values, one main action, retained-material failure |
| Loot labels / world prompts | Recognize loot/interaction and act; crowded/hover/focus/out of reach/full | [loot UI](../../src/ui/loot.ts), [Loot](../LOOT.md#labels-and-visual-treatment), [interaction actions](../../src/clearing/interaction-actions.ts) | Existing world behavior is context; design cue/identity/direct-action hierarchy through guiding questions |
| Rested / skill progress | Understand active benefit and actual progress; active/expired/changed | Adventure UI; [skills](../../src/gameplay/skills.ts) | Prototype displays exist; choose an appropriate separate context from first principles; exclude gathering/proficiency from Inventory |
| Victory / Defeat / Return Home | Read outcome and available next action; transition/pending/failure | HUD; [clearing](../../src/clearing/clearing.ts) | Existing; restrained outcome treatment and recoverable return flow |
| Startup / loading / asset and graphics errors | Enter play or understand required recovery; preparing/unsupported/missing/failed/retry | [entry](../../src/entry.ts), HUD; [renderer](../../src/rendering/renderer.ts), [save recovery](../RUNTIME.md#save-recovery) | Existing startup/error paths; inventory all actual error presentations before layout work |

## Future and development surfaces

| Surface | Scope | Design plan |
| --- | --- | --- |
| Shop / buy / sell | Roadmap and concurrent gameplay work; refresh actual owner first | First-principles trading layout with shared item scale, useful tooltip/cost/quantity and direct-action patterns; comparison only if deliberately chosen |
| Smithing / recipe / craft | Planned gameplay | Define recipe-known/material/choice/output states with owner; share item/material rows |
| Proficiency / unlocks | Broader progression planned; partial skill display exists | Present real progress/unlock conditions without general character levels |
| Front-end / continue / new adventure | No dedicated player title menu in inspected entry flow | Establish save/session rules first; avoid speculative screens or destructive reset actions |
| Future map/journal/quests | No requirement established by this UI request | Add only after the gameplay roadmap supplies a concrete player goal |
| Level authoring, animation/character labs | Development routes | Share readability/focus primitives as useful; preserve tool workflows and shared native WebGPU pipeline |

## Shared coverage families

Menu shells; primary/secondary/icon/consequential buttons; view switches; labels/values; selects/toggles/sliders; resource/progress meters; binding badges; spatial item/ability cells; paper-doll receptacles; hover/focus tooltips; context prompts; quantity input; carry/placement; inline feedback; confirmation/recovery. Item art retains one scale; Inventory has no persistent selected-item detail region. Each family inherits the [component contracts](../UI_DESIGN.md#shared-component-contracts).

## Review record

Append a concise entry when a screen is inspected: date; surface; integrated revision; intended effect; relevant interaction and viewport/input; refinement made; remaining limits. Private capture paths may be recorded as plain code paths; never embed licensed captures in tracked files. Keep entries bounded and current; older evidence belongs with the task archive rather than a growing mandatory checklist.

October 2, 2026: documentation foundation and original Inventory concepts; owner selected A — Crafted instrument materials, requested multiple organizational directions, and explicitly retained a longer design-only phase. No runtime UI was changed and no prototype was built; functional, responsive, gamepad and accessibility inspection remains outstanding.
