# git2 to gix Migration Plan

## Status

Most of the broad migration is already done. This document only tracks the remaining scope needed to finish, plus the intentional `git2` boundaries that are still allowed.

Repository audit on 2026-05-05:

- `git2::` callsites in `crates/**/*.rs`: 92
- files with `git2::` references: 20
- `ctx.git2_repo` / `ctx.with_git2_repo` callsites: 21
- test-only direct `git2` / `git2_repo` / `git2_hooks` references: 36 across 7 files

## Allowed Remaining Boundary

`git2` is still acceptable only where we do not yet have a practical `gix` replacement or where the code is deliberately acting as a compatibility adapter:

- checkout execution and worktree materialization
- index/tree materialization from staged state
- explicit transport/auth adapters that still rely on libgit2
- narrow compatibility surfaces that exist only to bridge older code

Anything outside those areas should continue moving to `gix`.

## Remaining Work

The remaining work is concentrated in a small set of areas:

### Workspace and edit-mode boundary cleanup

These modules still sit on the main checkout/index boundary and should be kept narrow:

- `crates/gitbutler-workspace/src/branch_trees.rs`
- `crates/gitbutler-edit-mode/src/lib.rs`
- `crates/gitbutler-oplog/src/oplog.rs`
- boundary portions of `crates/gitbutler-branch-actions/src/integration.rs`

Goal:

- keep `git2` usage isolated to the actual checkout/index handoff
- move surrounding read-side and domain logic to `gix` where possible

### Repo and transport adapters

These files still appear to contain actionable non-boundary `git2` usage or backend leakage:

- `crates/gitbutler-repo/src/repository_ext.rs`
- `crates/gitbutler-repo/src/commands.rs`
- `crates/gitbutler-repo/src/rebase.rs`
- `crates/gitbutler-repo/src/credentials.rs`
- `crates/gitbutler-repo/src/hooks.rs`
- `crates/gitbutler-repo/src/managed_hooks.rs`
- `crates/gitbutler-repo/src/remote.rs`
- `crates/gitbutler-repo/src/staging.rs`
- `crates/gitbutler-repo-actions/src/repository.rs`
- `crates/gitbutler-tauri/src/projects.rs`
- `crates/but-napi/src/lib.rs`

Goal:

- use `gix`-first APIs for repo reads and domain logic
- keep any remaining libgit2 use behind explicit transport/auth or hook adapters
- stop threading `git2` repositories through higher-level application code unless required by the accepted boundary

### Compatibility surfaces still to shrink

Some crates still intentionally expose `git2` compatibility helpers or legacy types:

- `crates/but-ctx/src/lib.rs`
- `crates/but-oxidize/src/lib.rs`
- `crates/but-serde/src/lib.rs`
- `crates/but-schemars/src/lib.rs`
- `crates/gitbutler-repo/src/lib.rs`
- `crates/gitbutler-cherry-pick/src/*`
- `crates/gitbutler-commit/src/commit_ext.rs`
- `crates/gitbutler-stack/src/stack.rs`

Goal:

- avoid expanding these surfaces
- remove or reduce them only when callers have moved off them

### Test fixture initial states

Test-only `git2` usage still exists, but the next migration target is narrower than "all tests":
remove `git2` from repository initial-state setup. Each reusable initial state should be expressed
as a dedicated `tests/fixtures/scenario/*.sh` script that uses plain `git` commands.

Tests should load those scripts through existing `but-testsupport` fixture primitives such as
`writable_scenario`, `read_only_in_memory_scenario`, `writable_scenario_with_post`, or
`read_only_in_memory_scenario_named_with_post`. Do not replace `git2` setup with runtime Git command
helpers such as `invoke_git()`, `git()`, `git_at_dir()`, or similar helpers in test bodies. Those
helpers are useful for assertions and exceptional test actions, but initial repository shape belongs
in fixture scripts.

When a fixture needs `virtual_branches.toml`, keep Git history and refs in the shell fixture and write
metadata in a post-processing callback. This matches the existing documented `but-testsupport` pattern:
use a `*_with_post` fixture loader, increment the post-processing version when the callback changes,
open the generated repository with `open_repo`, then create or update `VirtualBranchesTomlMetadata`.

Priority targets:

- `crates/gitbutler-repo/tests/repo/support/*`: done for repository initial states. The remaining
  `TestingRepository` `git2` handle exists only for tests that still mutate the index directly.
- `crates/gitbutler-repo/tests/repo/create_wd_tree.rs`: done for reusable initial states; they are
  now fixture scripts. Remaining per-test filesystem/index mutations are the behavior under test.
- `crates/gitbutler-repo/tests/repo/rebase.rs`: done; synthetic `git2` commit graph construction was
  replaced with fixture scripts exposing named tags for target and incoming commits.
- `crates/gitbutler-branch-actions/tests/branch-actions/virtual_branches/*`: replace `TestRepo`'s
  `git2` setup helpers with fixture states plus post-processed metadata where needed. The shared
  default fixture now owns base config, remote URL normalization, and initial remote-tracking refs.

Goal:

- repository initial states are created by fixture scripts, not by `git2` or runtime Git helper calls
  in test bodies
- tests use `but-testsupport` fixture loaders and `gix`/`but-*` APIs for assertions and read-side access
- direct test `git2` remains only for explicit hard-boundary coverage, such as checkout/index conflict
  materialization or hook compatibility

## Current Direction

The intended end state is:

- `gix::ObjectId`, `gix` refs, config, and read-side repository access in normal application logic
- `Context::git2_repo` treated as a deprecated boundary escape hatch only
- residual `git2` usage limited to explicit hard-boundary or compatibility-adapter code

## Completion Criteria

This plan is complete when all of the following are true:

1. Non-boundary application logic no longer depends directly on `git2`.
2. Remaining `git2` use is confined to the accepted boundary or explicit compatibility/adapter code.
3. `ctx.git2_repo` callers are limited to those accepted sites.
4. Test initial states are provided by plain-`git` fixture scripts and loaded through `but-testsupport`
   fixture primitives.
5. Validation still passes for touched crates and workspace-level checks.

## Verification

Recommended checks:

```bash
cargo clippy --all-targets --workspace
rg -n "git2::" crates -S --glob '*.rs'
rg -n "ctx\\.(git2_repo|with_git2_repo)" crates -S --glob '*.rs'
rg -n "git2::|git2_repo|git2_hooks|CheckoutBuilder|IndexAddOption|ResetType" crates/*/tests -g '*.rs'
```

## Tracking

- [x] Broad migration completed
- [x] Config/refname migration completed
- [x] `Context::git2_repo` deprecated
- [ ] Workspace/edit-mode/oplog boundary reduced to the minimal handoff
- [ ] Repo and transport adapters narrowed further
- [ ] Test repository initial states moved to plain-`git` fixture scripts
- [ ] Test and legacy helper `git2` usage reduced to boundary coverage only
- [ ] In-scope `git2` audit at zero outside accepted boundaries
