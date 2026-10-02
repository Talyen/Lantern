# Task workflow history — October 1, 2026

Historical observations; [current workflow](../DEVELOPMENT.md) and [resource rules](../DEVELOPMENT_REFERENCE.md#private-assets-and-resource-use) remain authoritative.

## Setup observations

The October 1 demonstration measured about 57 MiB of tracked source per worktree and 2.4 GiB of prepared vendor files as logical clones. Roughly 17 GiB of original sources remain lazy and are prepared only for asset work. Initial task setup took 18.5/18.1 seconds before the clone-helper optimization; subsequent setups took 13.6/11.3 seconds. Background disk activity was present, so these observations are neither guaranteed setup timings nor precise physical storage costs per task.

## Migration

The October 1 shared-checkout work was drained and committed as a settled baseline before this workflow was enabled. New tasks use the scripts; legacy advisory notes are historical aids, not locks. Main source must be clean before admission or promotion. Never checkpoint unfinished work simply to satisfy that condition.

## Known local contention

A September 30 foundation check passed both prepared and asset-free builds. Concurrent GPU/browser inspection coincided with a later typecheck deadline and browser-control stalls; typechecking passed after the owned sessions closed. Managed resource leases now queue agent GPU reviews and heavy operations. Close owned rendering sessions after inspection; do not raise timeouts or change product behavior to hide contention.
