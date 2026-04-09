use std::{
    borrow::Cow, collections::HashSet, io::Write, path::Path, path::PathBuf, process::Stdio,
};

use anyhow::{Context as _, bail};
use bstr::{BStr, BString, ByteSlice};
use but_error::Code;
use gix::objs::WriteTo;
use gix::prelude::ObjectIdExt;
use serde::{Deserialize, Serialize};

use crate::{
    ChangeId, Commit, CommitOwned, GitConfigSettings, RepositoryExt,
    cmd::prepare_with_shell_on_windows,
};

/// A collection of all the extra information we keep in the headers of a commit.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Headers {
    /// A property we can use to determine if two different commits are
    /// actually the same "patch" at different points in time. We carry it
    /// forwards when you rebase a commit in GitButler.
    /// Note that these don't have to be unique within a branch even,
    /// and it's possible that different commits with the same change-id
    /// have different content.
    pub change_id: Option<ChangeId>,
    /// A property used to indicate that we've written a conflicted tree to a
    /// commit, and `Some(num_files)` is the amount of conflicted files.
    ///
    /// Conflicted commits should never make it into the main trunk.
    /// If `None`, the commit is a normal commit without a special tree.
    pub conflicted: Option<u64>,
}

/// Lifecycle
impl Headers {
    /// Derive a deterministic synthetic change-id from `commit_id`.
    ///
    /// Useful for when [`Self::change_id`] is `None`.
    ///
    /// These synthesized IDs are compatible with Jujutsu's deterministic scheme,
    /// and JJ would create exactly the same change-id if given the `commit_id`.
    pub fn synthetic_change_id_from_commit_id(commit_id: gix::ObjectId) -> ChangeId {
        let bytes: Vec<_> = commit_id.as_bytes()[4..gix::hash::Kind::Sha1.len_in_bytes()]
            .iter()
            .rev()
            .map(|byte| byte.reverse_bits())
            .collect();
        ChangeId::from_bytes(&bytes)
    }

    /// Fill in [`Self::change_id`] with a deterministic synthetic value derived from `commit_id`
    /// if it is not set yet, and return the updated headers.
    /// If `commit_id` is `None`, this means no commit-id is known and we create a random ID (SHA1) instead.
    ///
    /// Use this when headers already exist or are being built up incrementally, but a stored
    /// `change-id` header still needs to be ensured.
    pub fn ensure_change_id(mut self, commit_id: impl Into<Option<gix::ObjectId>>) -> Self {
        if self.change_id.is_none() {
            self.change_id = commit_id
                .into()
                .map_or_else(ChangeId::generate, Self::synthetic_change_id_from_commit_id)
                .into();
        }
        self
    }

    /// Creates a new set of headers with a randomly generated change_id.
    #[cfg(feature = "legacy")]
    #[deprecated = "We want deterministic change-ids, use Headers::synthetic_change_id_from_commit_id() instead."]
    pub fn new_with_random_change_id() -> Self {
        Self {
            change_id: Some(ChangeId::generate()),
            conflicted: None,
        }
    }

    /// Create a new instance, with the following rules for setting the change id header:
    /// 1. Read `gitbutler.testing.changeId` from `config` and if it's a valid u128 integer, use it as change-id.
    /// 2. generate a new change-id
    ///
    /// This produces a stored header value. For the deterministic fallback used when headerless
    /// commits still need a change-id, see [`Self::ensure_change_id()`].
    pub fn from_config(config: &gix::config::Snapshot) -> Self {
        Headers {
            change_id: Some(
                config
                    .integer("gitbutler.testing.changeId")
                    .and_then(|id| {
                        u128::try_from(id)
                            .ok()
                            .map(ChangeId::from_number_for_testing)
                    })
                    .unwrap_or_else(ChangeId::generate),
            ),
            conflicted: None,
        }
    }

    /// Extract header information from the given `commit`, or return `None` if not present.
    pub fn try_from_commit(commit: &gix::objs::Commit) -> Option<Self> {
        Self::try_from_commit_headers(|| commit.extra_headers())
    }

    /// Extract header information from the given [`extra_headers`](gix::objs::Commit::extra_headers()) function,
    /// or return `None` if not present.
    ///
    /// The `change-id` header takes precedence over the legacy `gitbutler-change-id` header.
    /// If neither header is present and a stable fallback is required, use
    /// `Headers::unwrap_or_default().ensure_change_id(commit_id)`
    pub fn try_from_commit_headers<'a, I>(
        extra_headers: impl Fn() -> gix::objs::commit::ExtraHeaders<I>,
    ) -> Option<Self>
    where
        I: Iterator<Item = (&'a BStr, &'a BStr)>,
    {
        let change_id = extra_headers()
            .find(HEADERS_NEW_CHANGE_ID_FIELD)
            .or_else(|| extra_headers().find(HEADERS_CHANGE_ID_FIELD))
            .map(ChangeId::from);

        let conflicted = extra_headers()
            .find(HEADERS_CONFLICTED_FIELD)
            .and_then(|value| value.to_str().ok()?.parse::<u64>().ok());

        if change_id.is_none() && conflicted.is_none() {
            return None;
        }

        Some(Headers {
            change_id,
            conflicted,
        })
    }

    /// Remove all header fields from `commit`.
    pub fn remove_in_commit(commit: &mut gix::objs::Commit) {
        for field in [
            HEADERS_VERSION_FIELD,
            HEADERS_CHANGE_ID_FIELD,
            HEADERS_CONFLICTED_FIELD,
            HEADERS_NEW_CHANGE_ID_FIELD,
        ] {
            if let Some(pos) = commit.extra_headers().find_pos(field) {
                commit.extra_headers.remove(pos);
            }
        }
    }

    /// Write the values from this instance to the given `commit`, fully replacing any header
    /// that might have been there before.
    ///
    /// This always writes the canonical `change-id` header for [`Self::change_id`]. Use
    /// [`Self::ensure_change_id()`] to persist a deterministic fallback,
    pub fn set_in_commit(&self, commit: &mut gix::objs::Commit) {
        Self::remove_in_commit(commit);
        commit
            .extra_headers
            .extend(Vec::<(BString, BString)>::from(self));
    }
}

