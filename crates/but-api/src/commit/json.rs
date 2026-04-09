use bstr::ByteSlice;
use serde::{Deserialize, Serialize};

use crate::{
    commit::types::CommitDiscardResult as EngineCommitDiscardResult,
    commit::types::CommitUndoResult as EngineCommitUndoResult, json::HexHash,
};

use super::types::{
    CommitCreateResult as EngineCommitCreateResult,
    CommitInsertBlankResult as EngineCommitInsertBlankResult,
    CommitMoveResult as EngineCommitMoveResult, CommitRewordResult as EngineCommitRewordResult,
    CommitSquashResult as EngineCommitSquashResult, MoveChangesResult as EngineMoveChangesResult,
};

/// JSON transport type for moving changes between commits.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct MoveChangesResult {
    /// Commits that have been mapped from one thing to another.
    /// Maps `oldId -> newId`.
    #[cfg_attr(
        feature = "export-schema",
        schemars(with = "std::collections::BTreeMap<String, String>")
    )]
    pub replaced_commits: std::collections::BTreeMap<HexHash, HexHash>,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(MoveChangesResult);

impl From<EngineMoveChangesResult> for MoveChangesResult {
    fn from(value: EngineMoveChangesResult) -> Self {
        let EngineMoveChangesResult { replaced_commits } = value;

        Self {
            replaced_commits: replaced_commits
                .into_iter()
                .map(|(old, new)| (old.into(), new.into()))
                .collect(),
        }
    }
}

/// A change that was rejected during commit creation, with the reason for rejection.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct RejectedChange {
    /// The reason the change was rejected.
    pub reason: but_core::tree::create_tree::RejectionReason,
    /// The file path of the rejected change, potentially degenerated if it can't be represented in Unicode.
    pub path: String,
    /// `path` without degeneration, as plain bytes.
    #[cfg_attr(
        feature = "export-schema",
        schemars(schema_with = "but_schemars::bstring_bytes")
    )]
    pub path_bytes: bstr::BString,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(RejectedChange);

/// JSON transport type for creating a commit in the rebase graph.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct CommitCreateResult {
    /// The new commit if one was created.
    #[cfg_attr(feature = "export-schema", schemars(with = "Option<String>"))]
    pub new_commit: Option<HexHash>,
    /// Changes that were rejected during commit creation.
    pub rejected_changes: Vec<RejectedChange>,
    /// Commits that have been replaced as a side-effect of the create/amend.
    /// Maps `oldId -> newId`.
    #[cfg_attr(
        feature = "export-schema",
        schemars(with = "std::collections::BTreeMap<String, String>")
    )]
    pub replaced_commits: std::collections::BTreeMap<HexHash, HexHash>,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(CommitCreateResult);

impl From<EngineCommitCreateResult> for CommitCreateResult {
    fn from(value: EngineCommitCreateResult) -> Self {
        let EngineCommitCreateResult {
            new_commit,
            rejected_specs,
            replaced_commits,
        } = value;

        Self {
            new_commit: new_commit.map(Into::into),
            rejected_changes: rejected_specs
                .into_iter()
                .map(|(reason, diff)| RejectedChange {
                    reason,
                    path: diff.path.to_str_lossy().into(),
                    path_bytes: diff.path,
                })
                .collect(),
            replaced_commits: replaced_commits
                .into_iter()
                .map(|(old, new)| (old.into(), new.into()))
                .collect(),
        }
    }
}

/// JSON transport type for rewording a commit.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct CommitRewordResult {
    /// The new commit ID after rewording.
    #[cfg_attr(feature = "export-schema", schemars(with = "String"))]
    pub new_commit: HexHash,
    /// Commits that have been replaced as a side-effect of the reword.
    /// Maps `oldId -> newId`.
    #[cfg_attr(
        feature = "export-schema",
        schemars(with = "std::collections::BTreeMap<String, String>")
    )]
    pub replaced_commits: std::collections::BTreeMap<HexHash, HexHash>,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(CommitRewordResult);

impl From<EngineCommitRewordResult> for CommitRewordResult {
    fn from(value: EngineCommitRewordResult) -> Self {
        let EngineCommitRewordResult {
            new_commit,
            replaced_commits,
        } = value;

        Self {
            new_commit: new_commit.into(),
            replaced_commits: replaced_commits
                .into_iter()
                .map(|(old, new)| (old.into(), new.into()))
                .collect(),
        }
    }
}

/// JSON transport type for squashing commits.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct CommitSquashResult {
    /// The new commit ID after squashing.
    #[cfg_attr(feature = "export-schema", schemars(with = "String"))]
    pub new_commit: HexHash,
    /// Commits that have been replaced as a side-effect of the squash.
    /// Maps `oldId -> newId`.
    #[cfg_attr(
        feature = "export-schema",
        schemars(with = "std::collections::BTreeMap<String, String>")
    )]
    pub replaced_commits: std::collections::BTreeMap<HexHash, HexHash>,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(CommitSquashResult);

impl From<EngineCommitSquashResult> for CommitSquashResult {
    fn from(value: EngineCommitSquashResult) -> Self {
        let EngineCommitSquashResult {
            new_commit,
            replaced_commits,
        } = value;

        Self {
            new_commit: new_commit.into(),
            replaced_commits: replaced_commits
                .into_iter()
                .map(|(old, new)| (old.into(), new.into()))
                .collect(),
        }
    }
}

