//! This crate implements various automations that GitButler can perform.

use std::{
    fmt::{Debug, Display},
    str::FromStr,
};

use but_core::{RefMetadata, WORKSPACE_REF_NAME, sync::RepoExclusive};
use but_ctx::Context;
use but_meta::virtual_branches_legacy_types::Target;
use but_workspace::legacy::ui::StackEntry;
use gitbutler_branch::BranchCreateRequest;
use serde::{Deserialize, Serialize};

mod action;
pub mod cli;
pub mod commit_format;
mod generate;
pub mod rename_branch;
pub mod reword;
mod simple;
mod workflow;
pub use action::{ActionListing, Source, list_actions};
use but_core::ref_metadata::StackId;
use strum::EnumString;
use uuid::Uuid;
pub use workflow::{WorkflowList, list_workflows};

pub fn handle_changes(
    ctx: &mut Context,
    change_summary: &str,
    external_prompt: Option<String>,
    handler: ActionHandler,
    source: Source,
    exclusive_stack: Option<StackId>,
) -> anyhow::Result<(Uuid, Outcome)> {
    match handler {
        ActionHandler::HandleChangesSimple => simple::handle_changes(
            ctx,
            change_summary,
            external_prompt,
            source,
            exclusive_stack,
        ),
    }
}

fn default_target_setting_if_none(ctx: &Context) -> anyhow::Result<()> {
    let workspace_ref: gix::refs::FullName = WORKSPACE_REF_NAME.try_into()?;
    let mut meta = ctx.legacy_meta()?;
    let workspace = meta.workspace(workspace_ref.as_ref())?;
    if workspace.target_ref.is_some() {
        return Ok(());
    }
    // Lets do the equivalent of `git symbolic-ref refs/remotes/origin/HEAD --short` to guess the default target.

    let repo = ctx.repo.get()?;
    let remote_name = repo
        .remote_default_name(gix::remote::Direction::Push)
        .ok_or_else(|| anyhow::anyhow!("No push remote set or more than one remote"))?
        .to_string();

    let mut head_ref = repo
        .find_reference(&format!("refs/remotes/{remote_name}/HEAD"))
        .map_err(|_| anyhow::anyhow!("No HEAD reference found for remote {remote_name}"))?;
    let target_ref_name = head_ref
        .target()
        .try_name()
        .ok_or_else(|| anyhow::anyhow!("Remote HEAD for {remote_name} is not symbolic"))?
        .to_owned();

    let head_commit = head_ref.peel_to_commit()?;

    let remote_refname =
        gitbutler_reference::RemoteRefname::from_str(&target_ref_name.as_bstr().to_string())?;

    let target = Target {
        branch: remote_refname,
        remote_url: "".to_string(),
        sha: head_commit.id,
        push_remote_name: None,
    };

    meta.set_default_target(target)?;
    ctx.invalidate_workspace_cache()?;
    Ok(())
}

#[expect(deprecated, reason = "calls but_workspace::legacy::stacks_v3")]
fn stacks(ctx: &Context, repo: &gix::Repository) -> anyhow::Result<Vec<StackEntry>> {
    let meta = ctx.legacy_meta()?;
    but_workspace::legacy::stacks_v3(
        repo,
        &meta,
        but_workspace::legacy::StacksFilter::InWorkspace,
        None,
    )
}

/// Returns the currently applied stacks, creating one if none exists.
fn stacks_creating_if_none(
    ctx: &Context,
    perm: &mut RepoExclusive,
) -> anyhow::Result<Vec<StackEntry>> {
    let repo = &*ctx.repo.get()?;
    let stacks = stacks(ctx, repo)?;
    if stacks.is_empty() {
        let template = but_core::branch::canned_refname(repo)?;
        let branch_name = but_core::branch::find_unique_refname(repo, template.as_ref())?;
        let create_req = BranchCreateRequest {
            name: Some(branch_name.shorten().to_string()),
            order: None,
        };
        let stack = gitbutler_branch_actions::create_virtual_branch(ctx, &create_req, perm)?;
        Ok(vec![stack.into()])
    } else {
        Ok(stacks)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, EnumString, Default)]
#[serde(rename_all = "camelCase")]
pub enum ActionHandler {
    #[default]
    HandleChangesSimple,
}

impl Display for ActionHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        Debug::fmt(self, f)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub updated_branches: Vec<UpdatedBranch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedBranch {
    pub stack_id: StackId,
    pub branch_name: String,
    pub new_commits: Vec<String>,
}
