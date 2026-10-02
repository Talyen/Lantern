# Development workflow

Use Node 24 from `.node-version`, npm 11+, and `npm ci`. Direct reads and scoped `rg` are enough for discovery. Inspect status and relevant diffs before editing; preserve unrelated changes and re-read shared files during concurrent work.

## Working alongside other agents

Use one private Git worktree per task. The main checkout stays on `main` and is written by the integration command; the user's integrated preview stays at `http://127.0.0.1:5173`. Task source/index, dependencies, caches, exports and profiles are independent. Routine work needs no messages or path reservations.

1. Run `npm run agent:start -- --task <slug>` in main. Use the printed directory as the working directory for every edit and command. The script creates `codex/<slug>` and resumes an existing registered task. Admission waits when all worktree slots are occupied; Ctrl+C cancels the wait, or add `--no-wait` to fail immediately at capacity. Resuming a registered task does not need another slot. Cleaned task slugs remain archived; choose a fresh slug for new work. One agent owns that worktree through integration.
2. Implement the feature. For player-facing work, use `npm run agent:dev -- --browser` to start one isolated native WebGPU browser; `--author --area clearing` enables existing level tools. Inspect one representative result and exercise the changed interaction. `agent:dev` without `--browser` serves source without consuming the GPU-review slot. Stop the owned session with `npm run agent:dev -- --stop`.
3. Put explicitly reviewed repository-relative paths in an ignored JSON list, for example `.local/reviewed-paths.json`. Run `npm run agent:finish -- --paths .local/reviewed-paths.json --message "feat: describe the completed behavior"`. The command commits those paths, rebases onto local main, runs the change-aware sanity gate and fast-forwards main when the tested baseline still matches. This applies to documentation tasks too. It stops the task preview first. No push or PR is created.
4. On a rebase conflict, repair it in the private worktree, run `git rebase --continue`, and retry finish. Failed checks return their log and leave main untouched. Repeat a visual inspection only if repair or integration changed the inspected behavior. The task owner continues until integrated.
5. Run `npm run agent:cleanup -- --task <slug>` from main after integration. It closes owned processes and removes only a clean completed worktree, retaining private source directories under `.local/agent-archives/<slug>/`. Branch history remains recoverable. Unexpected source/asset edits prevent cleanup.

`npm run agent:status` reports used/total worktree capacity, task paths, preview URLs, lifecycle/check state, promotion journal and free disk space. Registry and OS-managed locks live under Git's common directory, so every worktree sees the same state. Locks release when their owning process exits; no age-based lock stealing. A durable promotion journal lets the next start/finish/main-preview operation complete interrupted promotion. Unexpected main changes require agent repair and are never reset or stashed away.

Finish stages only named reviewed paths and refuses a pre-existing staged index. Commit before the final checks so `check --base <sha>` examines candidate changes, not just a clean working-tree diff. Checks belong to their exact revision/assets; main advancing triggers preparation and relevant checks again. Broken candidates never block unrelated tasks from attempting promotion.

### Copyable task example

