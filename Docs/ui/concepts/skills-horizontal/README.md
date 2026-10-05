# Skills — adopted horizontal progression

October 2, 2026. The owner selected the six-step horizontal layout and authorized implementation. This supersedes the earlier upward-tree studies, recoverable from Git history. [Screen/data brief](BRIEF.md) owns the selected structure and implementation scope.

## Locked direction

The composition below records the selected October 2 concept. Current Sword/Bow rows use learning order and a quieter chronological passive row; Axe exposes its three live actions. [The October 3 brief](BRIEF.md#october-3-mastery-implementation) owns those later refinements. Original images and exact prompts remain reference history.

Four category tabs at the top; every skill in the active category visible at once in a bottom icon row; a left-to-right selected tree in between. Combat and Magic have at least two Basics, two Skills, two Ultimates and ten smaller passive nodes. Two passive nodes sit between each adjacent pair of major nodes. Every node has its own icon and hover/focus information.

Gathering and Crafting share the six-major/ten-minor layout but use generic Major/Minor placeholders, not Basic/Skill/Ultimate actions. The selected skill's level ruler sits immediately above the skill row, marking 10, 20, 30, 40 and 50, without an XP bar. One actual action bar stays outside the sheet; drag available actions to it or activate an empty slot for its picker.

### Adopted six-step reference

![Six-step horizontal layout with all fourteen Combat skills](02-six-step-path-final.png)

[Exact final correction](02-six-step-path-final-prompt.md). This has six large and ten small nodes; all fourteen Combat names appear exactly once. Earlier duplicate-label drafts remain in Git history.

## Profession and interaction decisions

Gathering and Crafting use generic Major/Minor placeholders for undefined nodes. The empty-slot picker contains available actual actions and changes only its chosen slot. Rejected layouts and the input/correction chain are recoverable from Git history; the retained exact prompt records input/output hashes. Current unlocks, milestones and assignment behavior belong to the brief and runtime owners.

## Implementation checkpoint

The paragraphs below record the initial October 2 implementation. October 3 Sword/Bow mastery and the Axe kit supersede its placeholder-only progression and pending-inspection statements; [the current brief](BRIEF.md#october-3-mastery-implementation) and [screen catalog](../../SCREEN_CATALOG.md) own today’s behavior and evidence. Exact concepts/prompts remain unchanged.

[SkillsPanel](../../../../src/ui/skills-panel.ts) owns the sheet, category/root navigation, sixteen node controls, tooltips and picker presentation. [CombatUI](../../../../src/ui/combat.ts) owns the one real action bar, hold/drag lifecycle and assignment through Adventure. The bar moves into the modal top layer while remaining visually outside the sheet; empty-slot-only picker mode hides the sheet and pauses gameplay safely.

[Skill definitions](../../../../src/gameplay/skills.ts) own all 28 stable tracks and derived levels. [Node definitions](../../../../src/gameplay/skill-nodes.ts) own six proposed major levels (1, 10, 20, 30, 40, 50) and two intermediate minor targets per gap. Existing actions remain available from the start; proposed targets never lock those actions. Every future node remains planned even after XP crosses its proposed level.

Revision 8 saves all tracks and migrates revisions 1–7, retaining existing Woodcutting, Mining and Axe Combat XP. Axe is its player-facing name; its legacy storage identity remains unchanged. These three tracks retain current XP sources; other tracks are saved placeholders. No new actions, passives, XP sources or bonuses are implemented.

Original concept files retain exact prompts, input/output SHA-256 and built-in ImageGen provenance. Generated art, rough bar geometry, glow, tooltip text and marker positions are composition references; DOM/data owners supply actual behavior. Level 50 is a displayed milestone, not a cap.

Focused validation: all 47 adventure/save tests passed, including revision-7 migration and all-track round trips. The sanity gate passed rendering policy, documentation, types, application/CSS lint and whitespace. The owned normal-settings preview remained queued behind the erika-protagonist GPU lease throughout validation; it was cancelled without touching that session. Actual visual/interaction review is pending, so this is not an inspected-screen or visual-quality claim. Hardware/gamepad/whole-game accessibility acceptance is outside this task.
