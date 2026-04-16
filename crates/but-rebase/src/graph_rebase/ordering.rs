#![doc = include_str!("../../docs/commit_parentage.md")]

use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap, HashSet},
};

use anyhow::{Context, Result, bail};
use but_core::RefMetadata;
use petgraph::visit::EdgeRef as _;

use crate::graph_rebase::{Editor, Pick, Selector, Step, StepGraphIndex, ToCommitSelector, util};

impl<M: RefMetadata> Editor<'_, '_, M> {
    /// Order commit selectors by parentage, with parents first and children last.
    ///
    /// If two commits are unrelated by ancestry, their relative order is determined by
    /// deterministic editor graph order. Duplicate selectors are deduplicated by commit-id
    /// with first occurrence winning.
    pub fn order_commit_selectors_by_parentage<I, S>(&self, selectors: I) -> Result<Vec<Selector>>
    where
        I: IntoIterator<Item = S>,
        S: ToCommitSelector,
    {
        // Normalize user input to unique commits while retaining first-seen order for tie-breaking.
        let mut selected = Vec::<SelectedCommit>::new();
        let mut seen_ids = HashSet::<gix::ObjectId>::new();
        for (input_order, selector_like) in selectors.into_iter().enumerate() {
            let (selector, commit) = self.find_selectable_commit(selector_like)?;
            if seen_ids.insert(commit.id) {
                selected.push(SelectedCommit {
                    selector,
                    id: commit.id,
                    input_order,
                });
            }
        }

        if selected.len() <= 1 {
            return Ok(selected.into_iter().map(|s| s.selector).collect());
        }

        // Build a deterministic fallback rank from editor step-graph order for unrelated commits.
        let step_graph_rank = step_graph_parent_to_child_rank(self);

        // Build a DAG over selected commits where edges always point ancestor -> descendant.
        let mut adjacency = vec![Vec::<usize>::new(); selected.len()];
        let mut indegree = vec![0usize; selected.len()];

        for (i, left_commit) in selected.iter().enumerate() {
            for (offset, right_commit) in selected.iter().skip(i + 1).enumerate() {
                let j = i + 1 + offset;
                match ancestry_relation(self, left_commit, right_commit) {
                    Relation::LeftIsAncestorOfRight => {
                        adjacency
                            .get_mut(i)
                            .context("BUG: adjacency index should always be valid")?
                            .push(j);
                        *indegree
                            .get_mut(j)
                            .context("BUG: indegree index should always be valid")? += 1;
                    }
                    Relation::RightIsAncestorOfLeft => {
                        adjacency
                            .get_mut(j)
                            .context("BUG: adjacency index should always be valid")?
                            .push(i);
                        *indegree
                            .get_mut(i)
                            .context("BUG: indegree index should always be valid")? += 1;
                    }
                    Relation::Unrelated => {}
                }
            }
        }

        // Kahn topological sort with a min-priority queue so output order is stable across unrelated nodes.
        let mut output = Vec::with_capacity(selected.len());
        let mut ready: BinaryHeap<Reverse<(usize, usize, usize)>> = indegree
            .iter()
            .enumerate()
            .filter_map(|(idx, degree)| {
                if *degree != 0 {
                    return None;
                }
                let commit = selected.get(idx)?;
                let rank = *step_graph_rank
                    .get(&commit.id)
                    .context("BUG: selected commit should be rankable in editor graph")
                    .ok()?;
                Some(Reverse((rank, commit.input_order, idx)))
            })
            .collect();

        // Repeatedly emit the best available node and unlock its descendants.
        while let Some(Reverse((_, _, next))) = ready.pop() {
            output.push(
                selected
                    .get(next)
                    .context("BUG: ready index should be in-bounds")?
                    .selector,
            );
            for &child in adjacency
                .get(next)
                .context("BUG: adjacency index should be in-bounds")?
            {
                let degree = indegree
                    .get_mut(child)
                    .context("BUG: child index should be in-bounds")?;
                *degree -= 1;
                if *degree == 0 {
                    let commit = selected
                        .get(child)
                        .context("BUG: child index should point to selected commits")?;
                    let rank = *step_graph_rank
                        .get(&commit.id)
                        .context("BUG: selected child commit should be rankable in editor graph")?;
                    ready.push(Reverse((rank, commit.input_order, child)));
                }
            }
        }

        // Any leftovers indicate impossible/cyclic constraints in what should be a DAG.
        if output.len() != selected.len() {
            bail!("Cannot order selected commits by parentage due to cyclic ancestry constraints")
        }

        Ok(output)
    }
}

