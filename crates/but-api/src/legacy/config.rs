use anyhow::Result;
use but_api_macros::but_api;
use but_core::{RepositoryExt, settings::git::ui::GitConfigSettings};
use but_ctx::ThreadSafeContext;
use but_serde::bstring_lossy_opt;
use gix::bstr::BString;
use serde::Serialize;
use tracing::instrument;

#[but_api]
#[instrument(err(Debug))]
pub fn get_gb_config(ctx: &but_ctx::Context) -> Result<GitConfigSettings> {
    let repo = ctx.repo.get()?;
    repo.git_settings().map(Into::into)
}

#[but_api]
#[instrument(err(Debug))]
pub async fn set_gb_config(mut ctx: ThreadSafeContext, config: GitConfigSettings) -> Result<()> {
    let sync_reviews = config.gitbutler_review_stacking_description.is_some()
        || config.gitbutler_github_stacking_mode.is_some();
    {
        let ctx = ctx.clone().into_thread_local();
        ctx.repo.get()?.set_git_settings(&config.into())?;
    }
    if sync_reviews
        && let but_forge::ReviewSyncOutcome::Failed { message } =
            crate::legacy::forge::sync_all_review_stacks({
                ctx.repo = None;
                ctx
            })
            .await
    {
        tracing::warn!(%message, "Could not synchronize reviews after updating stack settings");
    }
    Ok(())
}

#[but_api]
#[instrument(err(Debug))]
pub fn store_author_globally_if_unset(
    ctx: &but_ctx::Context,
    name: String,
    email: String,
) -> Result<()> {
    but_rebase::commit::save_author_if_unset_in_repo(
        &*ctx.repo.get()?,
        gix::config::Source::User,
        name.as_str(),
        email.as_str(),
    )?;
    Ok(())
}

/// Represents the author information from the git configuration.
#[derive(Clone, Serialize)]
pub struct AuthorInfo {
    /// The name of the author.
    #[serde(with = "bstring_lossy_opt")]
    pub name: Option<BString>,
    /// The email of the author.
    #[serde(with = "bstring_lossy_opt")]
    pub email: Option<BString>,
}

/// Return the Git author information as the project repository would see it.
#[but_api]
#[instrument(err(Debug))]
pub fn get_author_info(ctx: &but_ctx::Context) -> Result<AuthorInfo> {
    let (name, email) = ctx
        .repo
        .get()?
        .author()
        .transpose()
        .map_err(anyhow::Error::from)?
        .map(|author| (Some(author.name.to_owned()), Some(author.email.to_owned())))
        .unwrap_or_default();
    Ok(AuthorInfo { name, email })
}
