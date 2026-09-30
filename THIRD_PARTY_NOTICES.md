# Third-party notices and asset provenance

Original Lantern code, documentation and original surface studies use [CC BY-NC 4.0](LICENSE.md). Third-party software and content retain their own terms; the project license does not override them.

## Software

Dependencies are declared in `package.json` and locked in `package-lock.json`; included license files and package metadata govern those distributions. Preserve required notices in any future packaged application, including Electron/Chromium/Node.js.

`src/temporal-aa.ts` adapts three.js r180 TRAANode. Copyright 2010–2025 three.js authors, MIT license. Its header and [full notice](src/LICENSE-three.txt) must remain. This third-party adaptation is an exception to the project's noncommercial license.

## Asset provenance

| Group | Source | Handling |
| --- | --- | --- |
| Original Lantern surface studies | Text-prompted ImageGen rock, forest floor, stone, soil and wood studies | Tracked under `assets/textures/`; project license applies to original project material. No Synty input was supplied to generation. |
| Synty scenery and warrior | Owner-supplied Synty packs, including Polygon Viking Realm in Topaz | Licensed third-party sources and exports remain private; project license does not grant redistribution rights. |
| Mixamo motions and acquisition characters | Signed-in Mixamo catalog export | Sources/catalog/receipts remain private; animations retargeted locally to the Synty rig. No standalone redistribution through this repository. |

Purchase evidence, account tokens and private receipts must not be committed. Local provenance lives with the private acquisition records, not in public notices. The source repository includes conversion tools, not the licensed models, textures or exports.

Before any future public build distribution, review the applicable vendor permissions, actual build inventory and dependency notices. A local build can include private vendor art; successful CI and this notice are not distribution clearance.
