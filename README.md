# Lantern

A browser-based isometric fantasy playground built with three.js, TypeScript, and Vite. This first scene tests the camera, lighting, and local art pipeline before gameplay work begins.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Drag to orbit and scroll to zoom. If local Synty models are absent, the scene shows a setup message.

## Add the private Synty art locally

The owner supplied Synty Viking Realm assets in Topaz. This machine has the imported FBX files at `../Topaz/Assets/Synty/PolygonVikingRealm`. With Blender installed, convert the three selected models and their palette texture:

```sh
npm run assets:import -- --topaz /absolute/path/to/Topaz
```

On macOS, the command defaults to `/Applications/Blender.app/Contents/MacOS/Blender`. Elsewhere, pass `--blender /absolute/path/to/blender`. Refresh the browser after conversion. The script reads Topaz without modifying it and writes `pine.glb`, `rock.glb`, `chest.glb`, and the painted rock experiment to `public/vendor/synty/`.

## Rock material experiment

The [generated alpine rock albedo](assets/textures/rock-albedo-imagegen.png) is an original ImageGen surface study. `scripts/bake-rock.py` projects it from three axes onto the Synty rock, unwraps the rock into a new UV atlas, and bakes **color only** into a 1024px texture. It exports `rock-painted.glb` locally and keeps the UV bake preview in ignored `.local/rock-painted-albedo.png`. The source FBX and the original palette version remain untouched. In the browser, use **Inspect rock up close** and the surface toggle to compare the same geometry under the same scene lighting.

This first pass uses one generated surface image for three-axis projection. It does not yet use separate ImageGen paint-overs of model renders from multiple camera views. The painted result is more detailed but currently brighter and busier than the original; the close-up helps judge whether it fits the game art direction.

Both rock GLBs have **1,776 triangles** and **5,326 exported vertices**. The original GLB is about **0.87 MB** and the painted GLB about **1.42 MB**. Low polygon count preserves geometry cost, but textures, shadows, draw calls, and screen resolution still affect browser performance. The lab loads both variants for comparison; a production scene would load only the selected one.

**Licensing:** `public/vendor/synty/` is ignored by Git, as are build outputs. Do not commit Synty source FBX files, Synty textures, or exported GLBs. The independent ImageGen albedo above is tracked to make the experiment repeatable. Only authorized team members with the appropriate Synty entitlement should run the importer. A production web build would include any local GLBs in `dist/`; review the exact purchase terms and deployment packaging before publishing such a build. See [Synty's license](https://syntystore.com/pages/one-time-purchase-licence).

## Next steps

1. Add a player character and responsive movement over the clearing.
2. Tune camera follow, occlusion, and zoom for action RPG play.
3. Build one enemy encounter with a clear attack and hit response.
4. Bring in character animation and a small, coherent asset set.
5. Measure frame time and download size before expanding the world.

## Commands

```sh
npm run dev       # local browser server
npm run build     # typecheck and production build
npm run preview   # preview the production build locally
```
