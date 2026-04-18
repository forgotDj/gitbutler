use std::{str::FromStr, time::UNIX_EPOCH};

use anyhow::{Context as _, Result, anyhow};
use but_askpass as askpass;
use but_ctx::Context;
use but_error::Code;
use gitbutler_reference::{Refname, RemoteRefname};
use gitbutler_repo::first_parent_commit_ids_until;
use gitbutler_stack::{Stack, StackId};
#[expect(clippy::too_many_arguments)]
pub trait RepoActionsExt {
    fn fetch(&self, remote_name: &str, askpass: Option<String>) -> Result<()>;
    /// Returns the stderr output of the git executable if used.
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
    fn distance(&self, from: gix::ObjectId, to: gix::ObjectId) -> Result<u32>;
    fn delete_branch_reference(&self, stack: &Stack) -> Result<()>;
    fn add_branch_reference(&self, stack: &Stack) -> Result<()>;
    fn git_test_push(
        &self,
        remote_name: &str,
        branch_name: &str,
        askpass: Option<Option<StackId>>,
    ) -> Result<()>;
}

/// Gets the number of milliseconds since the Unix epoch.
///
/// # Panics
/// Panics if the system time is set before the Unix epoch.
pub fn now_ms() -> u128 {
    UNIX_EPOCH
        .elapsed()
        .expect("system time is set before the Unix epoch")
        .as_millis()
}

impl RepoActionsExt for Context {
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

        let now = now_ms();
        let branch_name = format!("test-push-{now}");

        let refname =
            RemoteRefname::from_str(&format!("refs/remotes/{remote_name}/{branch_name}",))?;

        match self.push(commit_id, &refname, false, false, None, askpass, vec![]) {
            Ok(_) => Ok(()),
            Err(e) => Err(anyhow::anyhow!(e.to_string())),
        }?;

        let empty_refspec = Some(format!(":refs/heads/{branch_name}"));
        match self.push(
            commit_id,
            &refname,
            false,
            false,
            empty_refspec,
            askpass,
            vec![],
        ) {
            Ok(_) => Ok(()),
            Err(e) => Err(anyhow::anyhow!(e.to_string())),
        }?;

        Ok(())
    }

    fn add_branch_reference(&self, stack: &Stack) -> Result<()> {
        let repo = self.repo.get()?;
        let refname = stack.refname()?.to_string();
        let head_oid = stack.head_oid(self)?;
        let previous = match repo
            .try_find_reference(&refname)
            .context("failed to lookup reference")?
        {
            Some(reference) => {
                if reference.id() == head_oid {
                    return Ok(());
                }
                gix::refs::transaction::PreviousValue::Any
            }
            None => gix::refs::transaction::PreviousValue::MustNotExist,
        };

        let refname: gix::refs::FullName = refname.as_str().try_into()?;
        repo.reference(refname, head_oid, previous, "new vbranch")
            .context("failed to create branch reference")?;

        Ok(())
    }

    fn delete_branch_reference(&self, stack: &Stack) -> Result<()> {
        let repo = self.repo.get()?;
        match repo
            .try_find_reference(&stack.refname()?.to_string())
            .context("failed to lookup reference")?
        {
            Some(reference) => reference
                .delete()
                .context("failed to delete branch reference"),
            None => Ok(()),
        }
    }

    // returns the number of commits between the first oid to the second oid
    fn distance(&self, from: gix::ObjectId, to: gix::ObjectId) -> Result<u32> {
        let repo = self.repo.get()?;
        let oids = first_parent_commit_ids_until(&repo, from, to)?;
        Ok(oids.len().try_into()?)
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
            let refspec = gitbutler_git::RefSpec::parse(&refspec).context(
                but_error::Context::new(format!("failed to parse git push refspec `{refspec}`"))
                    .with_code(Code::Validation),
            )?;
            Ok(runtime.block_on(gitbutler_git::push(
                repo_path,
                gitbutler_git::tokio::TokioExecutor,
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
            Ok(result) => Ok(result),
            Err(err) => match err {
                gitbutler_git::Error::ForcePushProtection(e) => Err(anyhow!(
                    "The force push was blocked because the remote branch contains commits that would be overwritten.\n\n{e}"
                )
                .context(Code::GitForcePushProtection)),
                gitbutler_git::Error::GerritNoNewChanges(_) => {
                    // Treat "no new changes" as success for Gerrit
                    Ok("".to_string())
                }
                _ => Err(err.into()),
            },
        }
    }

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
            let refspec = gitbutler_git::RefSpec::parse(&refspec).context(
                but_error::Context::new(format!("failed to parse git fetch refspec `{refspec}`"))
                    .with_code(Code::Validation),
            )?;
            Ok(runtime.block_on(gitbutler_git::fetch(
                repo_path,
                gitbutler_git::tokio::TokioExecutor,
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
