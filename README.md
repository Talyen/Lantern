# Lantern

A desktop-browser fantasy action RPG prototype using TypeScript, three.js, Vite, and a local Electron shell. The first clearing has one playable encounter.

## Run

Use Node 24 (the version in `.node-version`) and npm 11+:

```sh
npm ci
npm run dev
```

Open Vite's printed local URL. WASD or arrows move, Space attacks, and the mouse wheel zooms. Click the clearing to return keyboard focus after using a menu. Defeat the raider, or retry after a loss. Options pauses the encounter and contains graphics controls and rock inspection.

The public repository contains source and original generated surface studies. Playable Synty character art and Mixamo animations must be prepared privately; missing character art produces an actionable import message. Optional scenery can be absent. See the [asset workflow](Docs/DEVELOPMENT.md#private-asset-workflow).

```sh
npm run check       # local handoff and asset-free CI checks
npm run desktop     # build and open Electron for manual play
npm run desktop:check -- --debug-port=9231  # hidden Electron; attach CDP
```

## Documentation

- [Architecture](Docs/ARCHITECTURE.md): runtime owners and simulation boundaries.
- [Development](Docs/DEVELOPMENT.md): commands, private assets, validation, and smoke flows.
- [Performance](Docs/PERFORMANCE.md): matched measurements and historical art/renderer evidence.
- [Roadmap](ROADMAP.md): milestone direction.
- [Agent guide](AGENTS.md): working and testing rules.
- [Third-party notices](THIRD_PARTY_NOTICES.md): source and asset provenance.

## License

Original Lantern code and content are source-available for noncommercial use under [CC BY-NC 4.0](LICENSE.md), following Alchemy's policy. Commercial use requires separate permission from the copyright owner. Third-party material retains its own terms, including the MIT-licensed three.js adaptation. Public source availability does not grant rights to privately supplied Synty or Mixamo assets.