const HEADERS_VERSION_FIELD: &str = "gitbutler-headers-version";
const HEADERS_CHANGE_ID_FIELD: &str = "gitbutler-change-id";
const HEADERS_NEW_CHANGE_ID_FIELD: &str = "change-id";
/// The name of the header field that stores the amount of conflicted files.
pub const HEADERS_CONFLICTED_FIELD: &str = "gitbutler-conflicted";
const HEADERS_VERSION: &str = "2";

impl From<&Headers> for Vec<(BString, BString)> {
    fn from(hdr: &Headers) -> Self {
        let mut out = vec![(
            BString::from(HEADERS_VERSION_FIELD),
            BString::from(HEADERS_VERSION),
        )];

        if let Some(change_id) = &hdr.change_id {
            out.push((HEADERS_NEW_CHANGE_ID_FIELD.into(), (**change_id).clone()));
        }

        if let Some(conflicted) = hdr.conflicted {
            out.push((
                HEADERS_CONFLICTED_FIELD.into(),
                conflicted.to_string().into(),
            ));
        }
        out
    }
}

/// Determines how to sign the commit.
#[derive(Default, PartialEq, Copy, Clone, Debug)]
pub enum SignCommit {
    /// Unconditionally sign the commit. Note that this places responsibility on the caller to
    /// ensure that commit signing is configured, or at least handling that it was not.
    Yes,
    /// Do not sign the commit.
    No,
    /// Sign the commit only if `gitbutler.signCommits=true`, *or* `gitbutler.signCommits` is unset
    /// but `commit.gpgSign=true`. In other words, `gitbutler.signCommits` takes precedence over
    /// `commit.gpgSign`, the latter only being checked if the former is not at all configured.
    ///
    /// If signing fails, `gitbutler.signCommits` is set to `false` locally, preventing further
    /// signing when this variant is supplied. This step is however skipped if
    /// `gitbutler.signCommits` has been explicitly configured in non-local Git Config.
    ///
    /// The need for `gitbutler.signCommits` stems from the fact that it can be difficult to
    /// impossible to validate before hand that signing is properly configured. Signing may also
    /// break after validation has been performed. If signing is enabled for *all* committing but
    /// fails, GitButler basically can't do anything, so we flip `gitbutler.signCommits=false` as a
    /// kill switch to disable signing for GitButler. `gitbutler.signCommits` taking precedence
    /// over `commit.gpgSign` means we can honor Git's signing settings by default, but disable it
    /// in the event that we fail to sign without affecting Git.
    #[default]
    IfSignCommitsEnabled,
}

/// Write `commit` into `repo`, removing any existing commit signature first, optionally creating a
/// new one based on repository configuration, and optionally updating `update_ref` to the new ID.
///
/// Apply any desired message/header mutations, such as Gerrit trailers, before calling this helper.
pub fn create(
    repo: &gix::Repository,
    mut commit: gix::objs::Commit,
    update_ref: Option<&gix::refs::FullNameRef>,
    sign_commit: SignCommit,
) -> anyhow::Result<gix::ObjectId> {
    if let Some(pos) = commit
        .extra_headers()
        .find_pos(gix::objs::commit::SIGNATURE_FIELD_NAME)
    {
        commit.extra_headers.remove(pos);
    }

    if (sign_commit == SignCommit::IfSignCommitsEnabled
        && repo.git_settings()?.gitbutler_sign_commits.unwrap_or(false))
        || sign_commit == SignCommit::Yes
    {
        let mut buf = Vec::new();
        commit.write_to(&mut buf)?;
        match sign_buffer(repo, &buf) {
            Ok(signature) => {
                commit
                    .extra_headers
                    .push((gix::objs::commit::SIGNATURE_FIELD_NAME.into(), signature));
            }
            Err(err) => {
                tracing::warn!("Commit signing failed with sign_commit={sign_commit:?}");
                if sign_commit == SignCommit::IfSignCommitsEnabled {
                    if repo
                        .config_snapshot()
                        .boolean_filter("gitbutler.signCommits", |md| {
                            md.source != gix::config::Source::Local
                        })
                        .is_none()
                    {
                        repo.set_git_settings(&GitConfigSettings {
                            gitbutler_sign_commits: Some(false),
                            ..GitConfigSettings::default()
                        })?;
                    } else {
                        tracing::warn!(
                            "Commit signing failed but remains enabled as gitbutler.signCommits is explicitly enabled globally"
                        );
                    }
                }
                return Err(err
                    .context("Failed to sign commit")
                    .context(Code::CommitSigningFailed));
            }
        }
    }

    let oid = repo.write_object(&commit)?.detach();
    if let Some(update_ref) = update_ref {
        repo.reference(
            update_ref,
            oid,
            gix::refs::transaction::PreviousValue::Any,
            commit.message.as_bstr(),
        )?;
    }
    Ok(oid)
}

