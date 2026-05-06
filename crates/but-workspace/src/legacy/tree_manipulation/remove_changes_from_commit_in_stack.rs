use anyhow::{Result, bail};
use but_core::{DiffSpec, TreeChange, sync::RepoExclusive};
use but_ctx::Context;
use but_rebase::replace_commit_tree;
use gix::ObjectId;

use crate::legacy::tree_manipulation::utils::{ChangesSource, create_tree_without_diff};

/// Removes the specified changes from a commit.
///
/// This function does not update the stack or the workspace commit. Only generates a new commit
/// that has the specified changes removed.
/// # IMPORTANT: expects the caller to write ws back!
fn remove_changes_from_commit(
    ctx: &Context,
    source_commit_id: gix::ObjectId,
    changes: impl IntoIterator<Item = DiffSpec>,
    _perm: &mut RepoExclusive,
) -> Result<ObjectId> {
    let repo = ctx.repo.get()?;
    let (source_tree_without_changes, rejected_specs) = create_tree_without_diff(
        &repo,
        ChangesSource::Commit {
            id: source_commit_id,
        },
        changes,
        ctx.settings.context_lines,
    )?;

    if !rejected_specs.is_empty() {
        bail!("Failed to remove certain changes");
    }

    let rewritten_source_commit =
        replace_commit_tree(&repo, source_commit_id, source_tree_without_changes)?;
    Ok(rewritten_source_commit)
}

/// Keeps only the specified file changes in a commit, removing all others.
pub(crate) fn keep_only_file_changes_in_commit(
    ctx: &Context,
    source_commit_id: gix::ObjectId,
    file_changes_to_keep: &[String],
    skip_if_empty: bool,
    perm: &mut RepoExclusive,
) -> Result<Option<gix::ObjectId>> {
    let commit_changes = but_core::diff::ui::commit_changes_with_line_stats_by_worktree_dir(
        &*ctx.repo.get()?,
        source_commit_id,
    )?;
    let changes_to_remove: Vec<TreeChange> = commit_changes
        .changes
        .clone()
        .into_iter()
        .filter(|change| !file_changes_to_keep.contains(&change.path.to_string()))
        .map(|change| change.into())
        .collect();
    if skip_if_empty && changes_to_remove.len() == commit_changes.changes.len() {
        // If we are skipping if empty and all changes are to be removed, return None
        return Ok(None);
    }

    let diff_specs: Vec<DiffSpec> = changes_to_remove
        .into_iter()
        .map(|change| change.into())
        .collect();

    remove_changes_from_commit(ctx, source_commit_id, diff_specs, perm).map(Some)
}

pub(crate) fn remove_file_changes_from_commit(
    ctx: &Context,
    source_commit_id: gix::ObjectId,
    file_changes_to_split_off: &[String],
    skip_if_empty: bool,
    perm: &mut RepoExclusive,
) -> Result<Option<gix::ObjectId>> {
    let commit_changes = but_core::diff::ui::commit_changes_with_line_stats_by_worktree_dir(
        &*ctx.repo.get()?,
        source_commit_id,
    )?;
    let changes_to_remove: Vec<TreeChange> = commit_changes
        .changes
        .clone()
        .into_iter()
        .filter(|change| file_changes_to_split_off.contains(&change.path.to_string()))
        .map(|change| change.into())
        .collect();
    if skip_if_empty && changes_to_remove.len() == commit_changes.changes.len() {
        // If we are skipping if empty and all changes are to be removed, return None
        return Ok(None);
    }
    let diff_specs: Vec<DiffSpec> = changes_to_remove
        .into_iter()
        .map(|change| change.into())
        .collect();

    remove_changes_from_commit(ctx, source_commit_id, diff_specs, perm).map(Some)
}
