use std::{cmp::Ordering, collections::HashMap};

use but_core::ref_metadata::StackId;
use itertools::Itertools;

use crate::HunkAssignment;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MultipleOverlapping {
    SetNone,
    SetMostLines,
}

impl HunkAssignment {
    fn set_from(
        &mut self,
        other: &Self,
        applied_stack_ids: &[StackId],
        branches_by_stack: &HashMap<StackId, Vec<gix::refs::FullName>>,
        update_unassigned: bool,
    ) {
        // Always set the path from the other assignment
        self.path = other.path.clone();
        // Override the id only if the other assignment has an id
        if other.id.is_some() {
            self.id = other.id;
        }
        // Override the lines added only if the other assignment has them set
        if other.line_nums_added.is_some() {
            self.line_nums_added = other.line_nums_added.clone();
        }
        // Override the lines removed only if the other assignment has them set
        if other.line_nums_removed.is_some() {
            self.line_nums_removed = other.line_nums_removed.clone();
        }

        // Override the stack_id only if the current assignment has a stack_id or if update_unassigned is true
        match self.stack_id {
            Some(_) => {
                self.stack_id = other.stack_id;
                self.branch_ref_bytes = other.branch_ref_bytes.clone();
            }
            None => {
                if update_unassigned {
                    self.stack_id = other.stack_id;
                    self.branch_ref_bytes = other.branch_ref_bytes.clone();
                }
            }
        }
        // If the self.stack_id is set, ensure that it is a value that is still in the applied_stack_ids. If not, reset it to None.
        if let Some(stack_id) = self.stack_id
            && !applied_stack_ids.contains(&stack_id)
        {
            self.stack_id = None;
        }
        // If branch_ref_bytes is set, ensure it belongs to the assignment's own stack.
        // A branch that moved to a different stack should not retain its old association.
        if let Some(branch_ref) = &self.branch_ref_bytes {
            let is_valid = self
                .stack_id
                .and_then(|sid| branches_by_stack.get(&sid))
                .is_some_and(|branches| branches.contains(branch_ref));
            if !is_valid {
                self.branch_ref_bytes = None;
            }
        }
        // Invariant: if stack_id was cleared, branch_ref_bytes must also be cleared
        if self.stack_id.is_none() {
            self.branch_ref_bytes = None;
        }
    }
}

pub(crate) fn assignments(
    new: &[HunkAssignment],
    old: &[HunkAssignment],
    applied_stack_ids: &[StackId],
    branches_by_stack: &HashMap<StackId, Vec<gix::refs::FullName>>,
    multiple_overlapping_resolution: MultipleOverlapping,
    update_unassigned: bool,
) -> Vec<HunkAssignment> {
    let mut reconciled = vec![];
    for new_assignment in new {
        let mut new_assignment = new_assignment.clone();
        let intersecting = old
            .iter()
            .filter(|current_entry| current_entry.intersects(new_assignment.clone()))
            .collect::<Vec<_>>();

        match intersecting.len().cmp(&1) {
            Ordering::Less => {
                // No intersection - do nothing, the None assignment is kept
            }
            Ordering::Equal => {
                new_assignment.set_from(
                    intersecting[0],
                    applied_stack_ids,
                    branches_by_stack,
                    update_unassigned,
                );
            }
            Ordering::Greater => {
                // Pick the hunk with the most lines to adopt the assignment info from.
                let biggest_hunk = intersecting
                    .iter()
                    .max_by_key(|h| h.hunk_header.as_ref().map(|h| h.new_lines));
                if let Some(other) = biggest_hunk {
                    new_assignment.set_from(
                        other,
                        applied_stack_ids,
                        branches_by_stack,
                        update_unassigned,
                    );
                }

                // If requested, reset stack_id to none on multiple overlapping
                let unique_stack_ids = intersecting.iter().filter_map(|a| a.stack_id).unique();
                if multiple_overlapping_resolution == MultipleOverlapping::SetNone
                    && unique_stack_ids.count() > 1
                {
                    new_assignment.stack_id = None;
                    new_assignment.branch_ref_bytes = None;
                }
            }
        }
        reconciled.push(new_assignment);
    }
    reconciled
}
