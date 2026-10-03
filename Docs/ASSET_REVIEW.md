# Asset Review Lab

The development-only `/?lab=assets` route reviews scenery, characters and equipment. It uses the shared native WebGPU pipeline, Golden lighting and FSR Temporal Balanced / 0.50 defaults. It never edits scenes, removes assets or changes player saves.

## Review sessions

Run `npm run assets:review` from main to start or resume a dedicated private task workspace. Open its printed URL. `--browser` opens an owned automated native-WebGPU browser; without it the command starts a source server for manual use. Main's lab is read-only. `npm run agent:dev -- --lab assets --browser` supports inspection while implementing the lab in a regular task; Finish Review is restricted to dedicated review sessions.

Each decision saves durably in that workspace's [review records](../assets/asset-reviews.json). **Finish Review** commits only those records and runs the normal `agent:finish` local integration workflow. It never pushes. Success closes/cleans the completed session after displaying its result; failures preserve records and the worktree for retry. Other dirty paths, staged changes, unrelated commits or changed private exports block automatic handoff. Resolve real conflicts with an agent, then retry; never discard another task's work.

`npm run assets:review -- --task SLUG --finish` retries handoff without the browser. `--stop` closes only that session's preview, preserving decisions. Closing a tab does not integrate decisions. A stale tab cannot overwrite more recent records; use Reload, retaining your draft notes, before saving again.

## Queue and Browse

Review Queue prioritizes used unreviewed appearances before unused candidates. Approve, Deny and Mark for deletion save before advancing; Skip changes no decision and excludes the item only for the current session. Browse revisits any decision, with name/ID search and category, pack, status, usage and scene filters. Component meshes are hidden until explicitly enabled. Decisions are one asset at a time; Deny family is the deliberate exception.

Compact browser panes keep the decision buttons in a fixed bar below the preview. Notes and usage expand above that bar; Escape closes them. Below 640 px, Assets opens the filter/list drawer without shrinking the preview. Wide panes retain three columns, with decisions above independently scrolling notes and usage.

The isolated preview supports orbit, fit, gameplay/front/side/back views and a 1.8 m reference. Character motion samples are available when prepared and compatible; static viewing remains available if a sample fails. Approval requires a prepared, successfully displayed appearance. This is visual selection, not certification of collision, rig integration or gameplay animation.

Usage is static ownership, not the current save or visible frame. It includes scenery placements, source/prepared fallbacks, fires, merchants, shelter stash, player/enemy models, potential player loadouts, enemy equipment, arrows and gathering tools. Expand each scene for placement IDs and roles. Build selection and dependency use are shown separately. Shared file aliases appear as dependents; cleanup must preserve those owners.

## Eligibility and changed art

| Decision | Scene eligibility |
| --- | --- |
| Unreviewed | Development audition only; explicit approval required for new integrated references and shipping |
| Approved | Eligible while the appearance fingerprint matches |
| Denied | Retained for inspection, unavailable for scene use |
| Marked for deletion | Unavailable for use; separate cleanup work requested |

All existing appearances start unreviewed. Ordinary development previews remain usable. `levels:check` rejects new unapproved uses relative to HEAD; the integration sanity gate compares against its actual main base. Existing debt is reported without blocking unrelated work. Shipping staging requires approval of every used appearance, conditional fallback and selected visual root; obsolete build selections must be removed or reviewed. Source-only builds still check identity/eligibility and cannot claim approval for unavailable private art.

The [shared adapters and usage resolver](../scripts/assets/review/index.mjs) are the authority for the lab and gates. Original library IDs, character source IDs and prepared variant slots retain identity across reexports. Geometry, external material inputs, transitive catalog dependencies, prepared material recipes and display height enter appearance fingerprints. A changed approved appearance becomes Unreviewed with its previous decision visible. Denials and deletion requests persist. Family denial overrides individual decisions; clearing it restores them. Approval never adds an asset to build selection.

Use `npm run assets:review:report` for JSON blockers, deletion requests, references, dependent IDs and completed exclusions. `npm run assets:review:check` checks new uses against HEAD; pass `--base SHA` for another comparison or `--shipping` for all shipping blockers. Library lookup remains `npm run levels:find -- --query pine`.

## Separate deletion cleanup

Mark for deletion records intent only. An explicitly requested agent task uses the report, replaces/removes scene and gameplay references, repairs relevant collision/harvest/interaction ownership, removes obsolete build selections, and deletes only exclusive prepared outputs, thumbnails and catalog entries. Inspect all dependent assets and shared URLs first. Private licensed sources and source archives remain preserved. Unreviewed replacements may be auditioned, but require owner approval before new references integrate or ship.

After physical cleanup and reference validation, retain a small completed exclusion under `deleted` in `assets/asset-reviews.json`, keyed by the appearance ID, with `familyId`, the removed `url`, and `deletedAt`. Remove the completed decision from the pending deletion list. Exclusions suppress future imports/exports, including targeted character refreshes and bulk library imports; coverage treats these as intentional omissions. Restoring a deleted asset is explicit: remove the applicable exclusion in a reviewed task, prepare the output and review it anew. Nothing is automatically restored or approved.

Review metadata contains IDs, fingerprints and notes; licensed models, private catalog contents, captures and source paths remain ignored. Follow [asset preparation](ASSET_PREPARATION.md), [level authoring](LEVEL_DESIGN.md) and the [daily workflow](DEVELOPMENT.md).
