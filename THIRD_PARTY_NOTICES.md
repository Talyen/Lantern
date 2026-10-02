# Third-party notices and asset provenance

Original Lantern code, documentation and original surface studies use [CC BY-NC 4.0](LICENSE.md). Third-party software and content retain their own terms; the project license does not override them.

## Software

Dependencies are declared in `package.json` and locked in `package-lock.json`; included license files and package metadata govern those distributions. Preserve required notices in any future packaged application, including Electron/Chromium/Node.js.

three.js is MIT licensed; preserve its package license and the [full notice](src/rendering/LICENSE-three.txt) in distributed applications.

`@pmndrs/upscaler` 0.2.0 is an independent MIT-licensed FSR-style WebGPU implementation and includes AMD FidelityFX EASU/RCAS attribution. Preserve its package LICENSE and AMD notice in any distributed application. Lantern’s `src/rendering/fsr-temporal.ts` adapts its integration callbacks for three.js r186. `src/rendering/fsr-accumulate.wgsl` adapts its MIT-licensed accumulation shader to preserve converged stationary history; retain the [full notice](src/rendering/LICENSE-upscaler.txt). The other FSR passes remain package-owned. No official AMD FSR4 binaries or frame-generation SDK are included.

navcat 0.4.1 and its mathcat dependency are MIT licensed. `@dimforge/rapier3d-compat` 0.21.0 is Apache-2.0 licensed and includes its WebAssembly physics runtime. Preserve their distributed licenses/notices in packaged builds. The portal composition and retired weapon-ribbon experiment are original Lantern code; no drei-vanilla/meshline code is copied or shipped. The portal rune is drawn locally, without third-party artwork.

## Fonts

Pirata One by Rodrigo Fuenzalida is bundled locally for loot labels and Inventory under the SIL Open Font License 1.1. Preserve [its license](public/fonts/OFL-pirata-one.txt) with the [font](public/fonts/pirata-one.ttf).

## Asset provenance

| Group | Source | Handling |
| --- | --- | --- |
| Original Lantern surface studies | Text-prompted ImageGen rock, soil and environment materials; original HUD orb frames | Active sources are tracked under `assets/textures/` and `assets/ui/orbs/`; retired wood/Paladin palette studies are privately archived. Project license applies to original project material. No Synty input was supplied to generation. |
| Synty scenery and warrior | Owner-supplied Synty packs, including Polygon Viking Realm | Licensed third-party sources and exports remain private; project license does not grant redistribution rights. |
| Gameplay audio | Owner-supplied Sonniss GameAudioGDC recordings from the shared sound library | Selection metadata and preparation code are tracked; masters/intermediates and optimized OGGs remain private. Source terms apply to modified recordings; see [gameplay sound](Docs/AUDIO.md). |
| Mixamo motions and acquisition characters | Signed-in Mixamo catalog export | Sources/catalog/receipts remain private; gameplay animations retargeted locally to separate Paladin and Goblin rigs; gallery samples target each displayed character. No standalone redistribution through this repository. |

Purchase evidence, account tokens and private receipts must not be committed. Local provenance lives with the private acquisition records, not in public notices. The source repository includes conversion tools, not the licensed models, textures or exports.

Before any future public build distribution, review the applicable vendor permissions, actual build inventory and dependency notices. A local build can include private vendor art; successful CI and this notice are not distribution clearance.
