# Commit Parentage Ordering

This document explains how commit selector ordering works in
`Editor::order_commit_selectors_by_parentage` (implemented in
`but-rebase/src/graph_rebase/ordering.rs`), and why the implementation is
structured the way it is.

## Goal

Given a set of commit selectors, produce a deterministic order such that:

- Parent commits come before child commits.
- Unrelated commits still have a stable, deterministic order.
- Duplicate selectors are deduplicated by commit id (first occurrence wins).

This ordering is useful for operations that must apply commits in dependency-safe order.

## Inputs and Output

Method: `editor.order_commit_selectors_by_parentage(selectors) -> Result<Vec<Selector>>`

- Input selectors can be any type implementing `ToCommitSelector`.
- The output is a list of normalized `Selector` values.

## Preconditions and Errors

The function treats the editor step graph as the single source of truth.

This means:

- Commits must be selectable in the editor graph.
- If a commit is absent from the editor graph, selector resolution fails (for example: `Failed to find commit <oid> in rebase editor`).
- No workspace projection lookup is used for ordering.

## High-Level Pipeline

The algorithm has five phases.

1. Normalize and deduplicate input
- Resolve each incoming selector to `(Selector, CommitOwned)` with `editor.find_selectable_commit`.
- Keep only the first occurrence of each commit id.

2. Compute deterministic fallback rank

  Build a map: `commit_id -> rank` from editor step graph structure.

  Implementation notes:

  - Consider only `Step::Pick` nodes.
  - Build pick-to-pick parent/child relations from ordered step-graph parents.
  - Perform deterministic topological ranking.
  - Tie-break ready nodes by graph node index for stability.

  - This rank is used only when ancestry does not constrain order.

3. Build ancestry constraint graph
- For every selected pair `(left, right)`, determine relation.
- If `left` is ancestor of `right`, add directed edge `left -> right`.
- If `right` is ancestor of `left`, add directed edge `right -> left`.
- If unrelated, add no edge.

Ancestry relation is computed by reachability in the editor step graph:

- Starting at the candidate descendant node, walk parent-direction edges (`Outgoing` in this graph representation).
- If the ancestor selector id is reachable, it is an ancestor.

4. Topological sort with stable tie-breaking
- Use Kahn's algorithm over indegrees.
- Keep all currently ready nodes in a min-priority structure keyed by:
  - `(step_graph_rank, input_order)`
- Repeatedly pop the best ready node, emit it, and reduce indegree of its children.

5. Validate completeness
- If output length is smaller than selected length, constraints were cyclic/inconsistent.
- Return an explicit error in that case.

### Kahn's Algo

We use Kahn's algorithm to topologically sort the nodes.

Indegree:
- In a directed graph, indegree of a node = how many arrows point into it.
- If node B has edges A → B and C → B, then indegree(B) = 2.
- Intuition: indegree tells you how many prerequisites a node still has.

Kahn’s algorithm:
- It is a way to do topological sorting.
- Topological sort means ordering nodes so every prerequisite appears before what depends on it.
- Works only if there is no cycle

How Kahn’s algorithm works:
1. Compute indegree for every node.
2. Put all nodes with indegree 0 into a queue (or priority queue if you want deterministic tie-breaking).
3. Repeatedly:
   1. Remove one node from the queue and add it to output.
   2. For each outgoing edge from that node to neighbor N, reduce indegree(N) by 1.
   3. If indegree(N) becomes 0, push N into the queue.
4. When done:
   - If output contains all nodes, that is a valid topological order.
   - If not, the graph has a cycle (some nodes never reached indegree 0).

Why indegree is the key:
- Indegree 0 means no remaining unmet dependencies.
- Removing a node simulates “completing” that task, which can unlock others.

Tiny example:
- Edges: A → C, B → C, C → D
- Initial indegrees: A=0, B=0, C=2, D=1
- Start queue: A, B
- Pop A: C becomes 1
- Pop B: C becomes 0, enqueue C
- Pop C: D becomes 0, enqueue D
- Pop D
- Order could be A, B, C, D (or B, A, C, D depending on queue policy)

## Complexity

Let `n` be number of selected unique commits.

- Pairwise relation discovery: `O(n^2)` comparisons.
- Topological processing:
  - each push/pop on ready queue: `O(log n)`
  - overall typically `O((n + e) log n)` where `e` is number of ancestry edges.

Total dominated by pairwise relation checks plus heap operations.

## Determinism Guarantees

Determinism is achieved by:

- deduping by first occurrence,
- using step-graph-derived rank for unrelated commits,
- using `input_order` as secondary tiebreaker.

So repeated runs with the same inputs and editor graph state produce the same output.

## Notes for Future Changes

If behavior needs to include commits currently not represented in the editor graph,
that must be solved before ordering (for example by changing editor graph construction).
Ordering itself intentionally operates only on what the editor graph already contains.
