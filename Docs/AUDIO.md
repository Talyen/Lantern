# Gameplay sound

Lantern uses recorded weapon and movement foley, compact creature reactions, subdued magic and quiet woodland/refuge ambience. Combat leads the mix; there is no background music or continuous reward chatter. The approved combat-polish direction permits brief selected-contact hit pause and strongest-Skill camera shake; see [impact clocks](RUNTIME.md#combat-impact-clocks).

Follow the shared [interaction feedback principle](INTERACTION_FEEDBACK.md): sound may reinforce meaningful actions and outcomes, while essential meaning remains visible with sound muted or unavailable. A clear existing visual response can suffice; this does not require a sound for every input or change the event timing and bounded playback rules below.

## Owners and event timing

`src/audio/audio.ts` owns one Web Audio context, cached decoded buffers, gain buses, variant selection, positional attenuation and bounded playback. `src/audio/gameplay.ts` maps numeric gameplay results to the authored cues in [the audio manifest](../assets/audio/manifest.json). Simulation and rendering never depend on playback succeeding.

Loot presentation emits no independent audio. Drop, landing and pickup sounds use the shared gameplay events and Sound gains, so Master and Effects mute every reward cue.

Encounter events distinguish accepted attacks, contact/release, dodge/landing, successful damage/block and projectile collision. Existing hit/animation events retain their presentation consumers. Adventure queues successful discovery, chest, physical drop/landing/collection, healing-start, potion-use and Return cast/portal events; the coordinator drains them once. UI sounds follow menu transitions and successful equipment commits. Animation resets and restoring area snapshots emit no attack, reward or death sounds.

Footsteps follow collision-resolved displacement and gait half-cycles. Standing, walking into a wall, teleporting, attack locks and pauses emit none. Player steps occasionally add quiet armor/cloth movement. Combat one-shots have 20 voices, UI has four, and ambient loops have twelve at most. Repeated cues avoid the immediately previous variant. World sounds attenuate to silence at 18 m with restrained stereo placement relative to the isometric view; UI and outcome cues remain centered.

Gameplay audio retains per-actor footstep records and flame descriptors from the current immutable area fire list. Each frame computes each flame distance once and inserts into a selection of at most six nearest flames, keeping authored order for equal distances without sorting the full list. The selection array and loop-key set are reused; reset releases the retained area references. This does not change variant selection, gait cadence or playback scheduling.

The first pointer/key gesture unlocks playback. Four concurrent jobs prepare the 40 selected buffers; unavailable files warn once and appear in development authoring diagnostics. Late assets never replay missed events. Menus and loading silence the gameplay buses and cancel transient actions while UI remains available. Backgrounding silences every bus, stops gameplay one-shots and suspends the context. Focus changes serialize suspend/resume requests. Travel/reset clears the previous area voices; committed destination state starts only its own fire/portal loops. Interrupted attacks stop their charge/windup, and death stops Return casting.

Sound settings use `lantern.audio.v1`, independent of character and graphics saves. Options presents Master, Effects (including UI) and Ambience volume. Defaults are 80%, 100% and 60%; zero mutes that category. Reset defaults restores both graphics and sound. Invalid preferences use the sound defaults and storage failures retain working session settings.

## Current coverage

- Movement: player/enemy footsteps, equipment rustle, dodge and landing.
- Combat: axe/sword swings, body impacts, shield blocks, bow release/arrow impacts, staff/caster charge/release, projectile terrain collision, player/enemy hurt and death, victory/defeat cues.
- Gathering: chop swing/contact, final wood crack/felling, mining swing/contact using existing cues and quiet material confirmation.
- Rewards: first chest opening, physical equipment/material/potion/scroll toss and landing, successful equipment/supply pickup, and partial stack collection.
- Travel/refuge: Return cast, portal opening/hum/passage/closing, successful campfire travel, first fire discovery, healing start, woodland and nearby flame ambience.
- Recovery: Health Potion use reuses the healing cue.
- Menus: Inventory, Travel and Options opening/closing, enabled button activation, successful inventory/stash moves/splits/sorting/drops and equipment changes.

Continuous healing, hovering, XP changes and resource renewal remain quiet. Starter Skills use their existing weapon cues; sounds do not add mechanics for future gold, shops or earned Ultimates. Flame ambience does not decide campfire safety or healing eligibility.

## Private asset preparation

Read the owner's catalog at `~/Documents/Asset Library/Sounds/reference/catalog.csv`. The selected recordings have Sonniss bundle provenance; [the governing source terms](https://sonniss.com/gdc-bundle-license/) and the library's acquisition records remain authoritative. Unknown-provenance extracted assets were excluded from this selection. The manifest records stable source IDs, library-relative paths, stored SHA-256 hashes, source packs, edits, cue gains, variations and output references.

Run `npm run audio:prepare -- --ffmpeg /absolute/path/to/ffmpeg` in the owned task worktree. `--source` overrides the shared library root. The tool also accepts `FFMPEG`, an installed `ffmpeg`, or a private imageio-ffmpeg executable beneath `.local/audio/tools/imageio_ffmpeg/binaries`. It requires FFmpeg with libvorbis; it adds no runtime dependency. Original shared masters are read-only and checked against their catalog hashes.

The exporter resamples to 48 kHz, trims one-shot silence around audible material, fades short tails and normalizes peaks with headroom. Positional effects use mono Vorbis around 96 kbps; woodland ambience uses stereo around 160 kbps. Loops use a circular crossfade. It decodes each export to reject clipping/non-finite samples and records trims, lengths, peaks, loop boundary deltas, bytes and output hashes in `.local/audio/preparation.json`. Technical signal checks do not establish listening quality.

Prepared recordings stay private under `public/vendor/audio/`. Only manifest-referenced OGGs enter build staging and `.local/build-inventory.json`; masters, editing intermediates and the shared catalog do not enter Git or the build. A wholly absent private bank supports source-only builds and nonfatal runtime diagnostics; a partially prepared bank fails asset validation. Checks/builds never prepare or download sounds automatically.

## Raider exchange

The verified Goblin axe clip retains its approximately 1.05 s duration and 0.46 s contact. `commitLead: 0.16` lives beside that clip in [motion profiles](../assets/motion-profiles.json), so animation loading passes it into the numeric encounter timing without a separate coordinator balance table.

The raider plants and commits facing at acceptance. Contact checks the forward 120-degree arc within 1.8 m, plus existing height and obstruction rules. Early hits interrupt; the final 0.16 s before unresolved contact continues through nonlethal damage while retaining the attack pose. Killing blows always interrupt. Hits during recovery stagger normally, and an uninterrupted miss completes recovery before pursuit resumes. Damage, health and cooldown values retain their ordinary-enemy pacing. Impact particles are short and local; no ground telegraph is added.

## Acceptance evidence

The local native WebGPU preview checks action/event playback, the solo raider dodge/retaliation exchange, gathering, rewards, menus and travel through both playable areas. All 40 files decode without audio errors. Focused simulation checks protect early/late commitment, directional misses, lethal cancellation and exactly-once action/reward events. Export checks record 1.18 MiB of prepared sounds without clipping. These are technical/local interaction checks; listening-based approval of the final mix and other-platform playback remain unverified.

Clearing rain uses a quiet recorded forest-leaves excerpt on the Ambience bus. Weather Effects controls its loop; Homestead remains dry. Sword/axe impact pitch and successful-Skill emphasis are presentation-only and retain exactly-once event ownership. The private rain master remains read-only; its source identity, hash and excerpt/loop recipe are in the audio manifest.

Axe Berserking's battle cry uses the existing short human vocal recording as an exertion cue on Effects, at its own gain/playback rate. Cry acceptance emits it once; buff completion adds quiet gear movement. Crushing Blow uses the existing Axe swing/impact cues with the confirmed-Skill emphasis. Animation-lab seeking remains silent, and the timed HUD state communicates activation without sound.
