use but_testsupport::Sandbox;
use crossterm::event::KeyCode;
use snapbox::{file, str};

use crate::command::legacy::status::tui::tests::utils::test_tui;

#[test]
fn discard_prompt_can_be_cancelled() {
    let env = Sandbox::init_scenario_with_target_and_default_settings("one-stack").unwrap();
    env.setup_metadata(&["A"]).unwrap();

    let mut tui = test_tui(env);

    tui.env.file("test.txt", "content");

    tui.input_then_render(None)
        .assert_current_line_eq(str!["╭┄zz [unstaged changes]"]);

    tui.input_then_render('x')
        .assert_rendered_contains("Discard unassigned changes?")
        .assert_rendered_contains("<< discard >>");

    tui.input_then_render('n');

    tui.input_then_render(None)
        .assert_current_line_eq(str!["╭┄zz [unstaged changes]"])
        .assert_rendered_term_svg_eq(file!["snapshots/discard_prompt_can_be_cancelled_final.svg"]);
}

#[test]
fn discard_unassigned_confirm_yes_discards_changes() {
    let env = Sandbox::init_scenario_with_target_and_default_settings("one-stack").unwrap();
    env.setup_metadata(&["A"]).unwrap();

    let mut tui = test_tui(env);

    tui.env.file("test.txt", "content");

    tui.input_then_render(None)
        .assert_current_line_eq(str!["╭┄zz [unstaged changes]"]);

    tui.input_then_render('x')
        .assert_rendered_contains("Discard unassigned changes?");

    tui.input_then_render('y');

    tui.input_then_render(None)
        .assert_current_line_eq(str!["╭┄zz [unstaged changes]"]);

    let status = tui.env.invoke_git("status --porcelain");
    assert_eq!(status, "");

    tui.input_then_render(None)
        .assert_rendered_term_svg_eq(file![
            "snapshots/discard_unassigned_confirm_yes_discards_changes_final.svg"
        ]);
}

#[test]
fn discard_unassigned_cancel_keeps_changes() {
    let env = Sandbox::init_scenario_with_target_and_default_settings("one-stack").unwrap();
    env.setup_metadata(&["A"]).unwrap();

    let mut tui = test_tui(env);

    tui.env.file("test.txt", "content");

    tui.input_then_render(None)
        .assert_current_line_eq(str!["╭┄zz [unstaged changes]"]);

    tui.input_then_render('x')
        .assert_rendered_contains("Discard unassigned changes?");

    tui.input_then_render('n');

    tui.input_then_render(None)
        .assert_current_line_eq(str!["╭┄zz [unstaged changes]"]);

    let status = tui.env.invoke_git("status --porcelain");
    assert!(
        status.contains("test.txt"),
        "expected unassigned changes to remain, got: {status:?}"
    );

    tui.input_then_render(None)
        .assert_rendered_term_svg_eq(file![
            "snapshots/discard_unassigned_cancel_keeps_changes_final.svg"
        ]);
}

#[test]
fn discard_commit_confirm_yes_removes_commit() {
    let env = Sandbox::init_scenario_with_target_and_default_settings("one-stack").unwrap();
    env.setup_metadata(&["A"]).unwrap();

    let mut tui = test_tui(env);

    tui.input_then_render([KeyCode::Down, KeyCode::Down])
        .assert_current_line_eq(str!["┊●   9477ae7 add A"]);

    tui.input_then_render('x')
        .assert_rendered_contains("Discard commit")
        .assert_rendered_contains("<< discard >>");

    tui.input_then_render('y');
    tui.input_then_render(None);

    let log = tui.env.invoke_git("log --oneline");
    assert!(
        !log.contains("add A"),
        "expected discarded commit to be removed from history, got:\n{log}"
    );

    tui.input_then_render(None)
        .assert_rendered_term_svg_eq(file![
            "snapshots/discard_commit_confirm_yes_removes_commit_final.svg"
        ]);
}

#[test]
fn discard_on_committed_file_row_is_noop() {
    let env = Sandbox::init_scenario_with_target_and_default_settings("two-stacks").unwrap();
    env.setup_metadata(&["A", "B"]).unwrap();

    let mut tui = test_tui(env);

    tui.input_then_render([KeyCode::Down, KeyCode::Down])
        .assert_current_line_eq(str!["┊●   [..] add A"]);

    tui.input_then_render('f')
        .assert_current_line_eq(str!["┊│     [..] A A"]);

    tui.input_then_render('x')
        .assert_current_line_eq(str!["┊│     [..] A A"])
        .assert_rendered_term_svg_eq(file![
            "snapshots/discard_on_committed_file_row_is_noop_final.svg"
        ]);
}
