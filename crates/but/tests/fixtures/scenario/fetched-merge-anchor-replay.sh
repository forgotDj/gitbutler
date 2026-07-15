#!/usr/bin/env bash

set -eu -o pipefail

source "${BASH_SOURCE[0]%/*}/shared.sh"

git-init-frozen
tick
commit-file M
setup_target_to_match_main

git checkout -b pr
tick
commit-file feature

git checkout -b fetched-integration main
tick
git merge --no-ff pr -m "fetched PR merge"
git branch fetched-pr-tip

git checkout -b docs-to-replay
tick
commit-file docs.md
git update-ref refs/gitbutler/docs-to-replay HEAD

git checkout main
create_workspace_commit_once main
