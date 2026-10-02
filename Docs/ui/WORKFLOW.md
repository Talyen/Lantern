# UI design workflow

This extends [the daily task workflow](../DEVELOPMENT.md); it does not add a second approval system, benchmark requirement or full local test gate. Read [the design system](../UI_DESIGN.md), [art workflow](../ART_DIRECTION.md#agent-visual-workflow), the affected runtime owner and its consumers before editing. One agent owns a task through local integration.

**Current authorization: implement the chosen Inventory/stash design and continue asking guiding questions as they arise.** Sections 3–4 apply to that work. The earlier design-only hold was lifted explicitly by the owner after concept review; other screen families still follow design exploration.

Design from first principles. Do not carry forward rough prototype elements/flows by default. Ask guiding questions with recommendations at each consequential design step; use answers to direct layout/hierarchy exploration. Source owners inform available data and eventual integration, while existing UI organization remains replaceable.

## 1. Write the screen brief

Use the [brief template](SCREEN_BRIEF_TEMPLATE.md). Record the player goal, entry/exit, information hierarchy, useful content, relevant states, input and layout targets. Identify current behavior versus proposed UX behavior. Link the model for available data and explain proposed rule changes; do not preserve unrelated prototype content or invent mechanics to make a mockup attractive.

State the intended visible effect in working commentary. Update the [screen catalog](SCREEN_CATALOG.md) as work advances. A major screen needs a layout concept; related primitives can share a component sheet. A small refinement does not require new ImageGen output or a ceremony.

## 2. Explore with original mockups

For an unresolved direction, produce multiple intentionally distinct treatments of **the same screen, content and state**. Hold the player goal constant so differences can be judged. Name the variable being compared: material weight, organization, hierarchy or composition. Explore genuinely different layout families; avoid repeating the same layout with cosmetic variations when organization is the question. Continue layout/hierarchy, responsive and interaction-storyboard rounds before consolidation, according to the owner's requested design phase. Major screens receive layout studies; shared components receive coordinated family sheets.

Use the built-in ImageGen tool and original text descriptions by default. Never submit Synty/Mixamo models, textures, renders or private gameplay screenshots. An original generated UI-only image may be referenced in later ImageGen work after inspection. Study licensed captures locally and retain them privately; describe observations in text if needed.

Save retained concepts under `Docs/ui/concepts/<screen-or-round>/`, outside `public/` and runtime imports. Save exact prompts and provenance beside them: date, tool, inputs, output filename, SHA-256, purpose/status and critique. Retain selected/reference candidates without copying private art into tracked documentation. Production original UI assets belong beside their consuming asset owner, with provenance and explicit references; concepts are not shipped textures.

### Reusable prompt structure

```text
Use case: ui-mockup
Asset type: Lantern [screen/component] direction or layout concept
Player goal and state: [specific task, hover/focus/carry and availability]
Identity: warm crafted fantasy, restrained ornament, iron/brass/smoky glass,
          quiet opaque reading surfaces, ivory text, amber action emphasis
Viewport and composition: [target; regions; focal point; protected play area]
Content: [real names, exact slots/footprints, labels, values and actions]
Typography and states: [heading/reading roles; hovered/focused/carried cues]
Variable being explored: [one explicit change]
Constraints: original text-only artwork; no invented mechanics, brands, lore,
             licensed art, flattened production text, or pervasive glow
```

Critique at the intended use size: first focus, task clarity, density, material coherence and weakest detail. Record useful elements, rejected elements and generated inaccuracies. Exact grid cells, typography, text, item statistics, affordances and responsiveness remain implementation work. Attractive generated buttons do not prove available actions. Do not repeatedly regenerate a near-identical image to solve a problem better answered in HTML/CSS.

## 3. Make the design functional

The owner authorized this phase for Inventory/stash. Keep later screen implementation within its own requested scope.

Translate the chosen first-principles design into the DOM UI. Keep text, hit areas, focus, responsive layout and state chrome in code; use raster art only for appropriate visual surfaces/icons. Implement the documented chosen interaction rather than retaining unintended prototype behavior. Preserve mutation/data safety and document required model changes. All 3D routes continue using the shared native WebGPU pipeline.

The first implementation uses the actual Inventory/stash components and original atlas, reviewed with representative data in an isolated owned browser profile. A separate specimen route is optional when it answers a concrete design question; do not build a parallel demo or expose fixture/save controls in production navigation.

Start with shell, type/spacing/color roles, buttons, focus/hover, item slots, useful tooltips and direct actions. Extract shared code/CSS once a second concrete consumer needs it. Prefer one canonical token definition and small explicit functions/classes to a generic UI engine. Update the design system with the resulting code owner and actual values; delete superseded per-screen overrides only within the migration's scope.

Complete ordinary, hovered, focused, carried, unavailable and pending/error behavior relevant to the task. Persistent selection only applies to components that actually require it; Inventory has no selected-item inspector. Long labels, empty/full containers and invalid destinations matter where owned. Display real mutation results. Busy styling must reflect the owner's state and cannot manufacture success.

## 4. Inspect and refine

After player-facing gameplay edits, use one owned normal-settings preview through `npm run agent:dev -- --browser`. Inspect at gameplay scale and exercise one short relevant interaction. Leave the user's session alone. If using browser automation, follow the installed browser skill; automated Electron remains hidden/non-focusable with CDP.

Pick the acceptance target that answers this task: e.g. select/compare/equip an item, transfer one stack, assign one Skill or change one setting. Inspect the relevant responsive/input case when changing that behavior. The screen's design targets are a coverage record across migrations, not instructions to run every size/state/platform on every task. Wider inspection requires a concrete uncertainty or failure. Never schedule full suites or performance measurements as routine design acceptance.

Evaluate:

- The primary information/action is obvious and belongs to the selected context.
- Type, spacing, surfaces, icon treatment, interaction states and motion are coherent.
- Focus/selection remain visible; controls can be reached and dismissed; UI clicks do not trigger play.
- Relevant content fits/reflows, critical actions remain reachable, and state is not communicated only by color/sound.
- Feedback is immediate, truthful and recoverable; existing player data and settings policies survive.

Identify and refine the weakest visible part before handoff. Local screenshots containing licensed game art remain under ignored `.local/`; a short text note is normally enough. An image or passing check cannot establish visual quality. Record hardware/input/accessibility limits without claiming untested support.

## 5. Integrate and maintain

Review only the intended task diff and links/provenance. Documentation/concept tasks need no gameplay preview. `agent:finish` runs `npm run check` on its integration candidate; do not duplicate an unchanged gate. Stage only reviewed paths, repair genuine failures/conflicts, finish local integration and clean the completed worktree through the daily workflow. Pushes, PRs and releases still require the owner's request.

Update the catalog status to concept, specified, implemented or inspected based on actual evidence. Record the adopted decision, source/component owners, interaction inspected and material limits. Shared-system changes update [UI_DESIGN](../UI_DESIGN.md); gameplay changes update the existing canonical gameplay/runtime owner too. Do not mark an entire screen complete because its main state looks good while required interactions are outstanding.

Across the rollout, record short unfamiliar-player observations: what they tried, where they hesitated, what happened and the resulting change. Observe discoverability, equip/compare confidence, action readiness and returning to play. This complements visual review; it is not a benchmark, numerical quality score or default automated test suite.
