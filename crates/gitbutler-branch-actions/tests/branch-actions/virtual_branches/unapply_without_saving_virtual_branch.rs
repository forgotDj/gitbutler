use super::*;

#[test]
fn should_unapply_diff() {
    let Test { repo, ctx, .. } = &mut Test::default();

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::set_base_branch(
        ctx,
        &"refs/remotes/origin/master".parse().unwrap(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);

    // write some
    std::fs::write(repo.path().join("file.txt"), "content").unwrap();

    let mut guard = ctx.exclusive_worktree_access();
    let _stack_entry = gitbutler_branch_actions::create_virtual_branch(
        ctx,
        &BranchCreateRequest::default(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);
    let stacks = stack_details(ctx);
    let c = super::create_commit(ctx, stacks[0].0, "asdf");
    assert!(c.is_ok());

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::unapply_stack(ctx, guard.write_permission(), stacks[0].0, Vec::new())
        .unwrap();
    drop(guard);

    let stacks = stack_details(ctx);
    assert_eq!(stacks.len(), 0);
    assert!(!repo.path().join("file.txt").exists());

    assert_worktree_clean(repo.path());

    let refnames = repo.references();
    assert!(!refnames.contains(&"refs/gitbutler/name".to_string()));
}

/// Regression test: unapplying a stack must not re-introduce files from an old
/// `workspace_base` ancestor that are absent from both the current workspace and
/// the unapplied stack's head tree.
///
/// Setup:
///   T1  (old target) — has `ghost.txt`
///   T2  (new target) — `ghost.txt` deleted by target itself
///   Stack R (remaining) — branched from T1, *explicitly* deletes `ghost.txt`,
///                         so R_head tree does NOT contain it. Because R branches
///                         from T1, merge_base(R_head, T2) = T1 (has `ghost.txt`).
///   Stack U (unapplied) — branched from T2, never touches `ghost.txt`.
///
/// With the old code (base=U_head, theirs=workspace_base=T1):
///   - `ghost.txt`: base=absent, ours=absent, theirs=present → ADDED by merge ← BUG
///   - The workspace commit (T2 + R) correctly has no `ghost.txt`, so git status
///     reports it as untracked—a spurious uncommitted change.
///
/// With the fix (base=HEAD=workspace_commit, theirs=remerged=T2+R):
///   - All three agree `ghost.txt` is absent → correctly absent after unapply.
#[test]
fn unapply_with_integrated_commits_no_spurious_uncommitted_changes() {
    // cv3 = false routes unapply through the 3-way merge else-branch, which is
    // where the bug lived (base=stack_head, theirs=workspace_base ancestor).
    let Test { repo, ctx, .. } = &mut Test::new_with_settings(|settings| {
        settings.feature_flags.cv3 = false;
    });

    // ── T1: old target has ghost.txt ─────────────────────────────────────────
    std::fs::write(repo.path().join("ghost.txt"), "I should not come back").unwrap();
    repo.commit_all("T1: add ghost.txt");
    repo.push();

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::set_base_branch(
        ctx,
        &"refs/remotes/origin/master".parse().unwrap(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);

    // ── Stack R: branched from T1, explicitly deletes ghost.txt ──────────────
    // R's HEAD tree must NOT contain ghost.txt so the workspace commit is clean,
    // but merge_base(R_head, T2) will still resolve to T1 (which has ghost.txt).
    std::fs::remove_file(repo.path().join("ghost.txt")).unwrap();
    std::fs::write(repo.path().join("r-file.txt"), "stack R work").unwrap();
    let mut guard = ctx.exclusive_worktree_access();
    let stack_r = gitbutler_branch_actions::create_virtual_branch(
        ctx,
        &BranchCreateRequest {
            name: Some("stack-r".to_string()),
            ..Default::default()
        },
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);
    create_commit(ctx, stack_r.id, "stack-r: delete ghost.txt, add r-file.txt").unwrap();

    // ── T2: advance remote master, deleting ghost.txt ────────────────────────
    let local_repo = open_repo(repo.path()).unwrap();
    let parent = local_repo
        .find_reference("refs/remotes/origin/master")
        .unwrap()
        .peel_to_id()
        .unwrap()
        .detach();
    let t2 = commit_without_signature_gix(
        &local_repo,
        None,
        signature_gix(SignaturePurpose::Author),
        signature_gix(SignaturePurpose::Committer),
        "T2: delete ghost.txt".into(),
        local_repo.empty_tree().id,
        &[parent],
        None,
    )
    .unwrap();
    local_repo
        .reference(
            "refs/remotes/origin/master",
            t2,
            PreviousValue::Any,
            "test: advance remote tracking branch",
        )
        .unwrap();

    // Advance the stored target SHA to T2 WITHOUT rebasing stack R.
    // Stack R remains branched from T1, so workspace_base = merge_base(R_head, T2) = T1.
    {
        let mut guard = ctx.exclusive_worktree_access();
        let mut meta = ctx.legacy_meta_mut(guard.write_permission()).unwrap();
        let mut target = meta.data().default_target.clone().unwrap();
        target.sha = t2;
        meta.set_default_target(target).unwrap();
    }

    // ── Stack U: created after T2, never touches ghost.txt ───────────────────
    std::fs::write(repo.path().join("u-file.txt"), "stack U work").unwrap();
    let mut guard = ctx.exclusive_worktree_access();
    let stack_u = gitbutler_branch_actions::create_virtual_branch(
        ctx,
        &BranchCreateRequest {
            name: Some("stack-u".to_string()),
            ..Default::default()
        },
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);
    create_commit(ctx, stack_u.id, "stack-u: add u-file.txt").unwrap();

    // ── Unapply stack U ───────────────────────────────────────────────────────
    // With the old code: workspace_base = T1 tree (has ghost.txt).
    // Since neither U_head nor cwdt contain ghost.txt, the merge adds it. BUG.
    // With the fix: base = HEAD (no ghost.txt), theirs = remerged T2+R (no ghost.txt). OK.
    let stacks = stack_details(ctx);
    let stack_u_id = stacks
        .iter()
        .find(|s| s.1.derived_name == "stack-u")
        .map(|s| s.0)
        .unwrap();

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::unapply_stack(ctx, guard.write_permission(), stack_u_id, Vec::new())
        .unwrap();
    drop(guard);

    // No uncommitted changes should appear — ghost.txt must not be re-introduced.
    assert_worktree_clean(repo.path());
    assert!(
        !repo.path().join("ghost.txt").exists(),
        "ghost.txt should not have been re-introduced by the unapply merge"
    );
}

fn assert_worktree_clean(path: &std::path::Path) {
    let repo = open_repo(path).unwrap();
    let changes = but_core::diff::worktree_changes(&repo).unwrap().changes;
    assert!(
        changes.is_empty(),
        "Expected no uncommitted changes, but got: {changes:?}"
    );
}