/// Sign `buffer` using repository configuration as obtained through `repo`,
/// similarly to Git's commit signing behavior.
pub fn sign_buffer(repo: &gix::Repository, buffer: &[u8]) -> anyhow::Result<BString> {
    fn into_command(prepare: gix::command::Prepare) -> std::process::Command {
        let cmd: std::process::Command = prepare.into();
        tracing::debug!(?cmd, "command to produce commit signature");
        cmd
    }

    fn as_literal_key(maybe_key: &BStr) -> Option<&BStr> {
        if let Some(key) = maybe_key.strip_prefix(b"key::") {
            return Some(key.into());
        }
        if maybe_key.starts_with(b"ssh-") {
            return Some(maybe_key);
        }
        None
    }

    fn signing_key(repo: &gix::Repository) -> anyhow::Result<BString> {
        if let Some(key) = repo.config_snapshot().string("user.signingkey") {
            return Ok(key.into_owned());
        }
        tracing::info!("Falling back to committer identity as user.signingKey isn't configured.");
        let mut buf = Vec::<u8>::new();
        repo.committer()
            .transpose()?
            .context("user.signingKey isn't configured and no committer is available either")?
            .actor()
            .trim()
            .write_to(&mut buf)?;
        Ok(buf.into())
    }

    let config = repo.config_snapshot();
    let signing_key = signing_key(repo)?;
    let sign_format = config.string("gpg.format");
    let is_ssh = sign_format.is_some_and(|value| value.as_ref() == "ssh");

    if is_ssh {
        let mut signature_storage = tempfile::NamedTempFile::new()?;
        signature_storage.write_all(buffer)?;
        let buffer_file_to_sign_path = signature_storage.into_temp_path();

        let gpg_program = config
            .trusted_program("gpg.ssh.program")
            .filter(|program| !program.is_empty())
            .map_or_else(
                || Path::new("ssh-keygen").into(),
                |program| Cow::Owned(program.into_owned().into()),
            );

        let mut signing_cmd = prepare_with_shell_on_windows(gpg_program.into_owned())
            .args(["-Y", "sign", "-n", "git", "-f"]);

        let _key_storage;
        signing_cmd = if let Some(signing_key) = as_literal_key(signing_key.as_bstr()) {
            let mut keyfile = tempfile::NamedTempFile::new()?;
            keyfile.write_all(signing_key.as_bytes())?;

            #[cfg(unix)]
            {
                use std::os::unix::prelude::PermissionsExt;

                let mut permissions = keyfile.as_file().metadata()?.permissions();
                permissions.set_mode(0o600);
                keyfile.as_file().set_permissions(permissions)?;
            }

            let keyfile_path = keyfile.path().to_owned();
            _key_storage = keyfile.into_temp_path();
            signing_cmd
                .arg(keyfile_path)
                .arg("-U")
                .arg(buffer_file_to_sign_path.to_path_buf())
        } else {
            let signing_key = config
                .trusted_path("user.signingkey")
                .transpose()?
                .with_context(|| format!("Didn't trust 'ssh.signingKey': {signing_key}"))?;
            signing_cmd
                .arg(signing_key.into_owned())
                .arg(buffer_file_to_sign_path.to_path_buf())
        };
        let output = into_command(signing_cmd)
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .stdin(Stdio::null())
            .output()?;

        if output.status.success() {
            let signature_path = buffer_file_to_sign_path.with_extension("sig");
            let sig_data = std::fs::read(signature_path)?;
            Ok(BString::new(sig_data))
        } else {
            let stderr = BString::new(output.stderr);
            let stdout = BString::new(output.stdout);
            bail!("Failed to sign SSH: {stdout} {stderr}");
        }
    } else {
        let gpg_program = config
            .trusted_program("gpg.program")
            .filter(|program| !program.is_empty())
            .map_or_else(
                || Path::new("gpg").into(),
                |program| Cow::Owned(program.into_owned().into()),
            );

        let mut cmd = into_command(
            prepare_with_shell_on_windows(gpg_program.as_ref())
                .args(["--status-fd=2", "-bsau"])
                .arg(gix::path::from_bstring(signing_key))
                .arg("-"),
        );
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                bail!(
                    "Could not find '{}'. Please make sure it is in your `PATH` or configure the full path using `gpg.program` in the Git configuration",
                    gpg_program.display()
                )
            }
            Err(err) => {
                return Err(err).context(format!("Could not execute GPG program using {cmd:?}"));
            }
        };
        child.stdin.take().expect("configured").write_all(buffer)?;

        let output = child.wait_with_output()?;
        if output.status.success() {
            Ok(BString::new(output.stdout))
        } else {
            let stderr = BString::new(output.stderr);
            let stdout = BString::new(output.stdout);
            bail!("Failed to sign GPG: {stdout} {stderr}");
        }
    }
}

