//! Experimental implementation of `but rub` that doesn't use any legacy APIs.
//!
//! If you're an AI agent _do not_ use anything from legacy modules. Except `RubOperation`,
//! `RubOperationDiscriminants`, and `route_operation`.

use but_ctx::Context;
use but_workspace::commit::squash_commits::MessageCombinationStrategy;

use crate::{
    CliId,
    command::legacy::{
        rub::{RubOperation, RubOperationDiscriminants, SquashCommitsOperation},
        status::tui::SelectAfterReload,
    },
};

pub(super) fn route_operation<'a>(
    source: &'a CliId,
    target: &'a CliId,
    how_to_combine_messages: MessageCombinationStrategy,
) -> Option<RubOperation<'a>> {
    Some(
        match crate::command::legacy::rub::route_operation(source, target, how_to_combine_messages)?
        {
            op @ RubOperation::UnassignUncommitted(..) => op,
            op @ RubOperation::UncommittedToCommit(..) => op,
            op @ RubOperation::UnassignedToCommit(..) => op,
            op @ RubOperation::CommitToUnassigned(..) => op,
            op @ RubOperation::CommitToStack(..) => op,
            op @ RubOperation::SquashCommits(..) => op,
            op @ RubOperation::CommittedFileToCommit(..) => op,
            op @ RubOperation::CommittedFileToUnassigned(..) => op,
            op @ RubOperation::UncommittedToStack(..) => op,
            op @ RubOperation::StackToUnassigned(..) => op,
            op @ RubOperation::StackToStack(..) => op,
            op @ RubOperation::UnassignedToStack(..) => op,
            op @ RubOperation::StackToCommit(..) => op,

            // dont allow rubbing with branches
            RubOperation::UncommittedToBranch(..)
            | RubOperation::StackToBranch(..)
            | RubOperation::UnassignedToBranch(..)
            | RubOperation::MoveCommitToBranch(..)
            | RubOperation::BranchToUnassigned(..)
            | RubOperation::BranchToStack(..)
            | RubOperation::BranchToCommit(..)
            | RubOperation::BranchToBranch(..)
            | RubOperation::CommittedFileToBranch(..) => return None,
        },
    )
}

pub(super) fn supports_rubbing(id: &CliId) -> bool {
    match id {
        CliId::Branch { .. } => false,
        CliId::Uncommitted(..)
        | CliId::PathPrefix { .. }
        | CliId::CommittedFile { .. }
        | CliId::Commit { .. }
        | CliId::Unassigned { .. }
        | CliId::Stack { .. } => true,
    }
}

/// Returns a human-facing operation descriptor for the source/target pair.
pub(super) fn rub_operation_display(
    source: &CliId,
    target: &CliId,
    how_to_combine_messages: MessageCombinationStrategy,
) -> Option<&'static str> {
    if source == target {
        return Some("noop");
    }

    let operation = route_operation(source, target, how_to_combine_messages)?;
    Some(match operation {
        RubOperation::UnassignUncommitted(..) => "unassign hunks",
        RubOperation::UncommittedToCommit(..) => "amend",
        RubOperation::UncommittedToBranch(..) => "assign hunks",
        RubOperation::UncommittedToStack(..) => "assign hunks",
        RubOperation::StackToUnassigned(..) => "unassign hunks",
        RubOperation::StackToStack(..) => "reassign hunks",
        RubOperation::StackToBranch(..) => "reassign hunks",
        RubOperation::UnassignedToCommit(..) => "amend",
        RubOperation::UnassignedToBranch(..) => "assign hunks",
        RubOperation::UnassignedToStack(..) => "assign hunks",
        RubOperation::CommitToUnassigned(..) => "undo commit",
        RubOperation::CommitToStack(..) => "undo commit",
        RubOperation::SquashCommits(SquashCommitsOperation {
            source: _,
            destination: _,
            how_to_combine_messages,
        }) => match how_to_combine_messages {
            MessageCombinationStrategy::KeepBoth => "squash",
            MessageCombinationStrategy::KeepSubject => "squash (discard this message)",
            MessageCombinationStrategy::KeepTarget => "squash (use this message)",
        },
        RubOperation::MoveCommitToBranch(..) => "move commit",
        RubOperation::BranchToUnassigned(..) => "unassign hunks",
        RubOperation::BranchToStack(..) => "reassign hunks",
        RubOperation::BranchToCommit(..) => "amend",
        RubOperation::BranchToBranch(..) => "reassign hunks",
        RubOperation::CommittedFileToBranch(..) => "uncommit file",
        RubOperation::CommittedFileToCommit(..) => "move file",
        RubOperation::CommittedFileToUnassigned(..) => "uncommit file",
        RubOperation::StackToCommit(..) => "amend",
    })
}

