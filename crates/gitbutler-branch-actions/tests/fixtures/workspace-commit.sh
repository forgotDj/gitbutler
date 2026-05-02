#!/usr/bin/env bash
set -eu -o pipefail

function tick () {
  if test -z "${tick+set}"; then
    tick=1675176957
  else
    tick=$(($tick + 60))
  fi
  GIT_COMMITTER_DATE="$tick +0100"
  GIT_AUTHOR_DATE="$tick +0100"
  export GIT_COMMITTER_DATE GIT_AUTHOR_DATE
}

function commit_exact () {
  local message=${1:?}
  git add -A
  local tree
  tree=$(git write-tree)
  local parent_args=()
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    parent_args=(-p HEAD)
  fi
  local commit
  commit=$(printf "%s" "$message" | git commit-tree "$tree" "${parent_args[@]}")
  local current_branch
  current_branch=$(git symbolic-ref -q HEAD || true)
  if [[ -n "$current_branch" ]]; then
    git update-ref "$current_branch" "$commit"
  fi
  git reset --hard "$commit" >/dev/null
}

function commit_with_tick () {
  local message=${1:?}
  tick
  commit_exact "$message"
}

git init --initial-branch=main remote
(cd remote
  git config user.name "Author"
  git config user.email "author@example.com"
  echo "base content" > shared.txt
  seq 15 > file
  git add . && git commit -m "init"
)

# Two stacks that both modify shared.txt with conflicting content.
# This triggers a merge conflict in remerged_workspace_tree_v2 (gix),
# which sets the later stack's in_workspace to false.
git clone remote conflicting-stacks
(cd conflicting-stacks
  git config user.name "Author"
  git config user.email "author@example.com"

  git checkout -b stack_a main
  echo "content from stack a" > shared.txt
  commit_with_tick "stack_a commit"

  git checkout -b stack_b main
  echo "content from stack b" > shared.txt
  commit_with_tick "stack_b commit"

  # The workspace commit merges both stacks.
  # remerged_workspace_tree_v2 will detect that they conflict.
  git checkout -b gitbutler/workspace main
  # We can't actually merge conflicting branches, so just point workspace
  # at main. The seed + update_workspace_commit call in the test will
  # rebuild it properly.
)

# Two stacks each modifying adjacent (non-overlapping) sections of the same file,
# with zero lines of buffer between the changed regions.
# Stack A owns lines 1-5 and lines 11-15; Stack B owns lines 6-10.
# A's top hunk immediately precedes B's hunk (adjacency from above), and
# B's hunk immediately precedes A's bottom hunk (adjacency from below).
# This exercises the gix fix for the git2 bug where adjacent hunks in an
# octopus workspace merge were incorrectly flagged as conflicting.
git clone remote adjacent-stacks
(cd adjacent-stacks
  git config user.name "Author"
  git config user.email "author@example.com"

  git checkout -b stack_a main

  # Change lines 1-5 (top) and lines 11-15 (bottom); lines 6-10 untouched.
  printf 'a1\na2\na3\na4\na5\n6\n7\n8\n9\n10\na11\na12\na13\na14\na15\n' > file
  commit_with_tick "stack_a: change top and bottom sections"

  git checkout -b stack_b main
  # Change only lines 6-10 (middle); lines 1-5 and 11-15 untouched from base.
  printf '1\n2\n3\n4\n5\nb6\nb7\nb8\nb9\nb10\n11\n12\n13\n14\n15\n' > file
  commit_with_tick "stack_b: change middle section"

  # Point workspace at main; update_workspace_commit in the test rebuilds it properly.
  git checkout -b gitbutler/workspace main
  git commit --allow-empty -m "GitButler Workspace Commit"
)

# Reproduces a merge-base mismatch between merge_workspace and remerged_workspace_tree_v2.
#
# Three stacks based on different upstream commits, so their trees inherit
# different versions of shared.txt. Neither stack modifies shared.txt itself.
#
# Remote history: init -> v1 -> v2 -> v3 (target)
# v1 and v2 each modify a DIFFERENT section of shared.txt relative to v3.
# v3 has the "canonical" content (target version).
#
# merge_base_octopus(stack_a, stack_b, stack_c, v3) = init ("base content").
# With init as base, stacks replace "base content" with different multi-line
# content → conflict.
# With target (v3) as base, stack_a changes section A only, stack_b changes
# section B only → non-overlapping → clean merge.
#
# The test advances origin/main to v4 to trigger integrate_upstream.
(cd remote
  git config user.name "Author"
  git config user.email "author@example.com"

  # v1: section A differs from v3, sections B and C match v3.
  printf '%s\n' \
    "--- section A ---" "ALPHA ONE" "ALPHA TWO" "ALPHA THREE" \
    "--- section B ---" "line b1" "line b2" "line b3" \
    "--- section C ---" "line c1" "line c2" "line c3" > shared.txt
  git add . && git commit -m "upstream: shared.txt v1"

  # v2: section A matches v3, section B differs from v3, section C matches v3.
  printf '%s\n' \
    "--- section A ---" "line a1" "line a2" "line a3" \
    "--- section B ---" "BRAVO ONE" "BRAVO TWO" "BRAVO THREE" \
    "--- section C ---" "line c1" "line c2" "line c3" > shared.txt
  git add . && git commit -m "upstream: shared.txt v2"

  # v3 (target): canonical content — all sections in their "final" form.
  printf '%s\n' \
    "--- section A ---" "line a1" "line a2" "line a3" \
    "--- section B ---" "line b1" "line b2" "line b3" \
    "--- section C ---" "line c1" "line c2" "line c3" > shared.txt
  git add . && git commit -m "upstream: shared.txt v3"
)

git clone remote diverged-stacks
(cd diverged-stacks
  git config user.name "Author"
  git config user.email "author@example.com"

  # v3 is the current target; v4 will be the new upstream the test advances to.
  git tag current-target origin/main

  # Create v4 on remote (the commit the test will advance origin/main to).
  (cd ../remote
    echo "unrelated new file" > new_upstream.txt
    git add . && git commit -m "upstream: add new_upstream.txt"
  )
  git fetch origin

  git tag upstream-target origin/main

  # stack_a: child of v1, only adds file_a.txt (inherits shared.txt = "v1")
  git checkout -b stack_a current-target~2
  echo "stack a work" > file_a.txt
  commit_with_tick "stack_a: add file_a"

  # stack_b: child of v2, only adds file_b.txt (inherits shared.txt = "v2 ...")
  git checkout -b stack_b current-target~1
  echo "stack b work" > file_b.txt
  commit_with_tick "stack_b: add file_b"

  # stack_c: child of v3, only adds file_c.txt (inherits shared.txt = "v3 ...")
  git checkout -b stack_c current-target
  echo "stack c work" > file_c.txt
  commit_with_tick "stack_c: add file_c"

  # Target metadata points to v3 (= current-target).
  # origin/main still points to v4; the test will set it to upstream-target.
  git update-ref refs/remotes/origin/main current-target

  # Build a workspace commit with all three stacks as parents so that
  # stacks_v3 can discover them from the commit graph.
  stack_a_oid=$(git rev-parse stack_a)
  stack_b_oid=$(git rev-parse stack_b)
  stack_c_oid=$(git rev-parse stack_c)
  tree=$(git rev-parse stack_c^{tree})
  ws_commit=$(echo "GitButler Workspace Commit" | git commit-tree "$tree" -p "$stack_a_oid" -p "$stack_b_oid" -p "$stack_c_oid")
  git checkout -b gitbutler/workspace
  git reset --hard "$ws_commit"
)