/// When commits are in conflicting state, they store various trees which to help deal with the conflict.
///
/// This also includes variant that represents the blob which contains the
/// conflicted information.
#[derive(Debug, Copy, Clone)]
pub enum TreeKind {
    /// Our tree that caused a conflict during the merge.
    Ours,
    /// Their tree that caused a conflict during the merge.
    Theirs,
    /// The base of the conflicting mereg.
    Base,
    /// The tree that resulted from the merge with auto-resolution enabled.
    AutoResolution,
    /// The information about what is conflicted.
    ConflictFiles,
}

impl TreeKind {
    /// Return then name of the entry this tree would take in the 'meta' tree that captures cherry-pick conflicts.
    pub fn as_tree_entry_name(&self) -> &'static str {
        match self {
            TreeKind::Ours => ".conflict-side-0",
            TreeKind::Theirs => ".conflict-side-1",
            TreeKind::Base => ".conflict-base-0",
            TreeKind::AutoResolution => ".auto-resolution",
            TreeKind::ConflictFiles => ".conflict-files",
        }
    }
}

/// Lifecycle
impl<'repo> Commit<'repo> {
    /// Decode the object at `commit_id` and keep its data for later query.
    pub fn from_id(commit_id: gix::Id<'repo>) -> anyhow::Result<Self> {
        commit_id.object()?.try_into_commit()?.try_into()
    }
}

impl<'repo> TryFrom<gix::Commit<'repo>> for Commit<'repo> {
    type Error = anyhow::Error;

    fn try_from(value: gix::Commit<'repo>) -> Result<Self, Self::Error> {
        let id = value.id();
        let commit = value.decode()?.try_into()?;
        Ok(Commit { id, inner: commit })
    }
}

impl From<Commit<'_>> for CommitOwned {
    fn from(Commit { id, inner }: Commit<'_>) -> Self {
        CommitOwned {
            id: id.detach(),
            inner,
        }
    }
}

impl std::ops::Deref for Commit<'_> {
    type Target = gix::objs::Commit;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl std::ops::DerefMut for Commit<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl std::ops::Deref for CommitOwned {
    type Target = gix::objs::Commit;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl std::ops::DerefMut for CommitOwned {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl Headers {
    /// Return `true` if this commit contains a tree that is conflicted.
    pub fn is_conflicted(&self) -> bool {
        self.conflicted.is_some()
    }
}

impl CommitOwned {
    /// Attach `repo` to this instance to be able to do way more with it.
    pub fn attach(self, repo: &gix::Repository) -> Commit<'_> {
        let CommitOwned { id, inner } = self;
        Commit {
            id: id.attach(repo),
            inner,
        }
    }

    /// Return the stored change-id if present, or derive a deterministic fallback from the commit id.
    pub fn change_id(&self) -> ChangeId {
        Headers::try_from_commit(&self.inner)
            .unwrap_or_default()
            .ensure_change_id(self.id)
            .change_id
            .expect("change-id is ensured")
    }
}

/// Mutations
impl Commit<'_> {
    /// Set this commit to use the given `headers`, completely replacing the ones it might currently have.
    pub fn set_headers(&mut self, header: &Headers) {
        header.set_in_commit(self)
    }
}

/// Access
impl<'repo> Commit<'repo> {
    /// Remove the `repo` reference to become a fully owned instance.
    pub fn detach(self) -> CommitOwned {
        self.into()
    }

    /// Return `true` if this commit contains a tree that is conflicted.
    ///
    /// Checks the commit message for conflict markers first (new style),
    /// then falls back to the `gitbutler-conflicted` header (legacy).
    pub fn is_conflicted(&self) -> bool {
        message_is_conflicted(self.inner.message.as_ref())
            || self.headers().is_some_and(|hdr| hdr.is_conflicted())
    }