/// JSON transport type for inserting a blank commit.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct CommitInsertBlankResult {
    /// The new blank commit ID.
    #[cfg_attr(feature = "export-schema", schemars(with = "String"))]
    pub new_commit: HexHash,
    /// Commits that have been replaced as a side-effect of the insertion.
    /// Maps `oldId -> newId`.
    #[cfg_attr(
        feature = "export-schema",
        schemars(with = "std::collections::BTreeMap<String, String>")
    )]
    pub replaced_commits: std::collections::BTreeMap<HexHash, HexHash>,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(CommitInsertBlankResult);

impl From<EngineCommitInsertBlankResult> for CommitInsertBlankResult {
    fn from(value: EngineCommitInsertBlankResult) -> Self {
        let EngineCommitInsertBlankResult {
            new_commit,
            replaced_commits,
        } = value;

        Self {
            new_commit: new_commit.into(),
            replaced_commits: replaced_commits
                .into_iter()
                .map(|(old, new)| (old.into(), new.into()))
                .collect(),
        }
    }
}

/// JSON transport type for moving a commit.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct CommitMoveResult {
    /// Commits that have been replaced as a side-effect of the move.
    /// Maps `oldId -> newId`.
    #[cfg_attr(
        feature = "export-schema",
        schemars(with = "std::collections::BTreeMap<String, String>")
    )]
    pub replaced_commits: std::collections::BTreeMap<HexHash, HexHash>,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(CommitMoveResult);

impl From<EngineCommitMoveResult> for CommitMoveResult {
    fn from(value: EngineCommitMoveResult) -> Self {
        let EngineCommitMoveResult { replaced_commits } = value;

        Self {
            replaced_commits: replaced_commits
                .into_iter()
                .map(|(old, new)| (old.into(), new.into()))
                .collect(),
        }
    }
}
/// JSON transport type for discarding a commit.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct CommitDiscardResult {
    /// The commit that was discarded as a result of this operation.
    #[cfg_attr(feature = "export-schema", schemars(with = "String"))]
    pub discarded_commit: HexHash,
    /// Commits that have been replaced as a side-effect of the commit discard.
    /// Maps `oldId -> newId`.
    #[cfg_attr(
        feature = "export-schema",
        schemars(with = "std::collections::BTreeMap<String, String>")
    )]
    pub replaced_commits: std::collections::BTreeMap<HexHash, HexHash>,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(CommitDiscardResult);

impl From<EngineCommitDiscardResult> for CommitDiscardResult {
    fn from(value: EngineCommitDiscardResult) -> Self {
        let EngineCommitDiscardResult {
            replaced_commits,
            discarded_commit,
        } = value;

        Self {
            discarded_commit: discarded_commit.into(),
            replaced_commits: replaced_commits
                .into_iter()
                .map(|(old, new)| (old.into(), new.into()))
                .collect(),
        }
    }
}

/// JSON transport type for undoing a commit.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct CommitUndoResult {
    /// The ID of the commit that was undone.
    #[cfg_attr(feature = "export-schema", schemars(with = "String"))]
    pub undone_commit: HexHash,
    /// Commits that were replaced by this operation. Maps `old_id -> new_id`.
    #[cfg_attr(
        feature = "export-schema",
        schemars(with = "std::collections::BTreeMap<String, String>")
    )]
    pub replaced_commits: std::collections::BTreeMap<HexHash, HexHash>,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(CommitUndoResult);

impl From<EngineCommitUndoResult> for CommitUndoResult {
    fn from(value: EngineCommitUndoResult) -> Self {
        let EngineCommitUndoResult {
            undone_commit,
            replaced_commits,
        } = value;

        Self {
            undone_commit: undone_commit.into(),
            replaced_commits: replaced_commits
                .into_iter()
                .map(|(old, new)| (old.into(), new.into()))
                .collect(),
        }
    }
}

/// Specifies a location, usually used to either have something inserted
/// relative to it, or for the selected object to actually be replaced.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", tag = "type", content = "subject")]
pub enum RelativeTo {
    /// Relative to a commit.
    #[serde(with = "but_serde::object_id")]
    #[cfg_attr(feature = "export-schema", schemars(with = "String"))]
    Commit(gix::ObjectId),
    /// Relative to a reference.
    #[serde(with = "but_serde::fullname_lossy")]
    #[cfg_attr(feature = "export-schema", schemars(with = "String"))]
    Reference(gix::refs::FullName),
    /// Relative to a reference, this time with teeth.
    #[cfg_attr(
        feature = "export-schema",
        schemars(schema_with = "but_schemars::fullname_bytes")
    )]
    ReferenceBytes(gix::refs::FullName),
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(RelativeTo);

impl From<RelativeTo> for but_rebase::graph_rebase::mutate::RelativeTo {
    fn from(value: RelativeTo) -> Self {
        match value {
            RelativeTo::Commit(commit) => Self::Commit(commit),
            RelativeTo::Reference(reference) | RelativeTo::ReferenceBytes(reference) => {
                Self::Reference(reference)
            }
        }
    }
}
