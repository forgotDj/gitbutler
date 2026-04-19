use std::{str::FromStr, time::UNIX_EPOCH};

use anyhow::{Context as _, Result, anyhow};
use but_askpass as askpass;
use but_core::ref_metadata::StackId;
use but_ctx::Context;
use but_error::Code;
use gitbutler_reference::{Refname, RemoteRefname};
use serde::Serialize;

/// Summary information about branches pushed to a remote.
#[derive(Debug, PartialEq, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    /// The name of the remote to which the branches were pushed.
    pub remote: String,
    /// The list of pushed branches and their corresponding remote refnames.
    pub branch_to_remote: Vec<(String, Refname)>,
    /// The list of branches with their before/after commit SHAs.
    ///
    /// Format: `(branch_name, before_sha, after_sha)`.
    pub branch_sha_updates: Vec<(String, String, String)>,
}

/// Higher-level fetch and push helpers implemented for [`Context`].
#[expect(clippy::too_many_arguments)]
pub trait GitContextExt {
    /// Fetch all heads from the given remote.
    fn fetch(&self, remote_name: &str, askpass: Option<String>) -> Result<()>;

    /// Push the given commit to the provided remote branch.
    ///
    /// Returns the stderr output of the Git executable if used.
    fn push(
        &self,
        head: gix::ObjectId,
        branch: &RemoteRefname,
        with_force: bool,
        force_push_protection: bool,
        refspec: Option<String>,
        askpass_broker: Option<Option<StackId>>,
        push_opts: Vec<String>,
    ) -> Result<String>;

    /// Push a temporary branch to the remote and immediately delete it again.
    fn git_test_push(
        &self,
        remote_name: &str,
        branch_name: &str,
        askpass: Option<Option<StackId>>,
    ) -> Result<()>;
}