    /// If the commit is conflicted, then it returns the auto-resolution tree,
    /// otherwise it returns the commit's tree.
    ///
    /// Most of the time this is what you want to use when diffing or
    /// displaying the commit to the user.
    pub fn tree_id_or_auto_resolution(&self) -> anyhow::Result<gix::Id<'repo>> {
        self.tree_id_or_kind(TreeKind::AutoResolution)
    }

    /// If the commit is conflicted, then return the particular conflict-tree
    /// specified by `kind`, otherwise return the commit's tree.
    ///
    /// Most of the time, you will probably want to use [`Self::tree_id_or_auto_resolution()`]
    /// instead.
    pub fn tree_id_or_kind(&self, kind: TreeKind) -> anyhow::Result<gix::Id<'repo>> {
        Ok(if self.is_conflicted() {
            self.inner
                .tree
                .attach(self.id.repo)
                .object()?
                .into_tree()
                .find_entry(kind.as_tree_entry_name())
                .with_context(|| format!("Unexpected tree in conflicting commit {}", self.id))?
                .id()
        } else {
            self.inner.tree.attach(self.id.repo)
        })
    }

    /// If the commit is conflicted, returns the base, ours, and theirs tree IDs.
    pub fn conflicted_tree_ids(
        &self,
    ) -> anyhow::Result<Option<(gix::Id<'repo>, gix::Id<'repo>, gix::Id<'repo>)>> {
        if !self.is_conflicted() {
            return Ok(None);
        }
        let tree = self.inner.tree.attach(self.id.repo).object()?.into_tree();
        Ok(Some((
            tree.find_entry(TreeKind::Base.as_tree_entry_name())
                .with_context(|| format!("No base tree in conflicting commit {}", self.id))?
                .id(),
            tree.find_entry(TreeKind::Ours.as_tree_entry_name())
                .with_context(|| format!("No ours tree in conflicting commit {}", self.id))?
                .id(),
            tree.find_entry(TreeKind::Theirs.as_tree_entry_name())
                .with_context(|| format!("No theirs tree in conflicting commit {}", self.id))?
                .id(),
        )))
    }

    /// Return our custom headers, of present.
    pub fn headers(&self) -> Option<Headers> {
        Headers::try_from_commit(&self.inner)
    }

    /// Return the stored change-id if present, or derive a deterministic fallback from the commit id.
    pub fn change_id(&self) -> ChangeId {
        self.headers()
            .unwrap_or_default()
            .ensure_change_id(self.id.detach())
            .change_id
            .expect("change-id is ensured")
    }
}

/// Conflict specific details
impl Commit<'_> {
    /// Obtains the conflict entries of a conflicted commit if the commit is
    /// conflicted, otherwise returns None.
    pub fn conflict_entries(&self) -> anyhow::Result<Option<ConflictEntries>> {
        let repo = self.id.repo;

        if !self.is_conflicted() {
            return Ok(None);
        }

        let tree = repo.find_tree(self.tree)?;
        let Some(conflicted_entries_blob) =
            tree.find_entry(TreeKind::ConflictFiles.as_tree_entry_name())
        else {
            bail!(
                "There has been a malformed conflicted commit, unable to find the conflicted files"
            );
        };
        let conflicted_entries_blob = conflicted_entries_blob.object()?.into_blob();
        let conflicted_entries: ConflictEntries =
            toml::from_str(&conflicted_entries_blob.data.as_bstr().to_str_lossy())?;

        Ok(Some(conflicted_entries))
    }
}

/// Represents what was causing a particular commit to conflict when rebased.
#[derive(Default, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ConflictEntries {
    /// The ancestors that were conflicted
    pub ancestor_entries: Vec<PathBuf>,
    /// The ours side entries that were conflicted
    pub our_entries: Vec<PathBuf>,
    /// The theirs side entries that were conflicted
    pub their_entries: Vec<PathBuf>,
}
#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(ConflictEntries);

impl ConflictEntries {
    /// If there are any conflict entries
    pub fn has_entries(&self) -> bool {
        !self.ancestor_entries.is_empty()
            || !self.our_entries.is_empty()
            || !self.their_entries.is_empty()
    }

    /// The total count of conflicted entries
    pub fn total_entries(&self) -> usize {
        let set = self
            .ancestor_entries
            .iter()
            .chain(self.our_entries.iter())
            .chain(self.their_entries.iter())
            .collect::<HashSet<_>>();

        set.len()
    }
}

/// The prefix prepended to the commit subject line to mark a conflicted commit.
pub const CONFLICT_MESSAGE_PREFIX: &str = "[conflict] ";

/// The git trailer token used to identify GitButler-managed conflicted commits.
/// The description explaining the conflict is embedded as the multi-line trailer
/// value, with continuation lines indented by 3 spaces per git convention.
const CONFLICT_TRAILER_TOKEN: &str = "GitButler-Conflict";

/// The full multi-line git trailer appended to conflicted commit messages.
/// The description is the trailer value; continuation lines are indented with
/// 3 spaces so standard git trailer tools can parse and manipulate them.
const CONFLICT_TRAILER: &str = concat!(
    "GitButler-Conflict: This is a GitButler-managed conflicted commit. Files are auto-resolved\n",
    "   using the \"ours\" side. The commit tree contains additional directories:\n",
    "     .conflict-side-0  \u{2014} our tree\n",
    "     .conflict-side-1  \u{2014} their tree\n",
    "     .conflict-base-0  \u{2014} the merge base tree\n",
    "     .auto-resolution  \u{2014} the auto-resolved tree\n",
    "     .conflict-files   \u{2014} metadata about conflicted files\n",
    "   To manually resolve, check out this commit, remove the directories\n",
    "   listed above, resolve the conflicts, and amend the commit."
);