#[derive(Debug, Clone, Copy)]
struct SelectedCommit {
    selector: Selector,
    id: gix::ObjectId,
    input_order: usize,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum Relation {
    LeftIsAncestorOfRight,
    RightIsAncestorOfLeft,
    Unrelated,
}

fn ancestry_relation(
    editor: &Editor<'_, '_, impl RefMetadata>,
    left: &SelectedCommit,
    right: &SelectedCommit,
) -> Relation {
    if is_pick_ancestor(editor, left.selector.id, right.selector.id) {
        return Relation::LeftIsAncestorOfRight;
    }
    if is_pick_ancestor(editor, right.selector.id, left.selector.id) {
        return Relation::RightIsAncestorOfLeft;
    }
    Relation::Unrelated
}

fn is_pick_ancestor(
    editor: &Editor<'_, '_, impl RefMetadata>,
    ancestor: StepGraphIndex,
    descendant: StepGraphIndex,
) -> bool {
    let mut stack = vec![descendant];
    let mut seen = HashSet::from([descendant]);

    while let Some(node) = stack.pop() {
        for edge in editor
            .graph
            .edges_directed(node, petgraph::Direction::Outgoing)
        {
            let parent = edge.target();
            if parent == ancestor {
                return true;
            }
            if seen.insert(parent) {
                stack.push(parent);
            }
        }
    }

    false
}

fn step_graph_parent_to_child_rank<M: RefMetadata>(
    editor: &Editor<'_, '_, M>,
) -> HashMap<gix::ObjectId, usize> {
    let pick_nodes: Vec<StepGraphIndex> = editor
        .graph
        .node_indices()
        .filter(|idx| matches!(editor.graph[*idx], Step::Pick(_)))
        .collect();

    let pick_pos_by_idx: HashMap<StepGraphIndex, usize> = pick_nodes
        .iter()
        .copied()
        .enumerate()
        .map(|(pos, idx)| (idx, pos))
        .collect();

    // Build parent -> child edges between pick nodes only.
    let mut adjacency = vec![Vec::<usize>::new(); pick_nodes.len()];
    let mut indegree = vec![0usize; pick_nodes.len()];

    for (child_pos, child_idx) in pick_nodes.iter().copied().enumerate() {
        for parent_idx in util::collect_ordered_parents(&editor.graph, child_idx) {
            let Some(parent_pos) = pick_pos_by_idx.get(&parent_idx).copied() else {
                continue;
            };
            adjacency[parent_pos].push(child_pos);
            indegree[child_pos] += 1;
        }
    }

    // Deterministic tie-break on node index keeps ranking stable.
    let mut ready: BinaryHeap<Reverse<(usize, usize)>> = indegree
        .iter()
        .enumerate()
        .filter_map(|(pos, degree)| {
            (*degree == 0).then_some(Reverse((pick_nodes[pos].index(), pos)))
        })
        .collect();

    let mut rank_by_id = HashMap::<gix::ObjectId, usize>::new();
    let mut next_rank = 0usize;

    while let Some(Reverse((_, pos))) = ready.pop() {
        if let Step::Pick(Pick { id, .. }) = editor.graph[pick_nodes[pos]] {
            rank_by_id.entry(id).or_insert_with(|| {
                let rank = next_rank;
                next_rank += 1;
                rank
            });
        }

        for &child in &adjacency[pos] {
            let degree = &mut indegree[child];
            *degree -= 1;
            if *degree == 0 {
                ready.push(Reverse((pick_nodes[child].index(), child)));
            }
        }
    }

    // Step-graph cycles are unexpected; rank any leftovers deterministically.
    let mut leftovers: Vec<usize> = indegree
        .iter()
        .enumerate()
        .filter_map(|(pos, degree)| (*degree > 0).then_some(pos))
        .collect();
    leftovers.sort_by_key(|pos| pick_nodes[*pos].index());

    for pos in leftovers {
        if let Step::Pick(Pick { id, .. }) = editor.graph[pick_nodes[pos]] {
            rank_by_id.entry(id).or_insert_with(|| {
                let rank = next_rank;
                next_rank += 1;
                rank
            });
        }
    }

    rank_by_id
}