impl GitContextExt for Context {
    fn fetch(&self, remote_name: &str, askpass: Option<String>) -> Result<()> {
        let refspec = format!("+refs/heads/*:refs/remotes/{remote_name}/*");

        let on_prompt = if askpass::get_broker().is_some() {
            Some(move |prompt: String| handle_git_prompt_fetch(prompt, askpass.clone()))
        } else {
            None
        };

        let repo_path = self.workdir_or_gitdir()?;
        let remote = remote_name.to_string();
        let result = std::thread::spawn(move || -> Result<_> {
            let runtime = tokio::runtime::Runtime::new().context(
                but_error::Context::new("failed to initialize async runtime for git fetch")
                    .with_code(Code::Unknown),
            )?;
            let refspec = crate::RefSpec::parse(&refspec).context(
                but_error::Context::new(format!("failed to parse git fetch refspec `{refspec}`"))
                    .with_code(Code::Validation),
            )?;
            Ok(runtime.block_on(crate::fetch(
                repo_path,
                crate::tokio::TokioExecutor,
                &remote,
                refspec,
                on_prompt,
            )))
        })
        .join()
        .map_err(|panic| {
            let reason = if let Some(message) = panic.downcast_ref::<String>() {
                message.clone()
            } else if let Some(message) = panic.downcast_ref::<&'static str>() {
                (*message).to_owned()
            } else {
                "unknown panic payload".to_owned()
            };

            anyhow!("git fetch worker thread panicked: {reason}").context(
                but_error::Context::new("git fetch failed unexpectedly").with_code(Code::Unknown),
            )
        })??;
        result.map_err(Into::into)
    }

    fn push(
        &self,
        head: gix::ObjectId,
        branch: &RemoteRefname,
        with_force: bool,
        force_push_protection: bool,
        refspec: Option<String>,
        askpass_broker: Option<Option<StackId>>,
        push_opts: Vec<String>,
    ) -> Result<String> {
        let refspec = refspec.unwrap_or_else(|| format!("{}:refs/heads/{}", head, branch.branch()));

        let on_prompt = if askpass::get_broker().is_some() {
            Some(move |prompt: String| handle_git_prompt_push(prompt, askpass_broker))
        } else {
            None
        };

        let repo_path = self.workdir_or_gitdir()?;
        let remote = branch.remote().to_string();
        let result = std::thread::spawn(move || -> Result<_> {
            let runtime = tokio::runtime::Runtime::new().context(
                but_error::Context::new("failed to initialize async runtime for git push")
                    .with_code(Code::Unknown),
            )?;
            let refspec = crate::RefSpec::parse(&refspec).context(
                but_error::Context::new(format!("failed to parse git push refspec `{refspec}`"))
                    .with_code(Code::Validation),
            )?;
            Ok(runtime.block_on(crate::push(
                repo_path,
                crate::tokio::TokioExecutor,
                &remote,
                refspec,
                with_force,
                force_push_protection,
                on_prompt,
                push_opts,
            )))
        })
        .join()
        .map_err(|panic| {
            let reason = if let Some(message) = panic.downcast_ref::<String>() {
                message.clone()
            } else if let Some(message) = panic.downcast_ref::<&'static str>() {
                (*message).to_owned()
            } else {
                "unknown panic payload".to_owned()
            };

            anyhow!("git push worker thread panicked: {reason}").context(
                but_error::Context::new("git push failed unexpectedly").with_code(Code::Unknown),
            )
        })??;
        match result {
            Ok(stderr) => Ok(stderr),
            Err(err) => match err {
                crate::Error::ForcePushProtection(e) => Err(anyhow!(
                    "The force push was blocked because the remote branch contains commits that would be overwritten.\n\n{e}"
                )
                .context(Code::GitForcePushProtection)),
                crate::Error::GerritNoNewChanges(_) => {
                    // Treat "no new changes" as success for Gerrit.
                    Ok(String::new())
                }
                _ => Err(err.into()),
            },
        }
    }

    fn git_test_push(
        &self,
        remote_name: &str,
        branch_name: &str,
        askpass: Option<Option<StackId>>,
    ) -> Result<()> {
        let target_branch_refname =
            Refname::from_str(&format!("refs/remotes/{remote_name}/{branch_name}"))?;
        let repo = self.repo.get()?;
        let mut branch = repo
            .try_find_reference(&target_branch_refname.to_string())?
            .ok_or(anyhow!("failed to find branch {target_branch_refname}"))?;

        let commit_id = branch.peel_to_commit()?.id;
        let branch_name = format!("test-push-{}", now_ms());
        let refname =
            RemoteRefname::from_str(&format!("refs/remotes/{remote_name}/{branch_name}"))?;

        self.push(commit_id, &refname, false, false, None, askpass, vec![])
            .map_err(|err| anyhow!(err.to_string()))?;

        let empty_refspec = Some(format!(":refs/heads/{branch_name}"));
        self.push(
            commit_id,
            &refname,
            false,
            false,
            empty_refspec,
            askpass,
            vec![],
        )
        .map_err(|err| anyhow!(err.to_string()))?;

        Ok(())
    }
}

fn now_ms() -> u128 {
    UNIX_EPOCH
        .elapsed()
        .expect("system time is set before the Unix epoch")
        .as_millis()
}

async fn handle_git_prompt_push(
    prompt: String,
    askpass: Option<Option<StackId>>,
) -> Option<String> {
    if let Some(branch_id) = askpass {
        tracing::info!("received prompt for branch push {branch_id:?}: {prompt:?}");
        askpass::get_broker()
            .expect("askpass broker must be initialized")
            .submit_prompt(prompt, askpass::Context::Push { branch_id })
            .await
    } else {
        tracing::warn!("received askpass push prompt but no broker was supplied; returning None");
        None
    }
}

async fn handle_git_prompt_fetch(prompt: String, askpass: Option<String>) -> Option<String> {
    if let Some(action) = askpass {
        tracing::info!("received prompt for fetch with action {action:?}: {prompt:?}");
        askpass::get_broker()
            .expect("askpass broker must be initialized")
            .submit_prompt(prompt, askpass::Context::Fetch { action })
            .await
    } else {
        tracing::warn!("received askpass fetch prompt but no broker was supplied; returning None");
        None
    }
}
