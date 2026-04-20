//! Shared helpers for resolving the workspace target commit and merge base.
//!
//! These helpers intentionally require an existing read permission instead of
//! acquiring their own guard. Lock acquisition should happen at the boundary of
//! the caller so we don't accidentally nest repository locks under a wider
//! exclusive operation.

use anyhow::{Context as _, Result};
use but_core::sync::RepoShared;
use but_ctx::Context;

/// Resolve the effective target commit OID from workspace projection data.
fn target_oid_from_workspace(
    workspace: &but_graph::projection::Workspace,
) -> Result<gix::ObjectId> {
    workspace
        .target_ref
        .as_ref()
        .and_then(|target| workspace.graph.tip_skip_empty(target.segment_index))
        .map(|commit| commit.id)
        .or_else(|| {
            workspace
                .target_commit
                .as_ref()
                .map(|target| target.commit_id)
        })
        .or_else(|| {
            workspace
                .extra_target
                .and_then(|segment_index| workspace.graph.tip_skip_empty(segment_index))
                .map(|commit| commit.id)
        })
        .context(
            "Failed to resolve workspace target: no target information available in workspace.",
        )
}

/// Resolve the commit OID of the workspace target branch or fallback target commit.
pub(crate) fn target_oid_with_perm(ctx: &Context, perm: &RepoShared) -> Result<gix::ObjectId> {
    let (_, workspace, _) = ctx.workspace_and_db_with_perm(perm)?;
    target_oid_from_workspace(&workspace)
}

/// Find the merge base between `branch_oid` and the effective workspace target.
pub(crate) fn merge_base_with_target_with_perm(
    ctx: &Context,
    perm: &RepoShared,
    branch_oid: gix::ObjectId,
) -> Result<(gix::ObjectId, gix::ObjectId)> {
    let (repo, workspace, _) = ctx.workspace_and_db_with_perm(perm)?;

    if let Some((merge_base, target_oid)) = workspace.merge_base_with_target_branch(branch_oid) {
        return Ok((merge_base, target_oid));
    }

    let target_oid = target_oid_from_workspace(&workspace)?;
    let merge_base = repo
        .merge_base(branch_oid, target_oid)
        .map(|merge_base| merge_base.detach())
        .context("Failed to find merge base with workspace target")?;
    Ok((merge_base, target_oid))
}
