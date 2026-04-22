use anyhow::{Context as _, Result, bail};

/// Check a rebase output for commits that became conflicted as a result of
/// the rebase (excluding commits that were already conflicted beforehand).
///
/// This is used to validate rebase outputs computed during the move operations
/// before any state is written to disk.
pub(crate) fn bail_on_new_conflicts(
    repo: &gix::Repository,
    output: &but_rebase::RebaseOutput,
    error_message: &str,
) -> Result<()> {
    use gix::prelude::ObjectIdExt as _;
    for (_, old, new) in &output.commit_mapping {
        let was_conflicted = but_core::Commit::from_id(old.attach(repo))
            .with_context(|| format!("failed to read original commit {old}"))?
            .is_conflicted();
        if was_conflicted {
            continue;
        }
        if but_core::Commit::from_id(new.attach(repo))
            .with_context(|| format!("failed to read rebased commit {new}"))?
            .is_conflicted()
        {
            bail!("{error_message}");
        }
    }
    Ok(())
}
