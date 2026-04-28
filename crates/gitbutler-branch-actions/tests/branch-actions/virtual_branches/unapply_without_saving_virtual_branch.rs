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

    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true);
    let statuses = repo.local_repo.statuses(Some(&mut opts)).unwrap();
    assert!(statuses.is_empty());

    let refnames = repo
        .references()
        .into_iter()
        .filter_map(|reference| reference.name().map(|name| name.to_string()))
        .collect::<Vec<_>>();
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
    {
        let remote_url = repo
            .local_repo
            .find_remote("origin")
            .unwrap()
            .url()
            .unwrap()
            .to_string();
        let remote_path = repo.path().parent().unwrap().join(&remote_url);
        let remote_repo = git2::Repository::open_bare(&remote_path).unwrap();

        let parent = remote_repo
            .find_reference("refs/heads/master")
            .unwrap()
            .peel_to_commit()
            .unwrap();

        // T2 tree: preserve the parent tree and remove only ghost.txt.
        let parent_tree = parent.tree().unwrap();
        let mut tb = remote_repo.treebuilder(Some(&parent_tree)).unwrap();
        tb.remove("ghost.txt").unwrap();
        let tree_oid = tb.write().unwrap();
        let tree = remote_repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        remote_repo
            .commit(
                Some("refs/heads/master"),
                &sig,
                &sig,
                "T2: delete ghost.txt",
                &tree,
                &[&parent],
            )
            .unwrap();
    }
    repo.local_repo
        .find_remote("origin")
        .unwrap()
        .fetch(
            &["refs/heads/master:refs/remotes/origin/master"],
            None,
            None,
        )
        .unwrap();

    // Advance the stored target SHA to T2 WITHOUT rebasing stack R.
    // Stack R remains branched from T1, so workspace_base = merge_base(R_head, T2) = T1.
    let t2_sha = {
        let oid = repo
            .local_repo
            .find_reference("refs/remotes/origin/master")
            .unwrap()
            .target()
            .unwrap();
        let bytes: [u8; 20] = oid.as_bytes().try_into().unwrap();
        gix::ObjectId::Sha1(bytes)
    };
    {
        let mut guard = ctx.exclusive_worktree_access();
        let mut meta = ctx.legacy_meta_mut(guard.write_permission()).unwrap();
        let mut target = meta.data().default_target.clone().unwrap();
        target.sha = t2_sha;
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
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true);
    let statuses = repo.local_repo.statuses(Some(&mut opts)).unwrap();
    let status_entries: Vec<_> = statuses
        .iter()
        .map(|e| format!("{}: {:?}", e.path().unwrap_or("?"), e.status()))
        .collect();
    assert!(
        statuses.is_empty(),
        "Expected no uncommitted changes after unapplying stack, but got: {status_entries:?}"
    );
    assert!(
        !repo.path().join("ghost.txt").exists(),
        "ghost.txt should not have been re-introduced by the unapply merge"
    );
}
