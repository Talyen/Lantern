# Gameplay library decisions and trials

Lantern targets deliberate combat in compact handcrafted areas, grounded Synty art and occasional magic. Native WebGPU is the current renderer contract. Windows and macOS are the initial release targets; local macOS validation does not establish Windows compatibility.

## Retained integrations

- **Navigation:** navcat generates one navigation mesh on area construction from the numeric boundary, explicit solid proxies and optional surface triangles. The authored melee role remains in the encounter simulation. Route requests are cached for 250 ms and refreshed when the target moves 40 cm. Failed queries stop pursuit rather than steering through walls.
- **Grounded collision:** Rapier resolves proposed movement using a 30 cm-radius capsule, sliding, a 30 cm autostep and snap-to-ground, and a 45-degree slope limit. Encounter state owns X/Y/Z. Neither the renderer nor Rapier owns attack clocks, damage or outcomes. Line-of-sight and elevation prevent melee contacts through walls or between unrelated elevations. No dynamic prop simulation is enabled. Rapier initialization needs the narrow `wasm-unsafe-eval` CSP permission, not JavaScript eval permission.
- **Portal:** an upright gold/amber oval, swirling interior and one sparse ground-rune decal. The rendering class remains a generic visual effect; Adventure supplies Scroll of Return destinations, interaction and portal lifetime. The isolated `?area=movement-trial&portal=off` fixture supplies the visual comparison baseline; its default and `?portal=simple` use the retained TSL material. It stops while paused and releases its resources with the area. A three-fluid-fx 0.1.0 trial used its TSL entry point, 64-pixel velocity/128-pixel density fields and six pressure iterations. The solver added memory without a compelling visual improvement, so its code and dependency were removed. See the matched evidence below in the performance owner.

## Authored movement data

Optional `traversal` in an area definition contains explicit `obstacles` (stable ID, world position, full box size, yaw) and optional `surfaces` (world-space positions and triangle indices, upward-facing winding). The numeric floor comes from the walkable boundary. Visual props do not automatically become obstacles; missing art never changes the collision layout. Surface triangles are also drawn by the builder, so a trial slope and its collision agree.

The clearing contains explicit proxies for its rocks, chest, tent, supplies, barrel and logs, plus harvestable trunk proxies that update when trees are felled or regrow. The blockout contains its box obstacles. `?area=movement-trial` supplies an isolated wall, small step and slope without additional licensed assets. Use development `?author=levels&area=movement-trial` for stable camera views and diagnostics. No debug panels are added to ordinary gameplay.

## Deferred projects

Recast remains the navigation alternative if navcat fails a demonstrated requirement. Yuka, runtime IK, InstancedMesh2 and Quarks are deferred. Use native instancing and baked motion cleanup first. BVH is conditional on a query need Rapier cannot satisfy. Water shaders wait for an authored water area. glTF Transform is available for measured loading, memory or rendering problems; file compression alone does not improve FPS. EZ-Tree and studying example-game source are excluded; vegetation remains Synty.

See [architecture](ARCHITECTURE.md), [level authoring](LEVEL_DESIGN.md) and [performance evidence](PERFORMANCE.md). Use the normal [development handoff](DEVELOPMENT.md#commands-and-handoff) and one relevant gameplay flow when behavior changes. Prepared-art validation is targeted to affected outputs.

Weapon trails were removed from runtime presentation; hit-impact sparks remain. Historical matched timing measurements in Performance retain their original cases.
