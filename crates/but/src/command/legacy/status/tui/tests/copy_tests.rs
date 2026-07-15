use but_testsupport::Sandbox;

use crate::command::legacy::status::tui::tests::utils::test_tui;

#[test]
fn copying_change_id_doesnt_includes_disambiguation() {
    let env = Sandbox::init_scenario_with_target_and_default_settings("zero-stacks");
    env.setup_metadata(&[]);

    let mut tui = test_tui(env);

    tui.input('b');
    tui.input('n');
    tui.input('n');

    // Ideally this would include the disambiguation but the change id in CliId::Commit doesn't
    // include the it. In the future it will.
    tui.input('y').assert_copied_text_eq("1");
}
