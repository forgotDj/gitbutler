//! These tests exercise the add_edge and remove_edge operations.

use anyhow::Result;
use but_graph::Graph;
use but_rebase::graph_rebase::{Editor, testing::Testing as _};

use crate::utils::{fixture, standard_options};

#[test]
fn adding_an_existing_edge_causes_an_error() -> Result<()> {
    let (repo, mut meta) = fixture("four-commits")?;

    let graph = Graph::from_head(&repo, &*meta, standard_options())?.validated()?;
    let mut ws = graph.into_workspace()?;
    let mut editor = Editor::create(&mut ws, &mut *meta, &repo)?;

    let b = repo.rev_parse_single("HEAD~")?.detach();
    let a = repo.rev_parse_single("HEAD~2")?.detach();
    let b_selector = editor.select_commit(b)?;
    let a_selector = editor.select_commit(a)?;

    let err = editor
        .add_edge(b_selector, a_selector, 0)
        .expect_err("adding an existing edge order should fail");

    assert_eq!(
        err.to_string(),
        "An edge with desired order 0 already exists"
    );

    Ok(())
}

#[test]
#[cfg(debug_assertions)]
fn adding_an_edge_that_introduces_a_cycle_causes_an_error() -> Result<()> {
    let (repo, mut meta) = fixture("four-commits")?;

    let graph = Graph::from_head(&repo, &*meta, standard_options())?.validated()?;
    let mut ws = graph.into_workspace()?;
    let mut editor = Editor::create(&mut ws, &mut *meta, &repo)?;

    let c = repo.rev_parse_single("HEAD")?.detach();
    let a = repo.rev_parse_single("HEAD~2")?.detach();
    let c_selector = editor.select_commit(c)?;
    let a_selector = editor.select_commit(a)?;

    let err = editor
        .add_edge(a_selector, c_selector, 1)
        .expect_err("adding an edge to an existing descendant should fail");

    assert_eq!(err.to_string(), "BUG: Add edge introduces a cycle");

    Ok(())
}

#[test]
fn adding_a_valid_edge_is_successful() -> Result<()> {
    let (repo, mut meta) = fixture("merge-in-the-middle")?;

    let graph = Graph::from_head(&repo, &*meta, standard_options())?.validated()?;
    let mut ws = graph.into_workspace()?;
    let mut editor = Editor::create(&mut ws, &mut *meta, &repo)?;

    let a = repo.rev_parse_single("A")?.detach();
    let b = repo.rev_parse_single("B")?.detach();
    let a_selector = editor.select_commit(a)?;
    let b_selector = editor.select_commit(b)?;

    editor.add_edge(a_selector, b_selector, 1)?;

    insta::assert_snapshot!(editor.steps_ascii(), @r"
    ◎ refs/heads/with-inner-merge
    ● e8ee978 on top of inner merge
    ● 2fc288c Merge branch 'B' into with-inner-merge
    ├─╮
    ◎ │ refs/heads/A
    ● │ add59d2 A: 10 lines on top
    ├─╪─╮
    │ ◎ │ refs/heads/B
    │ ├─╯
    │ ● 984fd1c C: new file with 10 lines
    ├─╯
    ◎ refs/heads/main
    ◎ refs/tags/base
    ● 8f0d338 base
    ╵
    ");

    Ok(())
}

#[test]
fn remove_edge_returns_no_orders_when_no_edges_found() -> Result<()> {
    let (repo, mut meta) = fixture("four-commits")?;

    let graph = Graph::from_head(&repo, &*meta, standard_options())?.validated()?;
    let mut ws = graph.into_workspace()?;
    let mut editor = Editor::create(&mut ws, &mut *meta, &repo)?;

    let c = repo.rev_parse_single("HEAD")?.detach();
    let a = repo.rev_parse_single("HEAD~2")?.detach();
    let c_selector = editor.select_commit(c)?;
    let a_selector = editor.select_commit(a)?;

    editor.remove_edges(c_selector, a_selector)?;

    Ok(())
}

#[test]
fn removing_an_existing_edge_returns_its_order_and_allows_readding_it() -> Result<()> {
    let (repo, mut meta) = fixture("four-commits")?;

    let graph = Graph::from_head(&repo, &*meta, standard_options())?.validated()?;
    let mut ws = graph.into_workspace()?;
    let mut editor = Editor::create(&mut ws, &mut *meta, &repo)?;

    let b = repo.rev_parse_single("HEAD~")?.detach();
    let a = repo.rev_parse_single("HEAD~2")?.detach();
    let b_selector = editor.select_commit(b)?;
    let a_selector = editor.select_commit(a)?;

    assert_eq!(editor.remove_edges(b_selector, a_selector)?, vec![0]);
    editor.add_edge(b_selector, a_selector, 0)?;

    insta::assert_snapshot!(editor.steps_ascii(), @"
    ◎ refs/heads/main
    ● 120e3a9 c
    ● a96434e b
    ● d591dfe a
    ● 35b8235 base
    ╵
    ");

    Ok(())
}