/// Add conflict markers to a commit message: prepend `[conflict] ` to the
/// subject and append the `GitButler-Conflict` multi-line trailer after any
/// existing trailers.
///
/// A single trailing newline is trimmed from the input before markers are
/// added; callers that need byte-exact round-trips should account for this.
pub fn add_conflict_markers(message: &BStr) -> BString {
    let trimmed = message
        .as_bytes()
        .strip_suffix(b"\n")
        .unwrap_or(message.as_bytes());

    let capacity = CONFLICT_MESSAGE_PREFIX.len() + trimmed.len() + 2 + CONFLICT_TRAILER.len() + 1;
    let mut result = BString::from(Vec::with_capacity(capacity));
    result.extend_from_slice(CONFLICT_MESSAGE_PREFIX.as_bytes());
    result.extend_from_slice(trimmed);

    // Trailers must be in the last paragraph — join directly if one exists.
    if ends_in_trailer_block(trimmed) {
        result.push(b'\n');
    } else {
        result.extend_from_slice(b"\n\n");
    }
    result.extend_from_slice(CONFLICT_TRAILER.as_bytes());
    result.push(b'\n');
    result
}

/// Strip conflict markers from a commit message.
/// Returns the message unchanged when it is not conflicted (per
/// [`message_is_conflicted`]).
///
/// Strips the `[conflict] ` subject prefix (if present) and the
/// `GitButler-Conflict` trailer line together with all its indented
/// continuation lines.
///
/// Note: the returned message may not be byte-identical to the original —
/// trailing newlines are not preserved and line endings may be normalized.
pub fn strip_conflict_markers(message: &BStr) -> BString {
    if !message_is_conflicted(message) {
        return message.to_owned();
    }

    let bytes = message.as_bytes();

    // Strip the subject prefix if present.
    let without_prefix = bytes
        .strip_prefix(CONFLICT_MESSAGE_PREFIX.as_bytes())
        .unwrap_or(bytes);

    // Remove the GitButler-Conflict trailer only from the last paragraph
    // to avoid accidentally stripping user-authored content earlier in the body
    // that happens to match the trailer token.
    let lines: Vec<&[u8]> = without_prefix.lines().collect();
    let mut result_lines: Vec<&[u8]> = Vec::with_capacity(lines.len());

    // Find the start of the last paragraph (after the last blank line).
    let last_para_start = lines
        .iter()
        .enumerate()
        .rev()
        .find(|(_, l)| l.is_empty())
        .map(|(i, _)| i + 1)
        .unwrap_or(0);

    // Copy everything before the last paragraph unchanged.
    let mut i = 0;
    while i < last_para_start {
        result_lines.push(lines[i]);
        i += 1;
    }

    // In the last paragraph, strip the conflict trailer and its continuation lines.
    while i < lines.len() {
        let line = lines[i];
        if line_starts_with_conflict_trailer(line) {
            i += 1;
            while i < lines.len() && lines[i].first().is_some_and(|b| b.is_ascii_whitespace()) {
                i += 1;
            }
        } else {
            result_lines.push(line);
            i += 1;
        }
    }

    // Drop trailing blank lines left behind after removing the trailer.
    while result_lines.last().is_some_and(|l| l.is_empty()) {
        result_lines.pop();
    }

    let mut result = BString::from(Vec::new());
    for (idx, line) in result_lines.iter().enumerate() {
        if idx > 0 {
            result.push(b'\n');
        }
        result.extend_from_slice(line);
    }
    result
}

/// Returns `true` when the commit message contains a `GitButler-Conflict:`
/// trailer in the last paragraph. The `[conflict] ` subject prefix is
/// informational and not required for detection.
///
/// Trailing blank lines are skipped so that messages edited by users or tools
/// that append newlines are still detected correctly.
///
/// Note: once the upstream fix for `gix`'s `BodyRef::from_bytes` (which
/// currently fails to detect trailers that are the sole body content) is
/// released, this can be simplified to use `gix`'s trailer parser directly.
pub fn message_is_conflicted(message: &BStr) -> bool {
    let bytes = message.as_bytes();
    let mut in_content = false;
    for line in bytes.lines().rev() {
        if line.is_empty() {
            if in_content {
                break;
            }
            // Skip trailing blank lines before the last paragraph.
            continue;
        }
        in_content = true;
        if line_starts_with_conflict_trailer(line) {
            return true;
        }
    }
    false
}

/// If `old_message` is conflicted but `new_message` is not, re-apply the
/// conflict markers to `new_message`. This is used during reword and squash
/// so that editing a conflicted commit's message doesn't silently drop the
/// conflict state.
///
/// Strips any existing partial markers from `new_message` before re-adding
/// to avoid double-prefixing or duplicate trailers.
pub fn rewrite_conflict_markers_on_message_change(
    old_message: &BStr,
    new_message: BString,
) -> BString {
    if message_is_conflicted(old_message) && !message_is_conflicted(new_message.as_ref()) {
        // Strip the `[conflict] ` prefix if the user left it in,
        // then re-add the full set of markers.
        let clean = new_message
            .as_bytes()
            .strip_prefix(CONFLICT_MESSAGE_PREFIX.as_bytes())
            .map(BString::from)
            .unwrap_or(new_message);
        add_conflict_markers(clean.as_ref())
    } else {
        new_message
    }
}

