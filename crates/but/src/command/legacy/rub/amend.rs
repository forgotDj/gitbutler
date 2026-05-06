use but_core::DiffSpec;
use but_ctx::{Context, access::RepoExclusive};
use but_hunk_assignment::HunkAssignment;
use but_rebase::graph_rebase::{Editor, LookupStep as _};
use gitbutler_branch_actions::update_workspace_commit;
use gix::ObjectId;
use nonempty::NonEmpty;

use crate::{
    theme::{self, Paint},
    utils::{OutputChannel, shorten_object_id, split_short_id},
};

pub(crate) fn uncommitted_to_commit_with_perm(
    ctx: &mut Context,
    hunk_assignments: NonEmpty<&HunkAssignment>,
    description: String,
    oid: ObjectId,
    out: &mut OutputChannel,
    perm: &mut RepoExclusive,
) -> anyhow::Result<()> {
    let diff_specs: Vec<DiffSpec> = hunk_assignments
        .into_iter()
        .map(|assignment| assignment.to_owned().into())
        .collect();

    let new_commit = amend_diff_specs(ctx, diff_specs, oid, perm)?;
    update_workspace_commit(ctx, false)?;
    if let Some(out) = out.for_human() {
        let repo = ctx.repo.get()?;
        let new_commit = new_commit
            .map(|c| {
                let short = shorten_object_id(&repo, c);
                let (lead, rest) = split_short_id(&short, 2);
                let t = theme::get();
                format!("{}{}", t.cli_id.paint(lead), t.cli_id.paint(rest))
            })
            .unwrap_or_default();
        writeln!(out, "Amended {description} → {new_commit}")?;
    } else if let Some(out) = out.for_json() {
        out.write_value(serde_json::json!({
            "ok": true,
            "new_commit_id": new_commit.map(|c| c.to_string()),
        }))?;
    }
    Ok(())
}

fn amend_diff_specs(
    ctx: &mut Context,
    diff_specs: Vec<DiffSpec>,
    oid: ObjectId,
    perm: &mut RepoExclusive,
) -> anyhow::Result<Option<ObjectId>> {
    let mut meta = ctx.meta()?;
    let (repo, mut ws, _) = ctx.workspace_mut_and_db_with_perm(perm)?;
    let editor = Editor::create(&mut ws, &mut meta, &repo)?;
    let outcome = but_workspace::commit::commit_amend(
        editor,
        oid,
        but_workspace::flatten_diff_specs(diff_specs),
        ctx.settings.context_lines,
    )?;
    if !outcome.rejected_specs.is_empty() {
        tracing::warn!(
            ?outcome.rejected_specs,
            "Failed to commit at least one hunk"
        );
    }
    let new_commit = outcome
        .commit_selector
        .map(|selector| outcome.rebase.lookup_pick(selector))
        .transpose()?;
    outcome.rebase.materialize()?;
    Ok(new_commit)
}
