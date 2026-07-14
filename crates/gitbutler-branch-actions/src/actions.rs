use anyhow::{Context as _, Result};
use but_ctx::{Context, access::RepoExclusive};
use but_workspace::legacy::{stack_heads_info, ui};
use gitbutler_branch::BranchCreateRequest;
use gitbutler_operating_modes::ensure_open_workspace_mode;
use gitbutler_oplog::{
    OplogExt,
    entry::{OperationKind, SnapshotDetails},
};
use gitbutler_reference::RemoteRefname;

use crate::{base, base::BaseBranch, branch_manager::BranchManagerExt};

pub fn create_virtual_branch(
    ctx: &Context,
    create: &BranchCreateRequest,
    perm: &mut RepoExclusive,
) -> Result<ui::StackEntryNoOpt> {
    ctx.verify(perm)?;
    ensure_open_workspace_mode(ctx, perm.read_permission())
        .context("Creating a branch requires open workspace mode")?;
    let branch_manager = ctx.branch_manager();
    let stack = branch_manager.create_virtual_branch(create, perm)?;
    let repo = ctx.repo.get()?;
    Ok(ui::StackEntryNoOpt {
        id: stack.id,
        heads: stack_heads_info(&stack, &repo)?,
        tip: stack.head_oid(ctx)?,
        order: Some(stack.order),
        is_checked_out: false,
    })
}

pub fn set_base_branch(
    ctx: &Context,
    target_branch: &RemoteRefname,
    perm: &mut RepoExclusive,
) -> Result<BaseBranch> {
    let _ = ctx.create_snapshot(SnapshotDetails::new(OperationKind::SetBaseBranch), perm);
    base::set_base_branch(ctx, perm.read_permission(), target_branch)
}

pub fn set_target_push_remote(ctx: &mut Context, push_remote: &str) -> Result<()> {
    base::set_target_push_remote(ctx, push_remote)
}

pub fn push_base_branch(ctx: &Context, with_force: bool) -> Result<()> {
    base::push(ctx, with_force)
}

pub(crate) trait Verify {
    fn verify(&self, perm: &mut RepoExclusive) -> Result<()>;
}

impl Verify for Context {
    fn verify(&self, perm: &mut RepoExclusive) -> Result<()> {
        crate::integration::verify_branch(self, perm)
    }
}