/// Executes a rub operation and returns which item should be selected after reloading.
pub(super) fn perform_operation(
    ctx: &mut Context,
    operation: &RubOperation<'_>,
) -> anyhow::Result<Option<SelectAfterReload>> {
    let selection = match operation {
        RubOperation::UnassignUncommitted(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Unassigned
        }
        RubOperation::UncommittedToCommit(operation) => {
            let result = operation.execute_inner(ctx)?;
            result
                .new_commit
                .map(SelectAfterReload::Commit)
                .unwrap_or(SelectAfterReload::Unassigned)
        }
        RubOperation::UncommittedToBranch(operation) => {
            let assignment = operation.hunk_assignments.first();
            let path = assignment.path_bytes.clone();
            let stack_id = assignment.stack_id;
            operation.execute_inner(ctx)?;
            SelectAfterReload::UncommittedFile { path, stack_id }
        }
        RubOperation::UncommittedToStack(operation) => {
            let path = operation.hunk_assignments.first().path_bytes.clone();
            operation.execute_inner(ctx)?;
            SelectAfterReload::UncommittedFile {
                path,
                stack_id: Some(operation.stack_id),
            }
        }
        RubOperation::StackToUnassigned(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Unassigned
        }
        RubOperation::StackToStack(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Stack(operation.to)
        }
        RubOperation::StackToBranch(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Branch(operation.to.to_string())
        }
        RubOperation::UnassignedToCommit(operation) => {
            let result = operation.execute_inner(ctx)?;
            SelectAfterReload::Commit(result.new_commit.unwrap_or(operation.oid))
        }
        RubOperation::UnassignedToBranch(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Branch(operation.to.to_string())
        }
        RubOperation::UnassignedToStack(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Stack(operation.to)
        }
        RubOperation::CommitToUnassigned(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Unassigned
        }
        RubOperation::CommitToStack(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Stack(operation.stack)
        }
        RubOperation::SquashCommits(operation) => {
            let result = operation.execute_inner(ctx)?;
            SelectAfterReload::Commit(result.new_commit)
        }
        RubOperation::MoveCommitToBranch(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Branch(operation.name.to_string())
        }
        RubOperation::BranchToUnassigned(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Unassigned
        }
        RubOperation::BranchToStack(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Stack(operation.to)
        }
        RubOperation::BranchToCommit(operation) => {
            let result = operation.execute_inner(ctx)?;
            result
                .new_commit
                .map(SelectAfterReload::Commit)
                .unwrap_or(SelectAfterReload::Branch(operation.name.to_string()))
        }
        RubOperation::BranchToBranch(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Branch(operation.to.to_string())
        }
        RubOperation::CommittedFileToBranch(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Branch(operation.name.to_string())
        }
        RubOperation::CommittedFileToCommit(operation) => {
            let result = operation.execute_inner(ctx)?;
            let destination_to_select = result
                .workspace
                .replaced_commits
                .get(&operation.oid)
                .copied()
                .unwrap_or(operation.oid);
            SelectAfterReload::Commit(destination_to_select)
        }
        RubOperation::CommittedFileToUnassigned(operation) => {
            operation.execute_inner(ctx)?;
            SelectAfterReload::Unassigned
        }
        RubOperation::StackToCommit(operation) => {
            let result = operation.execute_inner(ctx)?;
            SelectAfterReload::Commit(result.new_commit.unwrap_or(operation.to))
        }
    };

    Ok(Some(selection))
}

/// Error raised when a routed operation has no implementation in this rub-api module.
#[derive(Debug)]
pub(super) struct OperationNotSupported(RubOperationDiscriminants);

impl OperationNotSupported {
    /// Creates an unsupported-operation error from a routed operation value.
    pub(super) fn new(operation: &RubOperation<'_>) -> Self {
        OperationNotSupported(RubOperationDiscriminants::from(operation))
    }
}

impl std::fmt::Display for OperationNotSupported {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?} is not supported", self.0)
    }
}

impl std::error::Error for OperationNotSupported {}
