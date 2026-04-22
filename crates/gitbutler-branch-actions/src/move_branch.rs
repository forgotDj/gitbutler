use anyhow::{Context as _, Result};
use but_core::ref_metadata::StackId;
use but_ctx::{Context, access::RepoExclusive};
use but_rebase::{Rebase, RebaseStep};
use but_workspace::legacy::stack_ext::StackExt;
use gitbutler_reference::{LocalRefname, Refname};
use gitbutler_workspace::branch_trees::{WorkspaceState, update_uncommitted_changes};
use gix::refs::transaction::PreviousValue;
use serde::Serialize;

use crate::{BranchManagerExt, VirtualBranchesExt as _};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveBranchResult {
    /// The stacks that were deleted as a result of the move.
    /// This happens in the case of moving the last branch out of a stack.
    pub deleted_stacks: Vec<StackId>,
    /// These are the stacks that were unapplied as a result of the move.
    pub unapplied_stacks: Vec<StackId>,
}

/// Tears off a branch from the source stack, creating a new stack for it.
pub(crate) fn tear_off_branch(
    ctx: &Context,
    source_stack_id: StackId,
    subject_branch_name: &str,
    perm: &mut RepoExclusive,
) -> Result<MoveBranchResult> {
    let old_workspace = WorkspaceState::create(ctx, perm.read_permission())?;
    let repo = ctx.repo.get()?;

    let source_stack = ctx
        .virtual_branches()
        .get_stack_in_workspace(source_stack_id)?;
    let source_merge_base = source_stack.merge_base(ctx)?;

    let (subject_branch_steps, deleted_stacks) = extract_and_rebase_source_branch(
        ctx,
        source_stack_id,
        subject_branch_name,
        &repo,
        source_stack,
        source_merge_base,
    )?;

    // Create a new stack for the torn-off branch
    let mut new_stack_rebase = Rebase::new(&repo, source_merge_base, None)?;
    new_stack_rebase.steps(subject_branch_steps)?;
    new_stack_rebase.rebase_noops(false);
    let new_stack_rebase_output = new_stack_rebase.rebase()?;

    let subject_branch_reference_spec = new_stack_rebase_output
        .clone()
        .references
        .into_iter()
        .find(|r| r.reference.to_string() == subject_branch_name)
        .context("subject branch not found in rebase output")?;

    let subject_branch_reference_name = format!("refs/heads/{subject_branch_name}");
    repo.reference(
        subject_branch_reference_name.clone(),
        subject_branch_reference_spec.commit_id,
        PreviousValue::Any,
        format!("Creating branch {subject_branch_name}"),
    )?;

    let new_workspace = WorkspaceState::create(ctx, perm.read_permission())?;
    let _ = update_uncommitted_changes(ctx, old_workspace, new_workspace, perm);
    crate::integration::update_workspace_commit_with_vb_state(&ctx.virtual_branches(), ctx, false)
        .context("failed to update gitbutler workspace")?;

    let branch_manager = ctx.branch_manager();
    let (_, unapplied_stacks, _unapplied_stack_shortnames) = branch_manager
        .create_virtual_branch_from_branch(
            &Refname::Local(LocalRefname::new(subject_branch_name, None)),
            None,
            None,
            perm,
        )?;

    Ok(MoveBranchResult {
        deleted_stacks,
        unapplied_stacks,
    })
}

/// Extracts the steps corresponding to the branch to move, and rebases the source stack without those steps.
fn extract_and_rebase_source_branch(
    ctx: &Context,
    source_stack_id: StackId,
    subject_branch_name: &str,
    repository: &gix::Repository,
    source_stack: gitbutler_stack::Stack,
    source_merge_base: gix::ObjectId,
) -> Result<(Vec<RebaseStep>, Vec<StackId>), anyhow::Error> {
    let (subject_branch_steps, new_source_steps) =
        extract_branch_steps(ctx, repository, &source_stack, subject_branch_name)?;
    let mut deleted_stacks = Vec::new();
    let mut source_stack = source_stack;

    if new_source_steps.is_empty() {
        // If there are no other branches left in the source stack, delete the stack.
        ctx.virtual_branches()
            .delete_branch_entry(&source_stack_id)?;
        deleted_stacks.push(source_stack_id);
    } else {
        // Rebase the source stack without the extracted branch steps
        let mut source_stack_rebase = Rebase::new(repository, source_merge_base, None)?;
        source_stack_rebase.steps(new_source_steps)?;
        source_stack_rebase.rebase_noops(false);
        let source_rebase_result = source_stack_rebase.rebase()?;
        let new_source_head = repository.find_commit(source_rebase_result.top_commit)?;

        source_stack.remove_branch(ctx, subject_branch_name)?;

        source_stack.set_stack_head(
            &mut ctx.virtual_branches(),
            repository,
            new_source_head.id().detach(),
        )?;

        source_stack.set_heads_from_rebase_output(ctx, source_rebase_result.clone().references)?;
    }
    Ok((subject_branch_steps, deleted_stacks))
}

/// Splits the source stack's rebase steps into two groups: those belonging to
/// `subject_branch_name` and those that remain.
///
/// Steps are partitioned by scanning for a `Reference` marker whose name matches
/// the subject branch (either as a Git ref or a virtual ref). All steps between
/// consecutive Reference markers are considered part of that branch. Returns
/// `(subject_steps, remaining_steps)`, both in execution order (oldest first).
fn extract_branch_steps(
    ctx: &Context,
    repository: &gix::Repository,
    source_stack: &gitbutler_stack::Stack,
    subject_branch_name: &str,
) -> Result<(Vec<RebaseStep>, Vec<RebaseStep>)> {
    let source_steps = source_stack.as_rebase_steps_rev(ctx)?;
    let mut new_source_steps = Vec::new();
    let mut subject_branch_steps = Vec::new();
    let mut inside_branch = false;
    let branch_ref = repository
        .try_find_reference(subject_branch_name)?
        .ok_or_else(|| {
            anyhow::anyhow!("Source branch '{subject_branch_name}' not found in repository")
        })?;
    let branch_ref_name = branch_ref.name().to_owned();

    for step in source_steps {
        if let RebaseStep::Reference(but_core::Reference::Git(name)) = &step {
            if *name == branch_ref_name {
                inside_branch = true;
            } else if inside_branch {
                inside_branch = false;
            }
        }

        if let RebaseStep::Reference(but_core::Reference::Virtual(name)) = &step {
            if *name == subject_branch_name {
                inside_branch = true;
            } else if inside_branch {
                inside_branch = false;
            }
        }

        if !inside_branch {
            // Not inside the source branch, keep the step as is
            new_source_steps.push(step);
            continue;
        }

        subject_branch_steps.push(step);
    }

    new_source_steps.reverse();
    subject_branch_steps.reverse();

    Ok((subject_branch_steps, new_source_steps))
}
