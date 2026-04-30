use std::collections::HashMap;

use but_forge::ForgeReview;
use gitbutler_branch::BranchCreateRequest;
use gitbutler_branch_actions::upstream_integration::{
    BranchStatus, Resolution, ResolutionApproach, StackStatuses, UpstreamTreeStatus,
};
use gitbutler_reference::Refname;

use super::*;

#[test]
fn reapply_does_not_rebase_onto_updated_upstream() {
    let Test { repo, ctx, .. } = &mut Test::default();

    // make sure we have an undiscovered commit in the remote branch
    {
        fs::write(repo.path().join("file.txt"), "one").unwrap();
        fs::write(repo.path().join("another_file.txt"), "").unwrap();
        let first_commit_oid = repo.commit_all("first");
        fs::write(repo.path().join("file.txt"), "two").unwrap();
        repo.commit_all("second");
        repo.push();
        repo.reset_hard(Some(first_commit_oid));
    }

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::set_base_branch(
        ctx,
        &"refs/remotes/origin/master".parse().unwrap(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);

    let mut stack_1_id = {
        // create a branch with some committed work
        let mut guard = ctx.exclusive_worktree_access();
        let stack_entry_1 = gitbutler_branch_actions::create_virtual_branch(
            ctx,
            &BranchCreateRequest::default(),
            guard.write_permission(),
        )
        .unwrap();
        drop(guard);
        fs::write(repo.path().join("another_file.txt"), "virtual").unwrap();

        super::create_commit(ctx, stack_entry_1.id, "virtual commit").unwrap();

        let stacks = stack_details(ctx);
        assert_eq!(stacks.len(), 1);
        assert_eq!(stacks[0].0, stack_entry_1.id);
        assert_eq!(stacks[0].1.branch_details[0].commits.len(), 1);

        stack_entry_1.id
    };

    let unapplied_branch = {
        // unapply first vbranch
        let mut guard = ctx.exclusive_worktree_access();
        let unapplied_branch = gitbutler_branch_actions::unapply_stack(
            ctx,
            guard.write_permission(),
            stack_1_id,
            Vec::new(),
        )
        .unwrap();
        drop(guard);

        assert_eq!(
            fs::read_to_string(repo.path().join("another_file.txt")).unwrap(),
            ""
        );
        assert_eq!(
            fs::read_to_string(repo.path().join("file.txt")).unwrap(),
            "one"
        );

        let stacks = stack_details(ctx);
        assert_eq!(stacks.len(), 0);

        Refname::from_str(&unapplied_branch).unwrap()
    };

    {
        // fetch remote
        gitbutler_branch_actions::integrate_upstream(ctx, &[], None, &Default::default()).unwrap();

        // branch is still unapplied
        let stacks = stack_details(ctx);
        assert_eq!(stacks.len(), 0);

        assert_eq!(
            fs::read_to_string(repo.path().join("another_file.txt")).unwrap(),
            ""
        );
        assert_eq!(
            fs::read_to_string(repo.path().join("file.txt")).unwrap(),
            "two"
        );
    }

    {
        // apply first vbranch again
        let mut guard = ctx.exclusive_worktree_access();
        let outcome = gitbutler_branch_actions::create_virtual_branch_from_branch_with_perm(
            ctx,
            &unapplied_branch,
            None,
            guard.write_permission(),
        )
        .unwrap();
        drop(guard);

        stack_1_id = outcome.0;

        // Re-applying an unapplied branch restores its saved branch state as-is.
        // The current apply path does not rebase that branch onto a newer upstream.
        let stacks = stack_details(ctx);
        assert_eq!(stacks.len(), 1);
        assert_eq!(stacks[0].0, stack_1_id);
        assert_eq!(stacks[0].1.branch_details[0].commits.len(), 1);
        assert!(!stacks[0].1.branch_details[0].is_conflicted);

        assert_eq!(
            fs::read_to_string(repo.path().join("another_file.txt")).unwrap(),
            "virtual"
        );

        assert_eq!(
            fs::read_to_string(repo.path().join("file.txt")).unwrap(),
            "one"
        );
    }
}

#[test]
fn upstream_integration_status_without_review_map() {
    let Test { repo, ctx, .. } = &mut Test::default();

    // Setup: Create a remote branch with commits
    {
        fs::write(repo.path().join("file.txt"), "initial").unwrap();
        let first_commit_oid = repo.commit_all("initial commit");
        fs::write(repo.path().join("file.txt"), "second").unwrap();
        repo.commit_all("second commit");
        repo.push();
        repo.reset_hard(Some(first_commit_oid));
    }

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::set_base_branch(
        ctx,
        &"refs/remotes/origin/master".parse().unwrap(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);

    // Create a virtual branch with a commit
    let stack_id = {
        let mut guard = ctx.exclusive_worktree_access();
        let stack_entry = gitbutler_branch_actions::create_virtual_branch(
            ctx,
            &BranchCreateRequest {
                name: Some("feature-branch".to_string()),
                ..Default::default()
            },
            guard.write_permission(),
        )
        .unwrap();
        drop(guard);

        fs::write(repo.path().join("feature-file.txt"), "feature work").unwrap();
        super::create_commit(ctx, stack_entry.id, "feature commit").unwrap();

        stack_entry.id
    };

    let empty_review_map = HashMap::new();
    let statuses =
        gitbutler_branch_actions::upstream_integration_statuses(ctx, None, &empty_review_map)
            .unwrap();

    match statuses {
        StackStatuses::UpdatesRequired {
            statuses,
            worktree_conflicts,
        } => {
            assert_eq!(statuses.len(), 1);
            assert_eq!(statuses[0].0, Some(stack_id));
            assert_eq!(statuses[0].1.tree_status, UpstreamTreeStatus::Empty);
            assert_eq!(statuses[0].1.branch_statuses.len(), 1);
            assert_eq!(statuses[0].1.branch_statuses[0].name, "feature-branch");
            assert_eq!(
                statuses[0].1.branch_statuses[0].status,
                BranchStatus::SafelyUpdatable
            );
            assert!(worktree_conflicts.is_empty());
        }
        StackStatuses::UpToDate => panic!("Expected UpdatesRequired status"),
    }
}

#[test]
fn upstream_integration_status_with_merged_pr() {
    let Test { repo, ctx, .. } = &mut Test::default();

    // Setup: Create a remote branch with commits
    {
        fs::write(repo.path().join("file.txt"), "initial").unwrap();
        let first_commit_oid = repo.commit_all("initial commit");
        fs::write(repo.path().join("file.txt"), "second").unwrap();
        repo.commit_all("second commit");
        repo.push();
        repo.reset_hard(Some(first_commit_oid));
    }

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::set_base_branch(
        ctx,
        &"refs/remotes/origin/master".parse().unwrap(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);

    // Create a virtual branch with a commit
    let (stack_id, commit_id) = {
        let mut guard = ctx.exclusive_worktree_access();
        let stack_entry = gitbutler_branch_actions::create_virtual_branch(
            ctx,
            &BranchCreateRequest {
                name: Some("feature-branch".to_string()),
                ..Default::default()
            },
            guard.write_permission(),
        )
        .unwrap();
        drop(guard);

        fs::write(repo.path().join("feature-file.txt"), "feature work").unwrap();
        let commit_id = super::create_commit(ctx, stack_entry.id, "feature commit").unwrap();

        (stack_entry.id, commit_id)
    };

    let mut review_map = HashMap::new();
    review_map.insert(
        "feature-branch".to_string(),
        ForgeReview {
            html_url: "https://github.com/test/repo/pull/1".to_string(),
            number: 1,
            title: "Feature PR".to_string(),
            body: Some("Description".to_string()),
            author: None,
            labels: vec![],
            draft: false,
            source_branch: "feature-branch".to_string(),
            target_branch: "master".to_string(),
            sha: commit_id.to_string(),
            created_at: Some("2024-01-01T00:00:00Z".to_string()),
            modified_at: Some("2024-01-02T00:00:00Z".to_string()),
            merged_at: Some("2024-01-03T00:00:00Z".to_string()),
            closed_at: None,
            repository_ssh_url: None,
            repository_https_url: None,
            repo_owner: None,
            reviewers: vec![],
            unit_symbol: "#".to_string(),
            last_sync_at: chrono::NaiveDateTime::parse_from_str(
                "2024-01-04 23:56:04",
                "%Y-%m-%d %H:%M:%S",
            )
            .unwrap(),
        },
    );

    let statuses =
        gitbutler_branch_actions::upstream_integration_statuses(ctx, None, &review_map).unwrap();

    match statuses {
        StackStatuses::UpdatesRequired {
            statuses,
            worktree_conflicts,
        } => {
            assert_eq!(statuses.len(), 1);
            assert_eq!(statuses[0].0, Some(stack_id));
            assert_eq!(statuses[0].1.tree_status, UpstreamTreeStatus::Empty);
            assert_eq!(statuses[0].1.branch_statuses.len(), 1);
            assert_eq!(statuses[0].1.branch_statuses[0].name, "feature-branch");
            assert_eq!(
                statuses[0].1.branch_statuses[0].status,
                BranchStatus::Integrated
            );
            assert!(worktree_conflicts.is_empty());
        }
        StackStatuses::UpToDate => panic!("Expected UpdatesRequired status"),
    }
}

#[test]
fn upstream_integration_status_with_merged_pr_mismatched_head() {
    let Test { repo, ctx, .. } = &mut Test::default();

    // Setup: Create a remote branch with commits
    {
        fs::write(repo.path().join("file.txt"), "initial").unwrap();
        let first_commit_oid = repo.commit_all("initial commit");
        fs::write(repo.path().join("file.txt"), "second").unwrap();
        repo.commit_all("second commit");
        repo.push();
        repo.reset_hard(Some(first_commit_oid));
    }

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::set_base_branch(
        ctx,
        &"refs/remotes/origin/master".parse().unwrap(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);

    // Create a virtual branch with a commit
    let stack_id = {
        let mut guard = ctx.exclusive_worktree_access();
        let stack_entry = gitbutler_branch_actions::create_virtual_branch(
            ctx,
            &BranchCreateRequest {
                name: Some("feature-branch".to_string()),
                ..Default::default()
            },
            guard.write_permission(),
        )
        .unwrap();
        drop(guard);

        fs::write(repo.path().join("feature-file.txt"), "feature work").unwrap();
        super::create_commit(ctx, stack_entry.id, "feature commit").unwrap();

        stack_entry.id
    };

    let mut review_map = HashMap::new();
    review_map.insert(
        "feature-branch".to_string(),
        ForgeReview {
            html_url: "https://github.com/test/repo/pull/1".to_string(),
            number: 1,
            title: "Feature PR".to_string(),
            body: Some("Description".to_string()),
            author: None,
            labels: vec![],
            draft: false,
            source_branch: "feature-branch".to_string(),
            target_branch: "master".to_string(),
            sha: "some-other-sha".to_string(),
            created_at: Some("2024-01-01T00:00:00Z".to_string()),
            modified_at: Some("2024-01-02T00:00:00Z".to_string()),
            merged_at: Some("2024-01-03T00:00:00Z".to_string()),
            closed_at: None,
            repository_ssh_url: None,
            repository_https_url: None,
            repo_owner: None,
            reviewers: vec![],
            unit_symbol: "#".to_string(),
            last_sync_at: chrono::NaiveDateTime::parse_from_str(
                "2024-01-04 23:56:04",
                "%Y-%m-%d %H:%M:%S",
            )
            .unwrap(),
        },
    );

    let statuses =
        gitbutler_branch_actions::upstream_integration_statuses(ctx, None, &review_map).unwrap();

    match statuses {
        StackStatuses::UpdatesRequired {
            statuses,
            worktree_conflicts,
        } => {
            assert_eq!(statuses.len(), 1);
            assert_eq!(statuses[0].0, Some(stack_id));
            assert_eq!(statuses[0].1.tree_status, UpstreamTreeStatus::Empty);
            assert_eq!(statuses[0].1.branch_statuses.len(), 1);
            assert_eq!(statuses[0].1.branch_statuses[0].name, "feature-branch");
            assert_eq!(
                statuses[0].1.branch_statuses[0].status,
                BranchStatus::SafelyUpdatable
            );
            assert!(worktree_conflicts.is_empty());
        }
        StackStatuses::UpToDate => panic!("Expected UpdatesRequired status"),
    }
}

#[test]
fn upstream_integration_status_with_closed_but_not_merged_pr() {
    let Test { repo, ctx, .. } = &mut Test::default();

    // Setup: Create a remote branch with commits
    {
        fs::write(repo.path().join("file.txt"), "initial").unwrap();
        let first_commit_oid = repo.commit_all("initial commit");
        fs::write(repo.path().join("file.txt"), "second").unwrap();
        repo.commit_all("second commit");
        repo.push();
        repo.reset_hard(Some(first_commit_oid));
    }

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::set_base_branch(
        ctx,
        &"refs/remotes/origin/master".parse().unwrap(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);

    // Create a virtual branch with a commit
    let stack_id = {
        let mut guard = ctx.exclusive_worktree_access();
        let stack_entry = gitbutler_branch_actions::create_virtual_branch(
            ctx,
            &BranchCreateRequest {
                name: Some("feature-branch".to_string()),
                ..Default::default()
            },
            guard.write_permission(),
        )
        .unwrap();
        drop(guard);

        fs::write(repo.path().join("feature-file.txt"), "feature work").unwrap();
        super::create_commit(ctx, stack_entry.id, "feature commit").unwrap();

        stack_entry.id
    };

    let mut review_map = HashMap::new();
    review_map.insert(
        "feature-branch".to_string(),
        ForgeReview {
            html_url: "https://github.com/test/repo/pull/1".to_string(),
            number: 1,
            title: "Feature PR".to_string(),
            body: Some("Description".to_string()),
            author: None,
            labels: vec![],
            draft: false,
            source_branch: "feature-branch".to_string(),
            target_branch: "master".to_string(),
            sha: "abc123".to_string(),
            created_at: Some("2024-01-01T00:00:00Z".to_string()),
            modified_at: Some("2024-01-02T00:00:00Z".to_string()),
            merged_at: None,
            closed_at: Some("2024-01-03T00:00:00Z".to_string()),
            repository_ssh_url: None,
            repository_https_url: None,
            repo_owner: None,
            reviewers: vec![],
            unit_symbol: "#".to_string(),
            last_sync_at: chrono::NaiveDateTime::parse_from_str(
                "2024-01-04 23:56:04",
                "%Y-%m-%d %H:%M:%S",
            )
            .unwrap(),
        },
    );

    let statuses =
        gitbutler_branch_actions::upstream_integration_statuses(ctx, None, &review_map).unwrap();

    match statuses {
        StackStatuses::UpdatesRequired {
            statuses,
            worktree_conflicts,
        } => {
            assert_eq!(statuses.len(), 1);
            assert_eq!(statuses[0].0, Some(stack_id));
            assert_eq!(statuses[0].1.tree_status, UpstreamTreeStatus::Empty);
            assert_eq!(statuses[0].1.branch_statuses.len(), 1);
            assert_eq!(statuses[0].1.branch_statuses[0].name, "feature-branch");
            assert_eq!(
                statuses[0].1.branch_statuses[0].status,
                BranchStatus::SafelyUpdatable
            );
            assert!(worktree_conflicts.is_empty());
        }
        StackStatuses::UpToDate => panic!("Expected UpdatesRequired status"),
    }
}

#[test]
fn upstream_integration_status_with_different_branch_pr() {
    let Test { repo, ctx, .. } = &mut Test::default();

    // Setup: Create a remote branch with commits
    {
        fs::write(repo.path().join("file.txt"), "initial").unwrap();
        let first_commit_oid = repo.commit_all("initial commit");
        fs::write(repo.path().join("file.txt"), "second").unwrap();
        repo.commit_all("second commit");
        repo.push();
        repo.reset_hard(Some(first_commit_oid));
    }

    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::set_base_branch(
        ctx,
        &"refs/remotes/origin/master".parse().unwrap(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);

    // Create a virtual branch with a commit
    let stack_id = {
        let mut guard = ctx.exclusive_worktree_access();
        let stack_entry = gitbutler_branch_actions::create_virtual_branch(
            ctx,
            &BranchCreateRequest {
                name: Some("feature-branch".to_string()),
                ..Default::default()
            },
            guard.write_permission(),
        )
        .unwrap();
        drop(guard);

        fs::write(repo.path().join("feature-file.txt"), "feature work").unwrap();
        super::create_commit(ctx, stack_entry.id, "feature commit").unwrap();

        stack_entry.id
    };

    let mut review_map = HashMap::new();
    review_map.insert(
        "different-branch".to_string(),
        ForgeReview {
            html_url: "https://github.com/test/repo/pull/2".to_string(),
            number: 2,
            title: "Different PR".to_string(),
            body: None,
            author: None,
            labels: vec![],
            draft: false,
            source_branch: "different-branch".to_string(),
            target_branch: "master".to_string(),
            sha: "def456".to_string(),
            created_at: Some("2024-01-01T00:00:00Z".to_string()),
            modified_at: Some("2024-01-02T00:00:00Z".to_string()),
            merged_at: Some("2024-01-03T00:00:00Z".to_string()),
            closed_at: None,
            repository_ssh_url: None,
            repository_https_url: None,
            repo_owner: None,
            reviewers: vec![],
            unit_symbol: "#".to_string(),
            last_sync_at: chrono::NaiveDateTime::parse_from_str(
                "2024-01-04 23:56:04",
                "%Y-%m-%d %H:%M:%S",
            )
            .unwrap(),
        },
    );

    let statuses =
        gitbutler_branch_actions::upstream_integration_statuses(ctx, None, &review_map).unwrap();

    match statuses {
        StackStatuses::UpdatesRequired {
            statuses,
            worktree_conflicts,
        } => {
            assert_eq!(statuses.len(), 1);
            assert_eq!(statuses[0].0, Some(stack_id));
            assert_eq!(statuses[0].1.tree_status, UpstreamTreeStatus::Empty);
            assert_eq!(statuses[0].1.branch_statuses.len(), 1);
            assert_eq!(statuses[0].1.branch_statuses[0].name, "feature-branch");
            assert_eq!(
                statuses[0].1.branch_statuses[0].status,
                BranchStatus::SafelyUpdatable
            );
            assert!(worktree_conflicts.is_empty());
        }
        StackStatuses::UpToDate => panic!("Expected UpdatesRequired status"),
    }
}

/// Regression test: when a stack has a branch whose commits are fully integrated
/// upstream (part of the new base), `integrate_upstream` should succeed and archive
/// that branch — not fail with "The new head names do not match the current heads".
#[test]
fn integrate_upstream_with_fully_integrated_branch_in_stack() {
    let Test { repo, ctx, .. } = &mut Test::default();

    // Setup remote: create an initial commit, then add a second commit that
    // includes the same change branch1 will have, making branch1 "integrated".
    // Reset local back to the initial commit so there's an upstream delta.
    {
        fs::write(repo.path().join("file.txt"), "initial").unwrap();
        let first = repo.commit_all("initial commit");

        fs::write(repo.path().join("branch1-file.txt"), "branch1 work").unwrap();
        repo.commit_all("upstream: merge branch1");
        repo.push();
        repo.reset_hard(Some(first));
    }

    // Set the base branch
    let mut guard = ctx.exclusive_worktree_access();
    gitbutler_branch_actions::set_base_branch(
        ctx,
        &"refs/remotes/origin/master".parse().unwrap(),
        guard.write_permission(),
    )
    .unwrap();
    drop(guard);

    // Create a stack with two branches: branch1 (bottom) and branch3 (top)
    let stack_id = {
        let mut guard = ctx.exclusive_worktree_access();
        let stack_entry = gitbutler_branch_actions::create_virtual_branch(
            ctx,
            &BranchCreateRequest {
                name: Some("branch1".to_string()),
                ..Default::default()
            },
            guard.write_permission(),
        )
        .unwrap();
        drop(guard);

        // branch1 commit — same content as what's upstream
        fs::write(repo.path().join("branch1-file.txt"), "branch1 work").unwrap();
        super::create_commit(ctx, stack_entry.id, "branch1: first commit").unwrap();

        // Add branch3 on top of the stack with different work
        gitbutler_branch_actions::stack::create_branch(
            ctx,
            stack_entry.id,
            gitbutler_branch_actions::stack::CreateSeriesRequest {
                name: "branch3".to_string(),
                target_patch: None,
                preceding_head: None,
            },
        )
        .unwrap();

        fs::write(repo.path().join("branch3-file.txt"), "branch3 work").unwrap();
        super::create_commit(ctx, stack_entry.id, "branch3: first commit").unwrap();

        stack_entry.id
    };

    // Verify the stack has two branches
    let stacks = stack_details(ctx);
    assert_eq!(stacks.len(), 1);
    assert_eq!(stacks[0].1.branch_details.len(), 2);

    // Mark branch1 as integrated via a merged review
    let branch1_commit = stacks[0].1.branch_details[1].commits[0].id.to_string();
    let mut review_map = HashMap::new();
    review_map.insert(
        "branch1".to_string(),
        ForgeReview {
            html_url: "https://github.com/test/repo/pull/1".to_string(),
            number: 1,
            title: "Branch1 PR".to_string(),
            body: None,
            author: None,
            labels: vec![],
            draft: false,
            source_branch: "branch1".to_string(),
            target_branch: "master".to_string(),
            sha: branch1_commit,
            created_at: Some("2024-01-01T00:00:00Z".to_string()),
            modified_at: Some("2024-01-02T00:00:00Z".to_string()),
            merged_at: Some("2024-01-03T00:00:00Z".to_string()),
            closed_at: None,
            repository_ssh_url: None,
            repository_https_url: None,
            repo_owner: None,
            reviewers: vec![],
            unit_symbol: "#".to_string(),
            last_sync_at: chrono::NaiveDateTime::parse_from_str(
                "2024-01-04 23:56:04",
                "%Y-%m-%d %H:%M:%S",
            )
            .unwrap(),
        },
    );

    // Verify branch1 shows as integrated in statuses
    let statuses =
        gitbutler_branch_actions::upstream_integration_statuses(ctx, None, &review_map).unwrap();
    match &statuses {
        StackStatuses::UpdatesRequired {
            statuses,
            worktree_conflicts: _,
        } => {
            let branch1_status = statuses[0]
                .1
                .branch_statuses
                .iter()
                .find(|s| s.name == "branch1")
                .expect("branch1 should be in statuses");
            assert_eq!(
                branch1_status.status,
                BranchStatus::Integrated,
                "branch1 should be marked as integrated"
            );
        }
        StackStatuses::UpToDate => panic!("Expected UpdatesRequired"),
    }

    // Integrate upstream with a Rebase resolution for this stack.
    // Before the fix, this would fail with:
    //   "The new head names do not match the current heads"
    // because branch1 (fully integrated) is pruned from the rebase output
    // but was not yet archived when set_heads_from_rebase_output validated.
    let resolutions = vec![Resolution {
        stack_id,
        approach: ResolutionApproach::Rebase,
        delete_integrated_branches: false,
    }];

    gitbutler_branch_actions::integrate_upstream(ctx, &resolutions, None, &review_map)
        .expect("integrate_upstream should succeed when a branch in the stack is fully integrated");

    // After integration, branch1 should be archived and branch3 should remain
    let stacks = stack_details(ctx);
    assert_eq!(stacks.len(), 1, "stack should still exist");
    assert_eq!(
        stacks[0].1.branch_details.len(),
        1,
        "only branch3 should remain visible"
    );
    assert_eq!(stacks[0].1.branch_details[0].name, "branch3");
}
