use crate::utils::{CommandExt, Sandbox};

/// Show branch details for an applied branch using JSON output.
#[test]
fn show_lists_commits_ahead_for_applied_branch() -> anyhow::Result<()> {
    let env = Sandbox::init_scenario_with_target_and_default_settings("pick-from-unapplied")?;
    env.setup_metadata(&["applied-branch"])?;

    let result = env
        .but("--json branch show applied-branch")
        .allow_json()
        .output()?;

    assert!(result.status.success());
    let stdout = String::from_utf8_lossy(&result.stdout);
    let json: serde_json::Value = serde_json::from_str(stdout.trim())?;

    assert_eq!(json["branch"], "applied-branch");
    assert_eq!(json["commitsAhead"], 1);
    assert_eq!(json["commits"].as_array().unwrap().len(), 1);
    assert_eq!(json["commits"][0]["message"], "add applied.txt");

    Ok(())
}

/// Report merge-check information for an applied branch using JSON output.
#[test]
fn show_check_reports_clean_merge_for_applied_branch() -> anyhow::Result<()> {
    let env = Sandbox::init_scenario_with_target_and_default_settings("pick-from-unapplied")?;
    env.setup_metadata(&["applied-branch"])?;

    let result = env
        .but("--json branch show applied-branch --check")
        .allow_json()
        .output()?;

    assert!(result.status.success());
    let stdout = String::from_utf8_lossy(&result.stdout);
    let json: serde_json::Value = serde_json::from_str(stdout.trim())?;

    assert_eq!(json["branch"], "applied-branch");
    assert_eq!(json["mergeCheck"]["mergesCleanly"], true);
    assert_eq!(
        json["mergeCheck"]["conflictingFiles"],
        serde_json::json!([])
    );

    Ok(())
}
