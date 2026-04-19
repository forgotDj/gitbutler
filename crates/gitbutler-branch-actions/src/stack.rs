use anyhow::{Context as _, Result};
use but_core::RepositoryExt;
use but_ctx::Context;
use gitbutler_git::{GitContextExt as _, PushResult};
use gitbutler_operating_modes::ensure_open_workspace_mode;
use gitbutler_oplog::{
    OplogExt, SnapshotExt,
    entry::{OperationKind, SnapshotDetails},
};
use gitbutler_reference::{RemoteRefname, normalize_branch_name};
use gitbutler_repo::hooks;
use gitbutler_stack::{PatchReferenceUpdate, Stack, StackBranch, StackId, Target};
use serde::{Deserialize, Serialize};

use crate::{VirtualBranchesExt, actions::Verify, r#virtual::IsCommitIntegrated};

/// Adds a new "series/branch" to the Stack.
/// This is in fact just creating a new  GitButler patch reference (head) and associates it with the stack.
/// The name cannot be the same as existing git references or existing patch references.
/// The target must reference a commit (or change) that is part of the stack.
/// The branch name must be a valid reference name (i.e. can not contain spaces, special characters etc.)
///
/// When creating heads, it is possible to have multiple heads that point to the same patch/commit.
/// If this is the case, the order can be disambiguated by specifying the `preceding_head`.
/// If there are multiple heads pointing to the same patch and `preceding_head` is not specified,
/// that means the new head will be first in order for that patch.
/// The argument `preceding_head` is only used if there are multiple heads that point to the same patch, otherwise it is ignored.
pub fn create_branch(ctx: &mut Context, stack_id: StackId, req: CreateSeriesRequest) -> Result<()> {
    let mut guard = ctx.exclusive_worktree_access();
    ctx.verify(guard.write_permission())?;
    let _ = ctx.snapshot_create_dependent_branch(&req.name, guard.write_permission());
    ensure_open_workspace_mode(ctx, guard.read_permission())
        .context("Requires an open workspace mode")?;
    let mut stack = ctx.virtual_branches().get_stack(stack_id)?;
    let normalized_head_name = normalize_branch_name(&req.name)?;
    let repo = ctx.repo.get()?;
    // If target_patch is None, create a new head that points to the top of the stack (most recent patch)
    if let Some(target_patch) = req.target_patch {
        let target_oid = gix::ObjectId::from_hex(target_patch.as_bytes())?;
        stack.add_series(
            ctx,
            StackBranch::new(target_oid, normalized_head_name, &repo)?,
            req.preceding_head,
        )
    } else {
        stack.add_series_top_of_stack(ctx, normalized_head_name)
    }
}

/// Request to create a new series in a stack
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CreateSeriesRequest {
    /// Name of the new series
    pub name: String,
    /// The target patch (head) to create these series for. If let None, the new series will be at the top of the stack
    pub target_patch: Option<String>,
    /// The name of the series that preceded the newly created series.
    /// This is used to disambiguate the order when they point to the same patch
    pub preceding_head: Option<String>,
}

/// Removes series grouping from the Stack. This will not touch the patches / commits contained in the series.
/// The very last branch (reference) cannot be removed (A Stack must always contain at least one reference)
/// If there were commits/changes that were *only* referenced by the removed branch,
/// those commits are moved to the branch underneath it (or more accurately, the preceding it)
pub fn remove_branch(ctx: &mut Context, stack_id: StackId, branch_name: &str) -> Result<()> {
    let mut guard = ctx.exclusive_worktree_access();
    ctx.verify(guard.write_permission())?;
    let _ = ctx.snapshot_remove_dependent_branch(branch_name, guard.write_permission());
    ensure_open_workspace_mode(ctx, guard.read_permission())
        .context("Requires an open workspace mode")?;
    let mut stack = ctx.virtual_branches().get_stack(stack_id)?;
    stack.remove_branch(ctx, branch_name)
}

/// Updates the name an existing branch and resets the pr_number to None.
/// Same invariants as `create_branch` apply.
///
/// Returns the new normalized name of the branch.
pub fn update_branch_name(
    ctx: &mut Context,
    stack_id: StackId,
    branch_name: String,
    new_name: String,
) -> Result<String> {
    let mut guard = ctx.exclusive_worktree_access();
    update_branch_name_with_perm(
        ctx,
        stack_id,
        branch_name,
        new_name,
        guard.write_permission(),
    )
}

pub fn update_branch_name_with_perm(
    ctx: &mut Context,
    stack_id: StackId,
    branch_name: String,
    new_name: String,
    perm: &mut but_core::sync::RepoExclusive,
) -> Result<String> {
    ctx.verify(perm)?;
    let _ = ctx.snapshot_update_dependent_branch_name(&branch_name, perm);
    ensure_open_workspace_mode(ctx, perm.read_permission())
        .context("Requires an open workspace mode")?;
    let mut stack = ctx.virtual_branches().get_stack(stack_id)?;
    let normalized_head_name = normalize_branch_name(&new_name)?;
    stack.update_branch(
        ctx,
        branch_name,
        &PatchReferenceUpdate {
            name: Some(normalized_head_name.clone()),
        },
    )?;
    Ok(normalized_head_name)
}

/// Sets the forge identifier for a given series/branch. Existing value is overwritten.
///
/// # Errors
/// This method will return an error if:
///  - The series does not exist
///  - The stack can't be found
///  - The stack has not been initialized
///  - The project is not in workspace mode
///  - Persisting the changes failed
pub fn update_branch_pr_number(
    ctx: &mut Context,
    stack_id: StackId,
    branch_name: String,
    pr_number: Option<usize>,
) -> Result<()> {
    let mut guard = ctx.exclusive_worktree_access();
    ctx.verify(guard.write_permission())?;
    let _ = ctx.create_snapshot(
        SnapshotDetails::new(OperationKind::UpdateDependentBranchPrNumber),
        guard.write_permission(),
    );
    ensure_open_workspace_mode(ctx, guard.read_permission())
        .context("Requires an open workspace mode")?;
    let mut stack = ctx.virtual_branches().get_stack(stack_id)?;
    stack.set_pr_number(ctx, &branch_name, pr_number)
}

/// Pushes all series in the stack to the remote.
/// This operation will error out if the target has no push remote configured.
pub fn push_stack(
    ctx: &mut Context,
    stack_id: StackId,
    with_force: bool,
    skip_force_push_protection: bool,
    branch_limit: String,
    run_hooks: bool,
    push_opts: Vec<but_gerrit::PushFlag>,
) -> Result<PushResult> {
    let mut guard = ctx.exclusive_worktree_access();
    ctx.verify(guard.write_permission())?;
    ensure_open_workspace_mode(ctx, guard.read_permission())
        .context("Requires an open workspace mode")?;
    let virtual_branches = ctx.virtual_branches();
    let stack = virtual_branches.get_stack(stack_id)?;
    let default_target = virtual_branches.get_default_target()?;
    let push_env = PushStackEnv::new(ctx, &stack, default_target, skip_force_push_protection)?;

    // First fetch, because we dont want to push integrated series
    ctx.fetch(&push_env.remote_name, Some("push_stack".into()))?;
    let mut result = PushResult {
        remote: push_env.remote_name.clone(),
        branch_to_remote: vec![],
        branch_sha_updates: vec![],
    };
    let stop_after_branch = branch_limit;

    for branch in stack.branches() {
        let Some(prepared_branch) = prepare_branch_push(&branch, &push_env)? else {
            continue;
        };

        let should_stop = prepared_branch.branch_name == stop_after_branch;
        let pushed_branch = execute_branch_push(
            ctx,
            &stack,
            prepared_branch,
            &push_env,
            with_force,
            run_hooks,
            &push_opts,
        )?;
        append_push_result(&mut result, pushed_branch);
        if should_stop {
            break;
        }
    }

    Ok(result)
}

struct PushStackEnv {
    default_target: Target,
    gix_repo: gix::Repository,
    commit_graph_cache: Option<gix::commitgraph::Graph>,
    merge_base_id: gix::ObjectId,
    remote_name: String,
    gerrit_mode: bool,
    force_push_protection: bool,
    run_husky_hooks: bool,
}

impl PushStackEnv {
    fn new(
        ctx: &Context,
        stack: &Stack,
        default_target: Target,
        skip_force_push_protection: bool,
    ) -> Result<Self> {
        let remote_name = default_target.push_remote_name();
        let gix_repo = ctx.clone_repo_for_merging_non_persisting()?;
        let merge_base_id = gix_repo
            .merge_base(stack.head_oid(ctx)?, default_target.sha)?
            .detach();
        let commit_graph_cache = gix_repo.commit_graph_if_enabled()?;
        let gerrit_mode = gix_repo
            .git_settings()?
            .gitbutler_gerrit_mode
            .unwrap_or(false);

        Ok(Self {
            default_target,
            gix_repo,
            commit_graph_cache,
            merge_base_id,
            remote_name,
            gerrit_mode,
            force_push_protection: !skip_force_push_protection
                && ctx.legacy_project.force_push_protection,
            run_husky_hooks: ctx.legacy_project.husky_hooks_enabled,
        })
    }
}

struct GerritPushArgs {
    refspec: Option<String>,
    push_opts: Vec<String>,
}

struct PreparedBranchPush {
    branch_name: String,
    remote_refname: RemoteRefname,
    local_sha: gix::ObjectId,
    before_sha: gix::ObjectId,
}

struct PushedBranch {
    branch_name: String,
    remote_refname: gix::refs::FullName,
    before_sha: gix::ObjectId,
    after_sha: gix::ObjectId,
}

enum SkipBranchReason {
    Archived,
    HeadAtMergeBase,
    Integrated,
}

fn prepare_branch_push(
    branch: &StackBranch,
    push_env: &PushStackEnv,
) -> Result<Option<PreparedBranchPush>> {
    if branch.archived {
        log_skipped_branch(branch, SkipBranchReason::Archived);
        return Ok(None);
    }

    let local_sha = branch.head_oid(&push_env.gix_repo)?;
    if let Some(skip_reason) = skip_reason_for_branch(local_sha, push_env)? {
        log_skipped_branch(branch, skip_reason);
        return Ok(None);
    }

    let remote_refname = remote_refname_for_branch(branch, &push_env.remote_name)?;
    let before_sha = remote_before_sha(&push_env.gix_repo, &remote_refname)?;

    Ok(Some(PreparedBranchPush {
        branch_name: branch.name().to_owned(),
        remote_refname,
        local_sha,
        before_sha,
    }))
}

fn execute_branch_push(
    ctx: &mut Context,
    stack: &Stack,
    prepared_branch: PreparedBranchPush,
    push_env: &PushStackEnv,
    with_force: bool,
    run_hooks: bool,
    push_flags: &[but_gerrit::PushFlag],
) -> Result<PushedBranch> {
    let PreparedBranchPush {
        branch_name,
        remote_refname,
        local_sha,
        before_sha,
    } = prepared_branch;

    if run_hooks {
        run_pre_push_hook(push_env, local_sha, &remote_refname)?;
    }

    let gerrit_push_args = gerrit_push_args(push_env, local_sha, push_flags);
    let push_output = ctx.push(
        local_sha,
        &remote_refname,
        with_force,
        push_env.force_push_protection,
        gerrit_push_args.refspec,
        Some(Some(stack.id)),
        gerrit_push_args.push_opts,
    )?;

    maybe_record_gerrit_push_metadata(ctx, stack, push_env, &push_output)?;

    Ok(PushedBranch {
        branch_name,
        remote_refname: (&remote_refname).try_into()?,
        before_sha,
        after_sha: local_sha,
    })
}

fn skip_reason_for_branch(
    local_sha: gix::ObjectId,
    push_env: &PushStackEnv,
) -> Result<Option<SkipBranchReason>> {
    if local_sha == push_env.merge_base_id {
        return Ok(Some(SkipBranchReason::HeadAtMergeBase));
    }

    let mut graph = push_env
        .gix_repo
        .revision_graph(push_env.commit_graph_cache.as_ref());
    let mut check_commit =
        IsCommitIntegrated::new(&push_env.default_target, &push_env.gix_repo, &mut graph)?;
    if check_commit.is_integrated(local_sha)? {
        return Ok(Some(SkipBranchReason::Integrated));
    }

    Ok(None)
}

fn log_skipped_branch(branch: &StackBranch, skip_reason: SkipBranchReason) {
    match skip_reason {
        SkipBranchReason::Archived => {
            tracing::debug!(
                branch = branch.name(),
                "skipping archived branch for pushing"
            );
        }
        SkipBranchReason::HeadAtMergeBase => {
            tracing::debug!(
                branch = branch.name(),
                "nothing to push as head_oid == merge_base"
            );
        }
        SkipBranchReason::Integrated => {
            tracing::debug!(
                branch = branch.name(),
                "Skipping push for integrated branch"
            );
        }
    }
}

fn remote_before_sha(
    gix_repo: &gix::Repository,
    remote_refname: &RemoteRefname,
) -> Result<gix::ObjectId> {
    Ok(gix_repo
        .try_find_reference(&remote_refname.to_string())?
        .map(|mut reference| reference.peel_to_commit())
        .transpose()?
        .map(|commit| commit.id)
        .unwrap_or(gix_repo.object_hash().null()))
}

fn remote_refname_for_branch(branch: &StackBranch, remote_name: &str) -> Result<RemoteRefname> {
    branch
        .remote_reference(remote_name)
        .parse()
        .map_err(Into::into)
}

fn run_pre_push_hook(
    push_env: &PushStackEnv,
    local_sha: gix::ObjectId,
    remote_refname: &RemoteRefname,
) -> Result<()> {
    let remote = push_env
        .gix_repo
        .find_remote(push_env.remote_name.as_str())?;
    let url = remote
        .url(gix::remote::Direction::Push)
        .or_else(|| remote.url(gix::remote::Direction::Fetch))
        .map(|url| url.to_bstring().to_string())
        .with_context(|| format!("Remote named {} didn't have a URL", push_env.remote_name))?;

    match hooks::pre_push(
        &push_env.gix_repo,
        &push_env.remote_name,
        &url,
        local_sha,
        remote_refname,
        push_env.run_husky_hooks,
    )? {
        hooks::HookResult::Success | hooks::HookResult::NotConfigured => Ok(()),
        hooks::HookResult::Failure(error_data) => Err(anyhow::anyhow!(
            "pre-push hook failed: {}",
            error_data.error
        )),
    }
}

fn gerrit_push_args(
    push_env: &PushStackEnv,
    head: gix::ObjectId,
    push_flags: &[but_gerrit::PushFlag],
) -> GerritPushArgs {
    if push_env.gerrit_mode {
        GerritPushArgs {
            refspec: Some(format!(
                "{head}:refs/for/{}",
                push_env.default_target.branch.branch(),
            )),
            push_opts: push_flags.iter().map(|flag| flag.to_string()).collect(),
        }
    } else {
        GerritPushArgs {
            refspec: None,
            push_opts: vec![],
        }
    }
}

fn maybe_record_gerrit_push_metadata(
    ctx: &Context,
    stack: &Stack,
    push_env: &PushStackEnv,
    push_output: &str,
) -> Result<()> {
    if !push_env.gerrit_mode {
        return Ok(());
    }

    let push_output = but_gerrit::parse::push_output(push_output)?;
    let candidate_ids = stack.commits(ctx)?;
    but_gerrit::record_push_metadata(ctx, candidate_ids, push_output)
}

fn append_push_result(result: &mut PushResult, pushed_branch: PushedBranch) {
    result.branch_to_remote.push((
        pushed_branch.branch_name.clone(),
        pushed_branch.remote_refname,
    ));
    result.branch_sha_updates.push((
        pushed_branch.branch_name,
        pushed_branch.before_sha.to_string(),
        pushed_branch.after_sha.to_string(),
    ));
}
