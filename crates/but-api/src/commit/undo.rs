use std::collections::BTreeMap;

use anyhow::Context as _;
use but_api_macros::but_api;
use but_core::{DiffSpec, sync::RepoExclusive};
use but_oplog::legacy::{OperationKind, SnapshotDetails, Trailer};
use tracing::instrument;

use crate::commit::types::{CommitUndoResult, MoveChangesResult};

/// Undo `subject_commit_id` using the behavior described by [`commit_undo_only_with_perm()`].
#[but_api(napi, crate::commit::json::CommitUndoResult)]
#[instrument(err(Debug))]
pub fn commit_undo(
    ctx: &mut but_ctx::Context,
    subject_commit_id: gix::ObjectId,
) -> anyhow::Result<CommitUndoResult> {
    let mut guard = ctx.exclusive_worktree_access();
    commit_undo_with_perm(ctx, subject_commit_id, guard.write_permission())
}

/// Undo `subject_commit_id` using the behavior described by [`commit_undo_only_with_perm()`].
pub fn commit_undo_only(
    ctx: &mut but_ctx::Context,
    subject_commit_id: gix::ObjectId,
) -> anyhow::Result<CommitUndoResult> {
    let mut guard = ctx.exclusive_worktree_access();
    commit_undo_only_with_perm(ctx, subject_commit_id, guard.write_permission())
}

/// Undo `subject_commit_id` using the behavior described by [`commit_undo_only_with_perm()`].
pub fn commit_undo_with_perm(
    ctx: &mut but_ctx::Context,
    subject_commit_id: gix::ObjectId,
    perm: &mut RepoExclusive,
) -> anyhow::Result<CommitUndoResult> {
    let details = SnapshotDetails::new(OperationKind::UndoCommit).with_trailers(vec![Trailer {
        key: "sha".to_string(),
        value: subject_commit_id.to_string(),
    }]);
    let maybe_oplog_entry = but_oplog::UnmaterializedOplogSnapshot::from_details_with_perm(
        ctx,
        details,
        perm.read_permission(),
    )
    .ok();

    let res = commit_undo_only_with_perm(ctx, subject_commit_id, perm);
    if let Some(snapshot) = maybe_oplog_entry.filter(|_| res.is_ok()) {
        snapshot.commit(ctx, perm).ok();
    };
    res
}

/// Undo `subject_commit_id`, under caller-held exclusive repository access.
///
/// This will move the changes in the commit to be unassigned and discard the commit.
pub fn commit_undo_only_with_perm(
    ctx: &mut but_ctx::Context,
    subject_commit_id: gix::ObjectId,
    perm: &mut RepoExclusive,
) -> anyhow::Result<CommitUndoResult> {
    let changes = {
        let repo = ctx.repo.get()?;
        let commit = repo.find_commit(subject_commit_id)?;

        let mut parent_ids = commit.parent_ids();
        let first_parent = parent_ids.next().map(|id| id.detach());

        // TODO: do we want to handle this?
        anyhow::ensure!(
            parent_ids.next().is_none(),
            "expected {} to have at most one parent",
            subject_commit_id.to_hex()
        );

        let changes = but_core::diff::tree_changes(&repo, first_parent, subject_commit_id)?;
        changes.into_iter().map(DiffSpec::from).collect::<Vec<_>>()
    };

    let (new_commit, mut replaced_commits) = if changes.is_empty() {
        (subject_commit_id, BTreeMap::new())
    } else {
        let MoveChangesResult { replaced_commits } =
            crate::commit::uncommit::commit_uncommit_changes_only_with_perm(
                ctx,
                subject_commit_id,
                changes,
                None,
                perm,
            )
            .with_context(|| {
                format!(
                    "failed to unassign changes in {}",
                    subject_commit_id.to_hex()
                )
            })?;

        (
            replaced_commits
                .get(&subject_commit_id)
                .copied()
                .with_context(|| {
                    format!(
                        "failed to find {} in replaced commits",
                        subject_commit_id.to_hex()
                    )
                })?,
            replaced_commits,
        )
    };

    let mut discard_result =
        crate::commit::discard_commit::commit_discard_only_with_perm(ctx, new_commit, perm)
            .with_context(|| format!("failed to discard {}", subject_commit_id.to_hex()))?;

    replaced_commits.append(&mut discard_result.replaced_commits);

    Ok(CommitUndoResult {
        undone_commit: subject_commit_id,
        replaced_commits,
    })
}
