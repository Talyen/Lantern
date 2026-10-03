# Development workflow

Use Node 24 from `.node-version`, npm 11+, and `npm ci`. Begin with `git status --short`, relevant diffs and [task routing](ARCHITECTURE.md#task-routing), or `npm run agent:context -- --topic <topic>`. Read the affected owners and consumers; use bounded documentation/source reads when useful. Preserve unrelated changes and re-read shared files during concurrent work.

## Working alongside other agents

One agent owns each private task worktree through local integration. Main stays on `main`; the user's integrated preview stays at `http://127.0.0.1:5173`. Routine tasks need no inter-agent messages or path reservations.

1. Run `npm run agent:start -- --task <slug>` from main before any edits, including documentation. Use the exact printed directory for every task command and edit. Registered tasks resume; archived slugs need a fresh name. Admission queues at capacity (`--no-wait` fails immediately).
2. Implement the behavior and its blockers, preserving other tasks and private sources. Before tooling edits read [script conventions](DEVELOPMENT_REFERENCE.md#script-conventions); before preparing art read [resource rules](DEVELOPMENT_REFERENCE.md#private-assets-and-resource-use) and [asset preparation](ASSET_PREPARATION.md).
3. After player-facing edits, start one owned normal-settings preview with `npm run agent:dev -- --browser`, inspect the result and exercise one changed interaction. `--author --area clearing` enables level tools; without `--browser` the source server uses no GPU-review slot. Close it with `npm run agent:dev -- --stop`. Documentation needs links/diff review; tooling needs one relevant observable outcome.
4. Review the task diff. Put only reviewed repository-relative paths in an ignored JSON list, then run `npm run agent:finish -- --paths .local/reviewed-paths.json --message "describe the change"`. Finish commits, rebases, runs the change-aware sanity gate on the exact integration candidate and promotes locally. It stops the task preview; it does not push or create a PR.
5. Repair conflicts/check failures in the task and retry finish until integrated. For conflicts, run `git rebase --continue` after repair. Repeat visual inspection only if repairs or integration changed the inspected behavior. Never reset, stash, overwrite, clean or terminate another task's work; preserve unexpected main changes.
6. After integration, return to main and run `npm run agent:cleanup -- --task <slug>`. It removes only a clean completed worktree and retains private sources/evidence in `.local/agent-archives/<slug>/`; unexpected edits prevent cleanup.

Use `npm run agent:status` for task paths, capacity, resource owners and check references. One check job, one heavy operation and one GPU review are independently leased. Leave the user's play session alone. At capacity or low disk, clean completed tasks and retry; preserve unfinished tasks. Detailed admission, asset conflict and recovery behavior belongs to [resource rules](DEVELOPMENT_REFERENCE.md#private-assets-and-resource-use). A [copyable example](DEVELOPMENT_REFERENCE.md#copyable-task-example) covers first use.

## Commands and handoff

`npm run check` is the local change-aware sanity gate; finish runs it on the integration candidate, so do not repeat unchanged checks. Full suites, production builds, inventory and HTTP smoke are CI-first; a user-requested local full gate uses `npm run check:full -- --allow-local`. Prepared-art work validates affected output/references. Pushes, PRs, releases and remote CI follow-through require a user request.

Default to no new automated tests. Add or materially expand a test only when it protects a consequential behavior against a concrete, plausible failure and provides lasting confidence beyond existing checks. Low- and medium-value tests are normally out of scope unless explicitly requested. A bug fix does not automatically require a regression test. Follow [test admission and review](DEVELOPMENT_REFERENCE.md#testing-during-the-prototype-phase), including a short rationale when adding or materially expanding tests.

Acceptance needs one relevant gameplay interaction, links/diff review for documentation, or an observable command result for tooling. Broaden only for an observed failure, consequential save migration or renderer/dependency initialization change. Performance measurements require a specific user request or evidenced defect and the reason flag in [Performance](PERFORMANCE.md). Routine work does not authorize benchmarks or local full suites.

Screen and component design follows the [UI design system](UI_DESIGN.md) and [UI workflow](ui/WORKFLOW.md): a player-goal brief, original mockup when it answers a design question, functional DOM translation and focused visual/interaction refinement. Their screen/state coverage inventories describe design responsibilities, not automated test matrices.

Report completed behavior, sanity validation and material limits. Checks/builds do not establish visual quality or cross-platform performance. The [command reference](DEVELOPMENT_REFERENCE.md#commands-and-handoff) owns detailed checks; [read-only tools](DEVELOPMENT_REFERENCE.md#read-only-agent-tools) owns bounded context, manifest/source inspection and saved diagnostics. Specialized guides are reached through [task routing](ARCHITECTURE.md#task-routing); historical migration evidence is [optional background](archive/TASK_WORKFLOW_2026-10-01.md).

## Desktop candidates

[Desktop packaging and diagnostics](DESKTOP.md) owns Mac preparation, public Windows candidate packaging, local report export and manual Windows acceptance. Candidate preparation requires clean committed source and prepared playable art; publication and dispatch are explicit commands.