/// Returns `true` if `bytes` ends with a git trailer block — a paragraph where
/// every line is either a `Token: value` trailer or an indented continuation.
fn ends_in_trailer_block(bytes: &[u8]) -> bool {
    let lines: Vec<&[u8]> = bytes.lines().collect();

    // Trailers must be in a paragraph separated by a blank line from the subject.
    // If there is no blank line, there is no trailer block.
    let Some(blank_pos) = lines
        .iter()
        .enumerate()
        .rev()
        .find(|(_, l)| l.is_empty())
        .map(|(i, _)| i)
    else {
        return false;
    };
    let para_start = blank_pos + 1;

    let para = &lines[para_start..];
    if para.is_empty() {
        return false;
    }

    let mut found_any = false;
    let mut prev_was_trailer_or_continuation = false;
    for line in para {
        let is_continuation = line.first().is_some_and(|b| b.is_ascii_whitespace());
        if is_continuation {
            if !prev_was_trailer_or_continuation {
                return false;
            }
            prev_was_trailer_or_continuation = true;
        } else if is_trailer_line(line) {
            found_any = true;
            prev_was_trailer_or_continuation = true;
        } else {
            return false;
        }
    }
    found_any
}

/// Returns `true` for lines of the form `Token: value` where `Token` contains
/// no spaces and the value is non-empty (i.e. `: ` follows the token).
fn is_trailer_line(line: &[u8]) -> bool {
    let Some(colon) = line.find_byte(b':') else {
        return false;
    };
    if colon == 0 {
        return false;
    }
    let token = &line[..colon];
    !token.contains(&b' ') && line.get(colon + 1) == Some(&b' ')
}

/// Returns `true` when `line` starts with `GitButler-Conflict:`.
fn line_starts_with_conflict_trailer(line: &[u8]) -> bool {
    line.strip_prefix(CONFLICT_TRAILER_TOKEN.as_bytes())
        .is_some_and(|rest| rest.first() == Some(&b':'))
}

#[cfg(test)]
mod conflict_marker_tests {
    use bstr::BStr;

    use super::*;

    fn marked(msg: &str) -> String {
        String::from_utf8(add_conflict_markers(BStr::new(msg)).into()).unwrap()
    }

    fn stripped(msg: &str) -> String {
        String::from_utf8(strip_conflict_markers(BStr::new(msg)).into()).unwrap()
    }

    fn is_conflicted(msg: &str) -> bool {
        message_is_conflicted(BStr::new(msg))
    }

    /// Round-trip: add then strip returns the original (modulo the trailing
    /// newline that `add_conflict_markers` always trims).
    #[test]
    fn simple_subject_roundtrip() {
        let original = "fix the bug";
        let result = stripped(&marked(original));
        assert_eq!(result, original);
        assert!(is_conflicted(&marked(original)));
    }

    #[test]
    fn trailing_newline_is_trimmed_by_add() {
        // add_conflict_markers trims a trailing newline; strip reflects that.
        assert_eq!(stripped(&marked("fix the bug\n")), "fix the bug");
    }

    #[test]
    fn subject_and_body_roundtrip() {
        let original = "fix the bug\n\nDetailed explanation here.";
        assert_eq!(stripped(&marked(original)), original);
    }

    #[test]
    fn existing_trailers_are_preserved_and_ours_comes_last() {
        let original = "fix the bug\n\nChange-Id: I1234567\nSigned-off-by: User <u@e.com>";
        let result = marked(original);
        assert!(is_conflicted(&result));

        // Existing trailers must still be present
        assert!(result.contains("Change-Id: I1234567\n"));
        assert!(result.contains("Signed-off-by: User <u@e.com>\n"));

        // Our trailer must come after the existing ones
        let signed_pos = result.find("Signed-off-by:").unwrap();
        let conflict_pos = result.find(CONFLICT_TRAILER_TOKEN).unwrap();
        assert!(
            conflict_pos > signed_pos,
            "GitButler-Conflict trailer must follow existing trailers"
        );

        // Roundtrip
        assert_eq!(stripped(&result), original);
    }

    #[test]
    fn subject_with_only_trailers_roundtrip() {
        let original = "fix the bug\n\nChange-Id: I1234567";
        assert_eq!(stripped(&marked(original)), original);
    }

    #[test]
    fn body_and_trailers_roundtrip() {
        let original =
            "fix the bug\n\nSome explanation.\n\nChange-Id: I1234567\nSigned-off-by: A <a@b.com>";
        assert_eq!(stripped(&marked(original)), original);
    }

    #[test]
    fn description_is_the_trailer_value_not_a_separate_paragraph() {
        let result = marked("subject");
        // The description must appear on the same line as GitButler-Conflict:
        // (or as indented continuation lines), not as a separate paragraph.
        let trailer_start = format!("{CONFLICT_TRAILER_TOKEN}:");
        let conflict_line = result
            .lines()
            .find(|l| l.starts_with(&trailer_start))
            .expect("trailer line must exist");
        assert!(
            conflict_line.len() > trailer_start.len(),
            "trailer token must have an inline value, got: {conflict_line:?}"
        );
    }

    #[test]
    fn prefix_without_trailer_is_not_conflicted() {
        assert!(!is_conflicted("[conflict] looks real but no trailer"));
    }