See the [copyable example](DEVELOPMENT_REFERENCE.md#copyable-task-example) when starting a first task.

### Private assets and resource use

Read [resource rules](DEVELOPMENT_REFERENCE.md#private-assets-and-resource-use) for the configurable worktree limit, queued admission, disk reserves, private clones, asset conflicts and evidence retention. One check job, one heavy operation and one agent GPU review are independently leased. Preserve unfinished tasks and the user's play session.

### Migration

[Historical migration and setup observations](archive/TASK_WORKFLOW_2026-10-01.md) are optional background.

## Commands and handoff

| Command | Use |
| --- | --- |
| `npm run agent:context -- --topic inventory` | Current Git state, relevant owners, document sections and commands |
| `npm run agent:inspect -- --area clearing --section props --query lantern` | Filtered, bounded area records |
| `npm run agent:status` | Active tasks, capacity, resources and last-check references |
| `npm run agent:dev -- --browser` | One owned preview for player-facing work |
| `npm run agent:dev -- --stop` | Close the owned preview |
| `npm run check` | Change-aware local sanity check |
| `npm run agent:finish -- --paths .local/reviewed-paths.json --message "describe the change"` | Commit reviewed paths, check the integration candidate and promote locally |

Run the final sanity gate once; `agent:finish` performs it on the integration candidate. Relevant checks cover native rendering policy, types, JavaScript/TypeScript, Python and CSS lint, documentation, levels and whitespace. Lint-policy fixtures run when their policy inputs change. Full suites, production builds, inventory and HTTP smoke are CI-first; requested local full validation uses `npm run check:full -- --allow-local`. Prepared-art tasks inspect affected output/references; build staging is targeted. Nothing automatically downloads, exports, bakes, benchmarks or launches browser matrices.

After gameplay edits, exercise one short relevant interaction at normal settings in one owned preview. Documentation needs links and diff inspection; internal tooling needs a relevant observable outcome. Do not add tests by default. Extend an existing test only for important established behavior. Broaden inspection only for an observed failure, consequential save migration or renderer/dependency initialization change. Performance measurements require a specific user request or evidenced defect and the reason flag in [Performance](PERFORMANCE.md).

Review the task diff, integrate through finish, then clean the completed worktree. Report completed behavior, validation and material limits. Pushes, PRs, releases and remote CI follow-through require a user request. Read the [complete command and check reference](DEVELOPMENT_REFERENCE.md#commands-and-handoff) or [prototype acceptance policy](DEVELOPMENT_REFERENCE.md#testing-during-the-prototype-phase) when relevant.

## Read-only agent tools

`agent:context` reads the canonical [routing table](ARCHITECTURE.md#task-routing) and current Git state; it does not cache a second owner map. Without `--topic`, it lists topics. `--json` returns structured output. Dirty paths are limited to 20 with an omitted count; use `git status --short` for the complete inventory before editing/staging.

`agent:inspect` reads tracked area, motion or audio data without preparing assets. Without `--section` it reports available sections and their sizes. Choose an area or `--source motion` / `--source audio`; dotted sections support nested objects and array indexes. Results preserve source order and values, include record IDs/paths, and report total matches and `nextOffset`. Default pages contain at most 10 records and 12,000 output characters. Use `--limit` (1–50), `--offset`, `--query`, exact `--id`, or comma-separated dotted `--fields` to narrow output. Missing selected fields are omitted. Oversized single records require a narrower field selection; values are never silently shortened.

```sh
npm run agent:inspect -- --source motion --section player.profiles --id sword
npm run agent:inspect -- --source audio --section cues --query magic --fields clips,gain
npm run agent:inspect -- --area clearing --section props --offset 10 --limit 5
```

`agent:status` defaults to active tasks. `--task SLUG` includes one task, even when archived; `--all` includes cleaned tasks. `--json` exposes the detailed selected records, including full retained check evidence. Use `--all --json` for the complete historical view. Current worktree, capacity, resource owners and pending promotion remain visible in the compact view. Last-check references identify the tested revision; they do not certify uncommitted edits. Check failures print a bounded diagnostic excerpt and retain complete stage logs.

## Level authoring

See [the authoring loop](LEVEL_DESIGN.md#fast-iteration) and [capture commands](DEVELOPMENT_REFERENCE.md#level-authoring). Rendering starts only for a relevant inspection.

## Private asset workflow

Read [asset preparation](ASSET_PREPARATION.md) only for the affected art.

### Required playable character and motions

See [playable preparation](ASSET_PREPARATION.md#required-playable-character-and-motions).

### Lossless surface channel packing

See [channel packing](ASSET_PREPARATION.md#lossless-surface-channel-packing).

### GPU-compressed scenery

See [the optional compression trial](ASSET_PREPARATION.md#gpu-compressed-scenery).

### Optional scenery and surface studies

See [surface preparation](ASSET_PREPARATION.md#optional-scenery-and-surface-studies).

## Script conventions

Read [CLI, path, exit-code and logging conventions](DEVELOPMENT_REFERENCE.md#script-conventions) before changing tooling. [Lint and policy ownership](DEVELOPMENT_REFERENCE.md#commands-and-handoff) also applies.

## Optional targeted smoke references

Choose one relevant portion of [the interaction references](SMOKE_REFERENCES.md#optional-targeted-smoke-references).

## Publication

Read [publication rules](DEVELOPMENT_REFERENCE.md#publication) before a requested push or distribution.

## Known local contention

See [historical observations](archive/TASK_WORKFLOW_2026-10-01.md#known-local-contention); resource wrappers now manage agent rendering and heavy jobs.

## Current graphics options

See [graphics settings](GRAPHICS.md) for current controls, defaults, comparison URLs and settings persistence. [Gameplay sound](AUDIO.md) owns the Sound controls in the same Options menu.

## Lighting preparation

The sole shared Golden preset, local light recipes, automatic probe coverage, cache budgets, prepared bakes and fixed visual references are documented in [lighting authoring](LIGHTING.md). `npm run lighting:bake` is an explicit native WebGPU authoring operation; it never runs in routine checks or builds. Prepared atlases stay under ignored `public/vendor/lighting/`, with metadata-only references in `assets/lighting-bakes.json`.

## Combat controls and focused acceptance

See [controls and the relevant interaction flow](SMOKE_REFERENCES.md#combat-controls-and-focused-acceptance).

## Equipment acceptance

See [the focused equipment flow](SMOKE_REFERENCES.md#equipment-acceptance).
