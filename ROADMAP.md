# Lantern roadmap

## Milestone 1 — First playable clearing

- [x] Local, repeatable Synty scenery and projected rock pipeline.
- [x] Establish a private, resumable Mixamo acquisition pipeline.
- [x] Export a compatible animated mannequin and a baked ImageGen forest floor.
- [x] Add desktop movement, camera follow, one enemy, attacks, health, victory, defeat, and retry.
- [x] Verify the encounter and asset lab in a browser; run the production build.

Acceptance: a player can start the encounter, defeat the raider with four hits, lose after five hits, retry, and inspect both rock surfaces. Private vendor art stays out of Git.

## Milestone 2 — Combat feel and art direction

- [x] Add a local A/B lab for the Mixamo motion library on one Synty warrior.
- [x] Wire Mixamo motions into combat with independent actor set selectors and wanderer move choices.
- [ ] Choose final motions, then clean up weapon grips and foot contact.

- [x] Replace the mannequin with the Synty warrior and Mixamo motions.
- Add a visible attack telegraph, stronger hit response, sound, and tuned movement and strike timing.
- Compare the painted ground and rock against the Synty palette; reduce visual noise where needed. Try one more original projected surface only after choosing a coherent art direction.

## Milestone 3 — Broader slice and performance

- Add one objective around the chest and a second enemy behavior.
- Profile frame time on target desktop hardware; trim shadows, draw calls, textures, and network payload as needed.
- Decide which private art can ship in a browser build, then review deployment packaging and vendor terms before publication.
