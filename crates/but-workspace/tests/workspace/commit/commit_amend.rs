use anyhow::Result;
use but_core::DiffSpec;
use but_rebase::graph_rebase::{Editor, LookupStep as _};
use but_testsupport::git_status;
use but_workspace::commit::commit_amend;

use crate::ref_info::with_workspace_commit::utils::named_writable_scenario_with_description_and_graph as writable_scenario;

fn worktree_changes_as_specs(repo: &gix::Repository) -> Result<Vec<DiffSpec>> {
    Ok(but_core::diff::worktree_changes(repo)?
        .changes
        .into_iter()
        .map(DiffSpec::from)
        .collect())
}

/// Build DiffSpecs with populated hunk_headers, matching how the production
/// UI/CLI sends them. This is important because the production path always
/// includes hunk headers even when all hunks of a file are selected.
fn worktree_changes_as_specs_with_hunks(
    repo: &gix::Repository,
    context_lines: u32,
) -> Result<Vec<DiffSpec>> {
    let changes = but_core::diff::worktree_changes(repo)?;
    let mut specs = Vec::new();
    for change in &changes.changes {
        let mut spec = DiffSpec::from(change);
        if let Some(but_core::UnifiedPatch::Patch { hunks, .. }) =
            change.unified_patch(repo, context_lines)?
        {
            spec.hunk_headers = hunks.iter().map(but_core::HunkHeader::from).collect();
        }
        specs.push(spec);
    }
    Ok(specs)
}

#[test]
fn amend_commit_smoke_test() -> Result<()> {
    let (_tmp, graph, repo, mut _meta, _description) =
        writable_scenario("reword-three-commits", |_| {})?;
    let two_id = repo.rev_parse_single("two")?.detach();
    std::fs::write(
        repo.workdir_path("amended.txt").expect("non-bare"),
        "amended\n",
    )?;

    let mut ws = graph.into_workspace()?;
    let editor = Editor::create(&mut ws, &mut _meta, &repo)?;
    let outcome = commit_amend(editor, two_id, worktree_changes_as_specs(&repo)?, 0)?;

    assert!(outcome.rejected_specs.is_empty());
    let selector = outcome.commit_selector.expect("selector exists");
    let materialized = outcome.rebase.materialize()?;
    let rewritten_id = materialized.lookup_pick(selector)?;

    let rewritten_commit = repo.find_commit(rewritten_id)?;
    assert_eq!(rewritten_commit.message_raw()?, "commit two\n");
    let spec = format!("{rewritten_id}:amended.txt");
    let object_with_path = repo.rev_parse_single(spec.as_str())?;
    assert_eq!(object_with_path.object()?.kind, gix::objs::Kind::Blob);

    Ok(())
}

/// Amending uncommitted changes into an earlier commit when a later commit
/// also touches the same file should leave no uncommitted changes afterwards.
///
/// Scenario:
///   - "save 1" creates test.txt with 3 lines
///   - "partial 1" adds line 1.1 (partial commit)
///   - Uncommitted: adds line 1.2
///   - Amend line 1.2 into "save 1"
///
/// After amend, "partial 1" will conflict (rebased onto new "save 1"),
/// but there should be no remaining uncommitted changes.
#[test]
fn amend_into_earlier_commit_leaves_no_uncommitted_changes() -> Result<()> {
    let (_tmp, graph, repo, mut meta, _description) =
        writable_scenario("amend-with-partial-commit", |_| {})?;

    // Find the "save 1" commit (first commit on the stack, parent of "partial 1")
    let partial_1_id = repo.rev_parse_single("stack-1")?.detach();
    let partial_1_commit = repo.find_commit(partial_1_id)?;
    let save_1_id = partial_1_commit
        .parent_ids()
        .next()
        .expect("has parent")
        .detach();

    // Verify initial state: there should be uncommitted changes (line 1.2)
    let status_before = git_status(&repo)?;
    assert!(
        status_before.contains("test.txt"),
        "should have uncommitted changes to test.txt before amend, got: {status_before}"
    );

    let context_lines = 0;
    let mut ws = graph.into_workspace()?;
    let editor = Editor::create(&mut ws, &mut meta, &repo)?;
    let outcome = commit_amend(
        editor,
        save_1_id,
        worktree_changes_as_specs_with_hunks(&repo, context_lines)?,
        context_lines,
    )?;

    assert!(outcome.rejected_specs.is_empty());
    let _selector = outcome.commit_selector.expect("amend selector exists");
    let _materialized = outcome.rebase.materialize()?;

    // No uncommitted changes should remain: the change was amended into
    // "save 1", so it must not persist as an uncommitted worktree change.
    let status_after = git_status(&repo)?;
    assert_eq!(
        status_after, "",
        "expected no uncommitted changes after amending, but got:\n{status_after}"
    );

    Ok(())
}
