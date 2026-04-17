pub mod rebase;

mod commands;
mod traversal {
    use anyhow::Result;

    /// Return commits on `from`'s first-parent chain, stopping before the first
    /// commit that is reachable from `stop_before`.
    ///
    /// The returned commits are ordered from `from` backwards along the first-parent chain, excluding
    /// the first commit that is reachable from `stop_before` by ancestry.
    ///
    /// This matches the semantics of a first-parent walk with `stop_before` hidden, but avoids the
    /// up-front hidden-side graph painting that makes `with_hidden(stop_before)` expensive in large
    /// repositories.
    pub fn first_parent_commit_ids_until(
        repo: &gix::Repository,
        from: gix::ObjectId,
        stop_before: gix::ObjectId,
    ) -> Result<Vec<gix::ObjectId>> {
        let cache = repo.commit_graph_if_enabled()?;
        let mut graph = repo.revision_graph(cache.as_ref());
        let mut commit_ids = Vec::new();
        let mut current = Some(from);

        while let Some(commit_id) = current {
            let reaches_hidden_history =
                match repo.merge_base_with_graph(commit_id, stop_before, &mut graph) {
                    Ok(merge_base) => merge_base.detach() == commit_id,
                    Err(gix::repository::merge_base_with_graph::Error::NotFound { .. }) => false,
                    Err(err) => return Err(err.into()),
                };
            if reaches_hidden_history {
                break;
            }

            commit_ids.push(commit_id);
            current = repo
                .find_commit(commit_id)?
                .parent_ids()
                .next()
                .map(|parent_id| parent_id.detach());
        }

        Ok(commit_ids)
    }
}
pub use traversal::first_parent_commit_ids_until;

pub use commands::{FileInfo, RepoCommands};
pub use remote::GitRemote;

mod repository_ext;
pub use repository_ext::{commit_with_signature_gix, commit_without_signature_gix};

pub mod hooks;
pub mod managed_hooks;
mod remote;
pub mod staging;

pub mod commit_message;

pub const GITBUTLER_COMMIT_AUTHOR_NAME: &str = "GitButler";
pub const GITBUTLER_COMMIT_AUTHOR_EMAIL: &str = "gitbutler@gitbutler.com";

pub enum SignaturePurpose {
    Author,
    Committer,
}

/// Provide a `gix` signature with the GitButler author and the current or overridden time.
pub fn signature_gix(purpose: SignaturePurpose) -> gix::actor::Signature {
    gix::actor::Signature {
        name: GITBUTLER_COMMIT_AUTHOR_NAME.into(),
        email: GITBUTLER_COMMIT_AUTHOR_EMAIL.into(),
        time: commit_time(match purpose {
            SignaturePurpose::Author => "GIT_AUTHOR_DATE",
            SignaturePurpose::Committer => "GIT_COMMITTER_DATE",
        }),
    }
}

/// Return the time of a commit as `now` unless the `overriding_variable_name` contains a parseable date,
/// which is used instead.
fn commit_time(overriding_variable_name: &str) -> gix::date::Time {
    std::env::var(overriding_variable_name)
        .ok()
        .and_then(|time| gix::date::parse(&time, Some(std::time::SystemTime::now())).ok())
        .unwrap_or_else(gix::date::Time::now_local_or_utc)
}
