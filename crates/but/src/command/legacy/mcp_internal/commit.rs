use std::path::Path;

use bstr::BString;
use but_core::{ref_metadata::StackId, sync::RepoShared};
use but_ctx::Context;
use but_workspace::commit_engine::StackSegmentId;
use rmcp::schemars;
use serde::{Deserialize, Serialize};

/// Commit changes to the repository.
pub fn commit(
    project_dir: &Path,
    commit_message: String,
    diff_spec: Vec<DiffSpec>,
    parent_id: Option<String>,
    branch_name: String,
) -> anyhow::Result<but_workspace::commit_engine::ui::CreateCommitOutcome> {
    let changes: Vec<but_core::DiffSpec> = diff_spec.into_iter().map(Into::into).collect();
    let mut ctx = Context::open(project_dir)?;
    let project_data_dir = ctx.project_data_dir();
    let mut guard = ctx.exclusive_worktree_access();
    let repo = ctx.repo.get()?;

    let branch_full_name = normalize_stack_segment_ref(&branch_name)?;
    let parent_commit_id = parent_id
        .map(|id| resolve_parent_id(&repo, &id))
        .transpose()?;

    let stack_segment = {
        let stack_id = stack_id_for_branch_with_perm(&ctx, guard.read_permission(), &branch_name)?;
        stack_id.map(|stack_id| StackSegmentId {
            segment_ref: branch_full_name,
            stack_id,
        })
    };

    let parent_commit_id = match parent_commit_id {
        Some(id) => Some(id),
        None => {
            let reference = repo
                .try_find_reference(&branch_name)
                .map_err(anyhow::Error::from)?;
            if let Some(mut r) = reference {
                Some(r.peel_to_commit().map_err(anyhow::Error::from)?.id)
            } else {
                None
            }
        }
    };

    let destination = but_workspace::commit_engine::Destination::NewCommit {
        parent_commit_id,
        message: commit_message,
        stack_segment,
    };

    let outcome = but_workspace::legacy::commit_engine::create_commit_and_update_refs_with_project(
        &repo,
        &project_data_dir,
        None,
        destination,
        changes,
        0, /* context-lines */
        guard.write_permission(),
    )?;

    Ok(outcome.into())
}

/// Amend an existing commit in the repository.
pub fn amend(
    project_dir: &Path,
    commit_message: String,
    diff_spec: Vec<DiffSpec>,
    commit_id: String,
    branch_name: String,
) -> anyhow::Result<but_workspace::commit_engine::ui::CreateCommitOutcome> {
    let changes: Vec<but_core::DiffSpec> = diff_spec.into_iter().map(Into::into).collect();
    let mut ctx = Context::open(project_dir)?;
    let mut guard = ctx.exclusive_worktree_access();
    let repo = ctx.repo.get()?;
    let commit_id = resolve_parent_id(&repo, &commit_id)?;

    let stack_id = stack_id_for_branch_with_perm(&ctx, guard.read_permission(), &branch_name)?;

    let destination = but_workspace::commit_engine::Destination::AmendCommit {
        commit_id,
        new_message: Some(commit_message),
    };

    let outcome = but_workspace::legacy::commit_engine::create_commit_and_update_refs_with_project(
        &repo,
        &ctx.project_data_dir(),
        stack_id,
        destination,
        changes,
        0, /* context-lines */
        guard.write_permission(),
    )?;

    Ok(outcome.into())
}

/// Find the in-workspace stack id associated with `branch_name`, if any.
fn stack_id_for_branch_with_perm(
    ctx: &Context,
    perm: &RepoShared,
    branch_name: &str,
) -> anyhow::Result<Option<StackId>> {
    let branch_full_name = normalize_stack_segment_ref(branch_name)?;
    let (_, workspace, _) = ctx.workspace_and_db_with_perm(perm)?;
    Ok(workspace
        .find_segment_and_stack_by_refname(branch_full_name.as_ref())
        .and_then(|(stack, _segment)| stack.id))
}

/// Determines the parent commit ID based on the provided `parent_revspec`.
fn resolve_parent_id(repo: &gix::Repository, parent_id: &str) -> anyhow::Result<gix::ObjectId> {
    repo.rev_parse_single(parent_id)
        .map_err(anyhow::Error::from)
        .map(|id| id.detach())
}

fn normalize_stack_segment_ref(
    stack_segment_ref: &str,
) -> Result<gix::refs::FullName, gix::refs::name::Error> {
    let full_name = if stack_segment_ref.starts_with("refs/heads/") {
        stack_segment_ref.to_string()
    } else {
        format!("refs/heads/{stack_segment_ref}")
    };
    gix::refs::FullName::try_from(full_name)
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiffSpec {
    /// The previous location of the entry, the source of a rename if there was one.
    #[schemars(description = "The previous path of the file, if it was renamed")]
    pub previous_path: Option<String>,
    /// The worktree-relative path to the worktree file with the content to commit.
    ///
    /// If `hunks` is empty, this means the current content of the file should be committed.
    #[schemars(description = "The path of the file to commit")]
    pub path: String,
}

impl From<DiffSpec> for but_core::DiffSpec {
    fn from(spec: DiffSpec) -> Self {
        but_core::DiffSpec {
            previous_path: spec.previous_path.map(BString::from),
            path: BString::from(spec.path),
            hunk_headers: vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Context as _;
    use but_testsupport::Sandbox;

    use super::stack_id_for_branch_with_perm;

    #[test]
    fn stack_id_lookup_finds_non_checked_out_branch() -> anyhow::Result<()> {
        let env = Sandbox::init_scenario_with_target_and_default_settings("two-stacks")?;
        env.setup_metadata(&["A", "B"])?;

        let ctx = env.context()?;
        let guard = ctx.shared_worktree_access();
        let (expected_stack_id, branch_name) = {
            let (_repo, workspace, _db) =
                ctx.workspace_and_db_with_perm(guard.read_permission())?;
            let branch_ref = workspace
                .stacks
                .iter()
                .flat_map(|stack| stack.segments.iter())
                .find(|segment| !segment.is_entrypoint)
                .and_then(|segment| segment.ref_name().map(ToOwned::to_owned))
                .context("expected a non-entrypoint branch in the workspace")?;
            let stack_id = workspace
                .find_segment_and_stack_by_refname(branch_ref.as_ref())
                .and_then(|(stack, _segment)| stack.id)
                .context("expected non-entrypoint branch to have a stack id")?;
            (stack_id, branch_ref.shorten().to_string())
        };

        let stack_id = stack_id_for_branch_with_perm(&ctx, guard.read_permission(), &branch_name)?;
        assert_eq!(stack_id, Some(expected_stack_id));

        Ok(())
    }
}
