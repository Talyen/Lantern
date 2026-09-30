# Architecture

Lantern keeps simulation and presentation explicit. This is a small prototype, not a general game engine.

## Owners and data flow

- `src/entry.ts` selects the animation comparison lab or normal clearing. Legacy art/renderer URLs open the clearing's current Options UI.
- `src/encounter.ts` owns plain numeric actor transforms, health, engagement, contact clocks, cooldowns, interruptions and outcomes. It imports neither three.js nor browser globals.
- `src/main.ts` composes scene geometry, character loading, input, camera, simulation, HUD and graphics options. Keyboard input becomes world-space movement. Loaded animation durations/contact points become explicit simulation timing inputs.
- `src/combat-animations.ts` owns Mixamo catalog selection and lazy clip loading. Both actors use motions baked to the Synty rig.
- `src/art-lab.ts` owns the current Graphics Options, effect configuration, graphics persistence and frame measurements. `src/graphics-settings.ts` owns defaults and settings parsing. The historic name remains to avoid unrelated renaming.
- `src/webgpu-art.ts` and `src/temporal-aa.ts` own the WebGPU pipeline and temporal resolve. WebGL uses postprocessing. `src/effects.ts` owns procedural effects and their resources.
- `src/asset-library.ts` owns shared library resources and releasable instances. `src/animation-lab.ts` owns the separate motion comparison.
- `electron/main.cjs` serves the built renderer over loopback with sandboxing, context isolation, and no Node integration.

Simulation operations mutate an explicitly owned encounter: create, reset, attack, and step. Updates return ordered animation, hit, label and outcome events. Presentation synchronizes transforms, then consumes events; rendering never decides health or victory. Player contacts resolve before movement and enemy attacks, matching the original encounter. Clip durations remain inputs rather than render-owned clocks inside simulation.

Pausing, inspection and motion loading stop simulation; UI decides when those gates apply. Retry and motion changes reset encounter state, animation actions, effects and temporal history together. Camera follow preserves a fixed isometric offset and eases only its focus point. Avoid moving runtime rules into a renderer or Options callback.

## Asset and resource ownership

Original texture studies are tracked; downloaded sources and vendor exports are ignored. Exporters read Topaz and write only Lantern outputs. Mixamo is the sole animation provider. Library instances release their owned skeletons; the library owns cached shared textures/materials and is disposed after its instances. Renderer/effects owners retain their cleanup responsibilities.

Production builds stage explicitly selected Synty library entries plus dependency closure. Other vendor directories currently copy wholesale. This is a local-build convenience, not publication clearance. See [development](DEVELOPMENT.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

## Change method

Read the affected owner and consumers first. Preserve existing work; introduce dependencies or abstractions only for concrete consumers. Update this guide when ownership changes. Keep decisions beside their owner rather than only in an implementation plan. Extend the cheap simulation tests only for established behavior that merits ongoing protection.
