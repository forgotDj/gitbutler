use bstr::ByteSlice;
use snapbox::str;

use crate::{command::util, utils::Sandbox};

fn find_unassigned_cli_id(status: &serde_json::Value, path_contains: &str) -> Option<String> {
    status["unassignedChanges"]
        .as_array()?
        .iter()
        .find(|change| {
            change["filePath"]
                .as_str()
                .map(|path| path.contains(path_contains))
                .unwrap_or(false)
        })
        .and_then(|change| change["cliId"].as_str().map(ToOwned::to_owned))
}

#[test]
fn discard_removes_selected_change() -> anyhow::Result<()> {
    let env = Sandbox::init_scenario_with_target_and_default_settings("one-stack")?;
    env.setup_metadata(&["A"])?;

    env.file("src/discard-me.ts", "export const value = true;\n");

    let status = util::status_json(&env)?;
    let cli_id = find_unassigned_cli_id(&status, "discard-me").expect("should find CLI ID");

    env.but(format!("discard {cli_id}")).assert().success();

    let status = util::status_json(&env)?;
    assert!(
        find_unassigned_cli_id(&status, "discard-me").is_none(),
        "discarded file should no longer appear in unassigned changes"
    );
    assert!(
        !env.projects_root().join("src/discard-me.ts").exists(),
        "discarding a new file should remove it from the worktree"
    );

    Ok(())
}

#[test]
fn concurrent_discard_to_independent_files_succeeds() -> anyhow::Result<()> {
    let env = Sandbox::init_scenario_with_target_and_default_settings("one-stack")?;
    env.setup_metadata(&["A"])?;

    env.file("src/a/discard.ts", "export const a = true;\n");
    env.file("src/b/discard.ts", "export const b = true;\n");

    let status = util::status_json(&env)?;
    let id_a = find_unassigned_cli_id(&status, "a/discard").expect("should find first CLI ID");
    let id_b = find_unassigned_cli_id(&status, "b/discard").expect("should find second CLI ID");

    let child_a = util::but_std_cmd(&env, &format!("discard {id_a}")).spawn()?;
    let child_b = util::but_std_cmd(&env, &format!("discard {id_b}")).spawn()?;

    let out_a = child_a.wait_with_output()?;
    let out_b = child_b.wait_with_output()?;

    assert!(
        out_a.status.success(),
        "first discard failed: {}",
        out_a.stderr.as_bstr()
    );
    assert!(
        out_b.status.success(),
        "second discard failed: {}",
        out_b.stderr.as_bstr()
    );

    let status = util::status_json(&env)?;
    assert_eq!(
        status["unassignedChanges"]
            .as_array()
            .map(|changes| changes.len())
            .unwrap_or(0),
        0,
        "both discarded files should be removed from the workspace"
    );

    Ok(())
}

#[test]
/// Reproduces a bug where hunks from the same file were separated into different DiffSpecs and
/// applied one at a time in order. Existing hunks in the workspace were resolved again in between
/// each DiffSpec being applied. If any hunk caused line displacement by adding or removing
/// lines, any subsequent hunks become displaced from the DiffSpecs and trigger an error.
fn can_discard_multiple_hunks_from_same_file() -> anyhow::Result<()> {
    let env = Sandbox::init_scenario_with_target_and_default_settings("one-stack-with-large-file")?;
    env.setup_metadata(&["large-file"])?;

    let initiale_file_content =
        std::fs::read_to_string(env.projects_root().join("large_file.txt"))?;

    // We prepend a new line to the beggining of the file and append a line to the end. These two
    // edits end up in different hunks, and naively discarding these hunks in order with a "disc
    // materialization" in between fails as the second hunk ends up outside the initially computed
    // DiffSpec once the first has been discarded.
    let new_large_file_content = format!("New first line\n{initiale_file_content}\nNew last line");
    env.file("large_file.txt", new_large_file_content);

    let status = util::status_json(&env)?;
    let large_file_id = find_unassigned_cli_id(&status, "large_file.txt")
        .expect("should find CLI ID of large file");

    env.but("discard")
        .arg(large_file_id)
        .assert()
        .success()
        .stdout_eq(str![[r#"
Successfully discarded changes to 2 items

"#]])
        .stderr_eq("");

    let file_content_after_discard =
        std::fs::read_to_string(env.projects_root().join("large_file.txt"))?;

    assert_eq!(file_content_after_discard, initiale_file_content);

    Ok(())
}
