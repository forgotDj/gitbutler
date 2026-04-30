//! An action to squash one commit into another.

use anyhow::{Result, bail};
use but_core::RefMetadata;
use but_graph::{SegmentRelation, projection::Workspace};
use but_rebase::{
    commit::DateMode,
    graph_rebase::{
        Editor, Selector, Step, SuccessfulRebase, ToCommitSelector,
        mutate::{SegmentDelimiter, SelectorSet},
    },
};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum ReorderDirection {
    MoveSubjectAboveTarget,
    MoveSubjectBelowTarget,
}

fn determine_reorder_direction(
    workspace: &Workspace,
    repo: &gix::Repository,
    subject: &but_core::CommitOwned,
    target: &but_core::CommitOwned,
) -> Result<ReorderDirection> {
    let subject_segment = workspace
        .find_commit_segment_index(subject.id)
        .ok_or_else(|| anyhow::anyhow!("Couldn't resolve subject commit segment"))?;
    let target_segment = workspace
        .find_commit_segment_index(target.id)
        .ok_or_else(|| anyhow::anyhow!("Couldn't resolve target commit segment"))?;

    match workspace
        .graph
        .relation_between(subject_segment, target_segment)
    {
        SegmentRelation::Descendant => return Ok(ReorderDirection::MoveSubjectAboveTarget),
        SegmentRelation::Ancestor => return Ok(ReorderDirection::MoveSubjectBelowTarget),
        SegmentRelation::Disjoint | SegmentRelation::Diverged => {
            return Ok(ReorderDirection::MoveSubjectAboveTarget);
        }
        SegmentRelation::Identity => {
            // Commits can differ while still belonging to the same segment, so use commit-level
            // ancestry in this case.
        }
    }

    let merge_base = match repo.merge_base(subject.id, target.id) {
        Ok(base) => base,
        // If commits don't have a merge-base (or merge-base resolution fails),
        // we still allow squashing by using a deterministic default ordering.
        Err(error) => match error {
            gix::repository::merge_base::Error::FindMergeBase(_)
            | gix::repository::merge_base::Error::NotFound { .. } => {
                return Ok(ReorderDirection::MoveSubjectAboveTarget);
            }
            _ => return Err(error.into()),
        },
    };

    if merge_base == target.id {
        return Ok(ReorderDirection::MoveSubjectAboveTarget);
    }

    if merge_base == subject.id {
        return Ok(ReorderDirection::MoveSubjectBelowTarget);
    }

    Ok(ReorderDirection::MoveSubjectAboveTarget)
}

/// The result of a squash_commits operation.
#[derive(Debug)]
pub struct SquashCommitsOutcome<'ws, 'meta, M: RefMetadata> {
    /// The successful rebase result.
    pub rebase: SuccessfulRebase<'ws, 'meta, M>,
    /// Selector pointing to the squashed replacement commit.
    pub commit_selector: Selector,
}

/// How to combine messages of commits being squashed.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "export-schema", derive(schemars::JsonSchema))]
pub enum MessageCombinationStrategy {
    /// Keep both messages.
    KeepBoth,
    /// Only keep the message of the subject.
    ///
    /// Target message will be discarded.
    KeepSubject,
    /// Only keep the message of the target.
    ///
    /// Subject message will be discarded.
    KeepTarget,
}

#[cfg(feature = "export-schema")]
but_schemars::register_sdk_type!(MessageCombinationStrategy);

/// Squash `subject_commit` into `target_commit`.
///
/// Depending on the ancestry relationship between the two commits, this operation may
/// reorder them so that the subject ends up either above or below the target.
///
/// After any reordering, one of the two original commit positions (either the subject or
/// the target) is replaced by a single squashed commit that has:
/// - The tree of the commit that was top-most after reordering (subject or target)
/// - A message determined by `how_to_combine_messages`: either the subject message, the
///   target message, or both messages as `target\n\nsubject`
///
/// The other original commit (subject or target, depending on the chosen ordering) is
/// removed from history.
pub fn squash_commits<'ws, 'meta, M: RefMetadata>(
    editor: Editor<'ws, 'meta, M>,
    subject_commit: impl ToCommitSelector,
    target_commit: impl ToCommitSelector,
    how_to_combine_messages: MessageCombinationStrategy,
) -> Result<SquashCommitsOutcome<'ws, 'meta, M>> {
    let repo = editor.repo().clone();
    let successful_rebase = editor.rebase()?;
    let workspace = successful_rebase.overlayed_graph()?.into_workspace()?;
    let mut editor = successful_rebase.into_editor();

    let (subject_selector, subject) = editor.find_selectable_commit(subject_commit)?;
    let (target_selector, target) = editor.find_selectable_commit(target_commit)?;

    if subject.id == target.id {
        bail!("Cannot squash a commit into itself")
    }

    if subject.clone().attach(editor.repo()).is_conflicted() {
        bail!("Subject commit must not be conflicted")
    }

    if target.clone().attach(editor.repo()).is_conflicted() {
        bail!("Target commit must not be conflicted")
    }

    let direction = determine_reorder_direction(&workspace, &repo, &subject, &target)?;

    let mut combined_message = Vec::new();
    match how_to_combine_messages {
        MessageCombinationStrategy::KeepSubject => {
            combined_message.extend_from_slice(subject.message.as_ref());
        }
        MessageCombinationStrategy::KeepTarget => {
            combined_message.extend_from_slice(target.message.as_ref());
        }
        MessageCombinationStrategy::KeepBoth => {
            match (subject.message.is_empty(), target.message.is_empty()) {
                (true, true) => {
                    // both messages are empty, leave combined message as empty
                }
                (true, false) => {
                    // subject has no message, target does
                    combined_message.extend_from_slice(target.message.as_ref());
                }
                (false, true) => {
                    // subject has message, target doesn't
                    combined_message.extend_from_slice(subject.message.as_ref());
                }
                (false, false) => {
                    // both commits have messages, keep both
                    combined_message.extend_from_slice(target.message.as_ref());
                    if !combined_message.ends_with(b"\n") {
                        combined_message.push(b'\n');
                    }
                    combined_message.push(b'\n');
                    combined_message.extend_from_slice(subject.message.as_ref());
                }
            }
        }
    }

    let (replace_selector, dropped_selector, mut commit_to_replace, top_tree_id) = match direction {
        ReorderDirection::MoveSubjectAboveTarget => (
            target_selector,
            subject_selector,
            target.clone(),
            subject.tree,
        ),
        ReorderDirection::MoveSubjectBelowTarget => (
            subject_selector,
            target_selector,
            subject.clone(),
            target.tree,
        ),
    };

    let new_commit_id = {
        commit_to_replace.tree = top_tree_id;
        commit_to_replace.message = combined_message.into();
        editor.new_commit(commit_to_replace, DateMode::CommitterUpdateAuthorKeep)?
    };

    let dropped_delimiter = SegmentDelimiter {
        child: dropped_selector,
        parent: dropped_selector,
    };
    editor.disconnect_segment_from(dropped_delimiter, SelectorSet::All, SelectorSet::All, false)?;

    editor.replace(replace_selector, Step::new_pick(new_commit_id))?;
    editor.replace(dropped_selector, Step::None)?;

    Ok(SquashCommitsOutcome {
        rebase: editor.rebase()?,
        commit_selector: replace_selector,
    })
}