    #[test]
    fn trailer_without_prefix_is_still_conflicted() {
        let msg = "normal commit\n\nGitButler-Conflict: sneaky";
        // Detection depends only on the trailer, not the prefix.
        assert!(is_conflicted(msg));
        // Strip removes the trailer even without the prefix.
        assert_eq!(stripped(msg), "normal commit");
    }

    #[test]
    fn add_is_idempotent_when_guarded() {
        let original = "subject";
        let once = marked(original);
        // Callers guard with message_is_conflicted; verify that guard works
        assert!(is_conflicted(&once));
        // Stripping twice is also stable
        assert_eq!(stripped(&once), stripped(&stripped(&once)));
    }

    #[test]
    fn trailing_blank_lines_after_trailer_still_detected() {
        let msg = format!("subject\n\n{CONFLICT_TRAILER}\n\n");
        assert!(
            is_conflicted(&msg),
            "trailing blank lines must not break detection"
        );
    }

    /// The trailer token appearing in the body (not the last paragraph) must
    /// not be stripped — only the actual trailer in the last paragraph is removed.
    #[test]
    fn strip_only_removes_trailer_from_last_paragraph() {
        let body_with_token = format!(
            "[conflict] subject\n\nGitButler-Conflict: mentioned in body\n\n{CONFLICT_TRAILER}\n"
        );
        assert!(is_conflicted(&body_with_token));
        let result = stripped(&body_with_token);
        assert!(
            result.contains("GitButler-Conflict: mentioned in body"),
            "body occurrence must be preserved, got: {result:?}"
        );
        assert!(
            !result.contains("This is a GitButler-managed"),
            "the trailer itself must be removed"
        );
    }

    #[test]
    fn rewrite_does_not_double_prefix() {
        let original = "fix bug";
        let conflicted = marked(original);
        // Simulate a new message that already has the prefix but no trailer.
        let partial = format!("{CONFLICT_MESSAGE_PREFIX}fix bug");
        let result = rewrite_conflict_markers_on_message_change(
            BStr::new(&conflicted),
            BString::from(partial),
        );
        let result_str = std::str::from_utf8(result.as_ref()).unwrap();
        // Must not produce "[conflict] [conflict] fix bug".
        let prefix_count = result_str.matches(CONFLICT_MESSAGE_PREFIX).count();
        assert_eq!(prefix_count, 1, "prefix must appear exactly once");
        assert!(is_conflicted(result_str));
    }

    /// Verify that gix parses the `GitButler-Conflict` trailer alongside
    /// other standard trailers (Byron's review feedback).
    #[test]
    fn gix_parses_conflict_trailer_with_existing_trailers() {
        let original =
            "fix the bug\n\nSome body.\n\nChange-Id: I1234567\nSigned-off-by: A <a@b.com>";
        let result = marked(original);

        let msg = gix::objs::commit::MessageRef::from_bytes(BStr::new(&result));
        let body = msg.body().expect("message must have a body");
        let trailers: Vec<_> = body.trailers().collect();

        let tokens: Vec<&str> = trailers.iter().map(|t| t.token.to_str().unwrap()).collect();
        assert!(
            tokens.contains(&"Change-Id"),
            "Change-Id trailer must be parseable by gix, got: {tokens:?}"
        );
        assert!(
            tokens.contains(&"Signed-off-by"),
            "Signed-off-by trailer must be parseable by gix, got: {tokens:?}"
        );
        assert!(
            tokens.contains(&"GitButler-Conflict"),
            "GitButler-Conflict trailer must be parseable by gix, got: {tokens:?}"
        );
    }

    /// The `GitButler-Conflict` trailer must always be the last trailer in
    /// the message so it does not interfere with other trailer-based tools.
    #[test]
    fn conflict_trailer_is_last() {
        let original = "fix bug\n\nSome body.\n\nChange-Id: I123\nSigned-off-by: A <a@b.com>";
        let result = marked(original);

        let msg = gix::objs::commit::MessageRef::from_bytes(BStr::new(&result));
        let body = msg.body().expect("message must have a body");
        let trailers: Vec<_> = body.trailers().collect();
        let last = trailers.last().expect("must have at least one trailer");
        assert_eq!(
            last.token.to_str().unwrap(),
            "GitButler-Conflict",
            "conflict trailer must be the last trailer"
        );
    }

    /// Verify gix sees the `[conflict]` prefix in the title even for
    /// subject-only messages.
    ///
    /// Note: gix's trailer parser does not detect trailers when the body
    /// consists of only a single trailer paragraph (no preceding body text).
    /// Our manual detection handles this case; the gix interop tests below
    /// verify that messages WITH body text are parsed correctly by standard
    /// git trailer tools.
    #[test]
    fn subject_only_roundtrip_with_gix() {
        let original = "fix the bug";
        let result = marked(original);

        let msg = gix::objs::commit::MessageRef::from_bytes(BStr::new(&result));
        assert_eq!(
            msg.title.to_str().unwrap(),
            "[conflict] fix the bug",
            "gix must see the prefixed title"
        );

        // Round-trip
        assert_eq!(stripped(&result), original);
    }
}
