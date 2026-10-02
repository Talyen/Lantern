# Development reference

Read only the section needed for the task. Start with [the daily workflow](DEVELOPMENT.md) and [task routing](ARCHITECTURE.md#task-routing). These instructions retain the detailed workflow and acceptance policy.

## Copyable task example

For a documentation task, start in main and switch to the exact `Directory:` printed by the command (the default location is shown here):

```sh
cd /Users/ryanmcintire/Documents/Lantern
npm run agent:start -- --task menu-docs
cd /Users/ryanmcintire/Documents/Lantern/.local/worktrees/menu-docs
# Edit and review the intended documentation paths here.
mkdir -p .local
cat > .local/reviewed-paths.json <<'JSON'
["Docs/DEVELOPMENT.md"]
JSON
npm run agent:finish -- --paths .local/reviewed-paths.json --message "docs: clarify menu workflow"
# After finish reports integration, return to main for cleanup.
cd /Users/ryanmcintire/Documents/Lantern
npm run agent:cleanup -- --task menu-docs
```

Replace the example slug, reviewed paths and commit message with the task's actual scope. A documentation task needs no preview; player-facing tasks use their one relevant private preview before finish.

## Integration contracts

`npm run agent:status` reports used/total worktree capacity, task paths, preview URLs, lifecycle/check state, promotion journal and free disk space. Registry and OS-managed locks live under Git's common directory, so every worktree sees the same state. Locks release when their owning process exits; no age-based lock stealing. A durable promotion journal lets the next start/finish/main-preview operation complete interrupted promotion. Unexpected main changes require agent repair and are never reset or stashed away.

Finish stages only named reviewed paths and refuses a pre-existing staged index. Commit before the final checks so `check --base <sha>` examines candidate changes, not just a clean working-tree diff. Checks belong to their exact revision/assets; main advancing triggers preparation and relevant checks again. Broken candidates never block unrelated tasks from attempting promotion.

## Private assets and resource use

Worktrees stay on main's filesystem. Native macOS `clonefile` creates independent asset/dependency copies sharing initial storage; ordinary writes allocate changed blocks. Node's clone-copy option is unsupported on this machine and is not used. There is no silent large-copy fallback. Do not use writable symlinks or hardlinks. Clone sizes are logical, not additional physical disk usage.

Prepared `public/vendor` assets are privately cloned at task creation. Run `npm run agent:sources -- --sources animation-packs,synty-library` only for source directories the asset task needs. Never copy `.local` wholesale or install dependencies in another task. Matching lockfile/runtime dependencies are cloned; readiness also checks installed direct dependencies against their locked versions. Changed dependencies or an incomplete/stale clone trigger owned `npm ci`.

Finish combines current main assets with task-edited artifacts before checking. Overlapping different outputs return `needs-asset-repair`. Reconcile/re-export them against main, then provide `--resolved-assets <json-file>` naming the reviewed conflicted vendor-relative paths. That acknowledgement is bound to the recorded main revision and conflicted artifact hashes; newer source or artifact changes require another reconciliation. Unchanged source archives are not repeatedly hashed.

Automatic limits default to eight task worktrees, one static-check job, one heavy build/export/install, and one agent GPU-review session. Worktree capacity is independent of these resource leases: more source-editing tasks do not admit more GPU reviews or heavy jobs. Resource waiting is recorded separately from execution time. A queued build waits before its execution deadline begins and does not hold a lightweight-check slot. These limits do not close or change the user's own play session. Previews start on demand; closing them releases the GPU resource. Level capture/measure/bake operations borrow their verified owned authoring session's lease. Retired second-slot locks drain without terminating their owners and remain reserved so older worktrees cannot admit another job. These are managed-command limits, not a hardware cap on external apps.

Set a repository-local override with `git config --local lantern.maxWorktrees 12`; remove it with `git config --local --unset lantern.maxWorktrees` to restore eight. The setting must be a positive integer and is shared by every worktree. Lowering it preserves existing tasks and waits for usage to fall below the new limit. Every task not yet cleaned consumes a slot, including integrated tasks awaiting cleanup. Admission releases the promotion lock while waiting so other tasks can finish and be cleaned.

Local/private-asset operations require 20 GiB available disk; admission waits at the configured worktree limit. Asset-free CI with no private vendor/source directories uses a 1 GiB reserve, since [standard hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) advertise 14 GB storage. CI containing private inputs retains the 20 GiB reserve. If disk space or task slots are exhausted, the agent runs `agent:status`, cleans completed tasks with `agent:cleanup`, and retries without asking the user to manage resources. Preserve unfinished tasks and source archives. Cleanup retains successful/failure check evidence and preview logs alongside private sources in `.local/agent-archives/<slug>/`. Staging and production public files also use native clones. Successful check evidence replaces older successful evidence; failure evidence is retained. Captures replace the same task/view output rather than collecting a settings matrix.

## Read-only agent tools

`agent:context` reads the canonical [routing table](ARCHITECTURE.md#task-routing) and current Git state; it does not cache a second owner map. Without `--topic`, it lists topics. `--json` returns structured output. `--include-docs` reads the routed sections; `--consumers` lists direct literal relative imports, re-exports and `require` consumers with file/line locations. It does not infer aliases, computed imports or transitive consumers. Dirty paths are limited to 20 with an omitted count; use `git status --short` for the complete inventory before editing/staging.

`agent:inspect` reads tracked area, motion or audio data without preparing assets. Without `--section` it reports available sections and their sizes. Choose an area or `--source motion` / `--source audio`; dotted sections support nested objects and array indexes. Results preserve source order and values, include record IDs/paths, and report total matches and `nextOffset`. Default pages contain at most 10 records and 12,000 output characters. Use `--limit` (1–50), `--offset`, `--query`, exact `--id`, or comma-separated dotted `--fields` to narrow output. Missing selected fields are omitted. Oversized single records require a narrower field selection; values are never silently shortened.

```sh
npm run agent:inspect -- --source motion --section player.profiles --id sword
npm run agent:inspect -- --source audio --section cues --query magic --fields clips,gain
npm run agent:inspect -- --area clearing --section props --offset 10 --limit 5
```

`agent:status` defaults to active tasks. `--task SLUG` includes one task, even when archived; `--all` includes cleaned tasks. `--json` exposes the detailed selected records, including full retained check evidence. Use `--all --json` for the complete historical view. Current worktree, capacity, resource owners and pending promotion remain visible in the compact view. Last-check references identify the tested revision; they do not certify uncommitted edits. Check failures print a bounded diagnostic excerpt and retain complete stage logs.

### Documentation and source reads

Documentation content shares a default 12,000-character budget (`--max-chars` accepts 1,000–50,000). Reports include original line spans, shown/total lines, oversized-line notices and `nextOffset`. Continue one section with `--doc PATH#HEADING --offset N`; offsets count lines within that section. A bare document path reads the whole document within the same budget. The Markdown heading parser is shared with documentation validation, including duplicate headings and fenced examples. Metadata is outside the content budget.

```sh
npm run agent:context -- --topic combat --include-docs --consumers
npm run agent:context -- --doc Docs/RUNTIME.md#save-recovery
npm run agent:source -- --file src/clearing/clearing.ts
npm run agent:source -- --file src/clearing/clearing.ts --symbol updateGame
npm run agent:source -- --file src/clearing/clearing.ts --start-line 1 --end-line 60
```

`agent:source` uses the installed TypeScript parser to list top-level TS/JS declarations and named class/interface members. Select a symbol (for example `Encounter.step`) or an exact line range to read its source. Default symbol pages contain 20 records; selected-source pages contain 100 complete lines. `--limit`, `--offset` and `--max-chars` bound output and report continuation. Offsets count records for lists and lines within selected spans. Overloads with the same name return their combined span. Source inspection excludes private/generated directories and changes no files.

Consumer pages default to 20 records, with a 12,000-character content budget and `nextOffset`; use `--limit` (1–50), `--offset` and `--max-chars`. Owners remain defined only by [task routing](ARCHITECTURE.md#task-routing); discovery scans current tracked/unignored TS/JS without writing a dependency map. Documentation and consumers have separate budgets when requested together. For a source import not represented by this lookup, use scoped `rg` and inspect its real consumer.

### Saved failure diagnostics

Checks already retain complete stage logs and print a bounded initial excerpt. `agent:diagnostics` reads that evidence without taking a check lease or rerunning validation:

```sh
npm run agent:diagnostics -- --evidence .local/checks/TIMESTAMP
npm run agent:diagnostics -- --evidence .local/checks/TIMESTAMP --stage types
```

Use the actual evidence directory printed by checks or `agent:status`. Explicit evidence paths resolve from the caller and may point to retained task archives. Without `--stage`, list failed/skipped stages. With it, return diagnostic matches, original log line numbers, available file headers and preceding context; logs without recognizable diagnostics return nonempty lines. Pages use `--offset`, `--limit` (1–50) and `--max-chars`; complete logs remain at the reported path. Match discovery is heuristic, not a complete diagnostic parser; inspect the full log for missing context.

### Assessing context cost

For a few representative tasks, compare tool calls, returned characters and repeated reads. Use section/symbol reads and a scoped consumer lookup before whole files. Character budgets are proxies for tokens; these tools do not claim tokenizer accuracy or measured savings. Reassess routing when an agent repeatedly needs omitted contracts. This is context-output inspection, not a GPU benchmark or authorization for additional tests.

## Level authoring

Use the persistent preview and captures in [level design](LEVEL_DESIGN.md): `npm run levels:dev`, `npm run levels:capture`, `npm run levels:check`, `npm run levels:assets`, `npm run levels:measure -- --reason "request or defect evidence"` only when authorized by the performance policy, and `npm run levels:stop`. Use one representative view; `levels:capture -- --all` is an explicit batch. Close owned sessions after review. Ordinary scene-data edits need no build/export/restart.

When a capture helps review an area, run these from its task worktree with the owned authoring preview active:

```sh
npm run levels:capture -- --area clearing                # One center view (default)
npm run levels:capture -- --area clearing --view center  # One named view
# Optional batch only when the change warrants it:
npm run levels:capture -- --area clearing --all          # All authored views and overview
```

Choose one single-view command for ordinary review. Only `--all` creates a contact sheet; it cannot be combined with `--view`.

## Commands and handoff

| Command | Role |
| --- | --- |
| `npm run dev` | Browser iteration on loopback |
| `npm run typecheck` | Runtime, tests and Vite/Vitest configuration types |
| `npm run lint` | Managed ESLint, Ruff Python correctness and Stylelint CSS checks; no automatic fixes |
| `npm test -- tests/encounter.test.ts` | Explicit focused test for a concrete failure; one local worker |
| `npm test` | Full unit suite in CI (two workers); local full-suite use requires a user request |
| `npm run docs:check` | Local links, heading fragments and npm command names in root Markdown, `Docs/` and `.agents/`, including archives |
| `npm run levels:check` | Area definitions, gate links, library selections and optional-art warnings |
| `npm run build` | Explicit asset/packaging validation or requested build readiness; typecheck, stage private runtime art, and build |
| `npm run preview` | Serve the built renderer locally |
| `npm run smoke:preview` | CI HTTP resource smoke; does not execute gameplay or WebGPU |
| `npm run assets:check` | Available local runtime assets and selected-library closure |
| `npm run assets:check -- --playable` | Require character and compatible default Mixamo motions |
| `npm run check` | Change-aware sanity checks; no ordinary production build |
| `npm run check:full` | Complete CI gate; requested local use requires `-- --allow-local` |
| `npm run agent:start` / `agent:finish` | Private task creation and automatic local integration |
| `npm run agent:dev` / `main:dev` | Private and integrated previews |
| `npm run agent:status` / `agent:cleanup` | Lifecycle/resource inspection and safe cleanup |
| `npm run desktop` | Build and open a visible window for requested manual play |
| `npm run desktop:run` | Visible manual play of an existing build |
| `npm run desktop:check -- --debug-port=9231` | Hidden non-focusable Electron; attach CDP |

Run the light final gate once. Code changes run rendering policy, types, lint and whitespace. Documentation-only changes run links/whitespace; level/docs validators run when relevant inputs change. CSS-only changes need their representative preview and cheap policy, CSS lint and whitespace checks. Python changes run Ruff; lint configuration/rule changes also run the existing policy fixtures locally. Packaging, dependencies, exported assets and build configuration do not automatically trigger suites or builds. Validate affected prepared-art output and references explicitly; build staging is reserved for a focused asset/packaging need or user-requested readiness. `check --assets` adds asset validation without building.

[ESLint configuration](../eslint.config.js) keeps JavaScript correctness checks across tooling/Electron and adds type-aware safety checks in application source, tests and the Vite/Vitest configurations. Detached promises require an explicit rejection handler even when prefixed with `void`; await or return asynchronous assertions. Application union switches must handle every case explicitly, including when a default exists. TypeScript owns undefined names and unused variables; its compatibility preset avoids redundant core checks. Lint rejects explicit `any`, unsafe inferred values, unnecessary assertions, misused spreads and unbound application methods. Parse external JSON through [the unknown-value boundary](../src/data/json.ts), then validate it in its owning save/preference schema. Promise rejection callback parameters use `unknown`; detached callbacks explicitly declare `this: void` or retain their receiver. Type-only imports use `import type` or inline `type` specifiers. `@ts-ignore` and `@ts-nocheck` are forbidden, while `@ts-expect-error` needs a description of at least ten characters. Equality uses `===`/`!==`, with deliberate `== null`/`!= null` checks permitted.

Private assets, worktrees, generated outputs and build evidence are excluded. Suppressions and inline rule configurations need a reason after `--`; disables must name specific rules. [The lint runner](../scripts/lint.mjs) audits directive comments independently with inline suppression disabled, so a directive cannot suppress its own validation. Obsolete suppressions and redundant inline configurations still fail. The signed-in Mixamo browser script retains its browser globals and collector placeholder. Lint checks every active source file and rejects warnings; it never formats, fixes, downloads, runs Python/Blender or prepares assets.

[Ruff settings](../ruff.config.json) enable Python syntax errors and Pyflakes (`E9`, `F`). The pinned official Ruff Node/WASM package is installed by `npm ci`, with no separate Python lint environment; its experimental API is covered by policy fixtures and must be revalidated on upgrades. Python discovery uses tracked and unignored files, excluding generated files and skipping deletions. [Stylelint settings](../stylelint.config.js) catch unknown properties, units/functions, invalid comments and duplicate declarations while allowing consecutive fallback values. `npm run lint` checks all three languages; `npm run lint -- --javascript`, `npm run lint -- --python` and `npm run lint -- --css` select a language. Managed resource limits still serialize lint jobs. Custom policy fixtures run in CI and in the lean gate when lint configuration, rules or their runner change. Local investigation may also use `node scripts/agents/run.mjs --resource checks -- node --test eslint/rules.test.mjs` explicitly.

CI runs all three lint languages and their policy fixtures, unit/workflow suites, build/inventory validation and HTTP smoke on Linux; a small hosted macOS job runs workflow/resource tests including APFS coverage. Triggers remain pull requests, main pushes and manual dispatch. Local integration uses the light gate and may precede CI. Pushes require a user request; local finishing does not push or wait for remote CI. Future automated E2E is CI-first; there is currently no maintained browser E2E suite. Native WebGPU and licensed-art requirements must be resolved before adding one.

Keep automated tests focused on established gameplay, save/inventory safety, resource ownership and asynchronous failure behavior. Use small deterministic fixtures instead of full authored scenery or stress matrices; `levels:check` validates the current area files. Avoid assertions that merely repeat decorative tuning tables. Workflow integration tests run in CI, including macOS coverage. A focused local test may investigate a concrete failure or validate consequential resource-ownership changes; full local suites require a user request. Test-only changes use the light gate, with no gameplay preview.

`check --base <sha>` validates committed candidate whitespace and collects changes relative to the integration baseline. It records inputs, timings and stage logs in ignored `.local/checks/`, records the light/full mode and executed stages, reuses successful checks only for matching inputs and mode, and rejects a source/asset change during validation. Neither mode downloads, exports, bakes, benchmarks or launches browser-review matrices.

Default acceptance is one preview session and one relevant interaction at normal settings. No new test is required unless it protects an important established behavior. Broaden local functional inspection only for an observed failure, consequential save migration or renderer initialization/dependency change; record the reason briefly. Audits and release readiness do not automatically authorize local full suites or performance testing. Build/resource checks do not prove visual quality or platform performance. Finish reports the completed behavior, sanity check and material limits.

## Script conventions

Build and verification entry points remain in `scripts/`. Asset preparation lives in `scripts/assets/`: `synty/` owns Synty import and library conversion, `mixamo/` owns acquisition and rig-compatible motion export, `surfaces/` owns original texture projection and baking, and `characters/` owns private roster conversion and gallery captures. Library helper siblings remain together under `synty/library/`. Repeated Node argument/process/path behavior belongs in `scripts/lib/cli.mjs`. Supported wrappers provide `--help`, reject unknown/repeated flags and missing values before writing, pass literal arguments without a shell, and fail on failed/interrupted children. Exit codes are 0 success, 1 operation failure, 2 invalid invocation. Export defaults resolve from the repository, not the caller's directory; explicitly supplied paths resolve from the caller. Python verifiers also resolve their defaults from the repository.

Long exports stream output. Checks retain complete local logs and print short stage results. Do not add asset regeneration, downloads or formatting to verification. Shared helpers are for demonstrated repetition, not a general scripting framework.

## Publication

Review status, complete candidate paths and relevant diffs before staging. Original material uses [the project license](../LICENSE.md); third-party exceptions are recorded in [notices](../THIRD_PARTY_NOTICES.md). Never stage private art, receipts, credentials, captures or build products. Commit reviewed source changes and watch the exact pushed revision's CI until green when publication is requested. No website deployment or Steam integration is configured. [Desktop candidates](DESKTOP.md) use explicit public prerelease upload and Windows packaging dispatch; ordinary task integration does not publish builds.

## Testing during the prototype phase

- Aim for roughly 80% of effort on feature design, implementation and refinement. Sanity checks should take a small share of ordinary work; observed failures still need repair.
- Player-facing work normally needs one representative preview session, one relevant route and normal settings. Screenshots are optional. Improve an obvious visible weakness in the same session rather than collecting a review matrix.
- Documentation needs links and diff inspection, no browser. Internal tooling needs fast checks and one relevant observable outcome. Asset changes need inspection of the affected output and its required references.
- Do not add tests by default. Extend an existing test only for an important established behavior that warrants lasting protection. Avoid speculative edge cases, coverage targets, elaborate fixtures, implementation assertions and new gameplay test infrastructure.
- Run relevant checks once after the final edit. Repeat only after relevant changes or observed failures. Unrelated integration changes do not automatically invalidate visual acceptance.
- Broad gameplay flows, alternate moods/zooms/platforms, full catalogs, benchmarks and contact sheets are optional targeted tools. Expand local functional inspection only for a concrete failure, consequential save migration or renderer/dependency initialization change; briefly state why. Full local suites require a user request. Audits and release readiness do not automatically authorize benchmarks.
- `npm run check` is the lean default. `npm run check:full` retains the full production gate. Neither automatically downloads, exports, bakes lighting, benchmarks, or runs browser matrices.
- Automated Electron uses hidden non-focusable `desktop:check` and CDP. Resource leases allow one check job, one heavy operation and one agent GPU inspection. Explicit local unit runs use one Vitest worker; CI may use two. Leave the user's play session alone.
- Revisit this policy when Lantern moves beyond the prototype phase or gains public release requirements.

## Review and handoff

Review the task diff and its integration, finish through automatic local promotion, and report completed behavior, the sanity check performed, and material limitations briefly. Do not claim exhaustive coverage or cross-platform performance from a sanity check.

Performance testing is allowed only for a specific user request or an evidenced performance defect; record the request or defect with `levels:measure --reason "request or defect evidence"`. Measurements borrow the owned preview's single GPU lease. Routine feature work, audits, release-readiness gates and scheduled automation must not benchmark. Passive diagnostics and short visual reviews remain available.

Local handoff runs change-aware static checks: types, rendering policy, documentation links, structural levels and whitespace. Full unit/workflow tests, builds and automated E2E are CI-first. A focused local test may investigate a concrete failure; prepared-art tasks validate affected output/references and may build when staging is necessary. Full local suites require a user request. Future automation follows these same limits and exclusions; do not schedule tests or measurements by default. Local promotion may precede CI; pushes still require a user request.
