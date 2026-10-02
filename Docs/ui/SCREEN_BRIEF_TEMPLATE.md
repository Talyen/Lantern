# UI screen brief template

Copy only the relevant sections into a brief beside the screen's concepts or owning documentation. Follow [the workflow](WORKFLOW.md); do not create a formality for a small refinement.

## Scope and status

- Screen/component:
- Status: proposed / concept / specified / implemented / inspected
- Player goal:
- Current source owner and direct consumers:
- Canonical gameplay/data references:
- Intended visible effect:
- What this task changes:

## Flow and information

- Entry condition and invocation:
- Primary information and action:
- Secondary/supporting information:
- Hover/focus/carry and destination context (Inventory has no persistent selection/inspector):
- Exit/back/cancel and return focus:
- Useful model data and proposed changes (do not inherit prototype UI by default):
- Any proposed behavior change and why:

## State and input

List states relevant to this component: ordinary, hover, press, focus, empty, locked/unavailable, busy, success/error, overflow, drag/carry/cancel; selection only where that component's interaction requires it. Inventory uses hover/focus tooltips and direct actions, not persistent item selection. Include keyboard operation and a non-drag path. Record gamepad design separately from implemented support. Define which action Escape cancels first.

## Layout and art

- Primary viewport and compact uncertainty:
- Region hierarchy and responsive reflow:
- Long-label/enlarged-text treatment:
- Shared components/tokens consumed:
- Original art required and provenance:
- Exact mockup content/labels:
- Variant variable held apart from fixed content:

## Evidence and decision

- Exact prompt(s), image filename(s), tool/inputs and SHA-256:
- Keep / revise / reject observations:
- Generated inaccuracies that are not product requirements:
- Adopted choice and basis:
- Prototype/source and how to open it:
- One relevant interaction/visual inspection and refinement:
- Lean sanity check result:
- Material limits and next unresolved decision:
