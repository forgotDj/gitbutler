use crate::utils::{CommandExt, Sandbox};

/// Hide empty applied branches by default and show them again with `--empty`.
#[test]
fn list_hides_empty_applied_branches_by_default() -> anyhow::Result<()> {
    let env = Sandbox::init_scenario_with_target_and_default_settings("two-stacks-one-empty")?;
    env.setup_metadata(&["A", "B"])?;

    let result = env.but("--json branch list").allow_json().output()?;
    assert!(result.status.success());
    let stdout = String::from_utf8_lossy(&result.stdout);
    let json: serde_json::Value = serde_json::from_str(stdout.trim())?;

    let applied_heads: Vec<_> = json["appliedStacks"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|stack| stack["heads"].as_array().unwrap())
        .map(|head| head["name"].as_str().unwrap())
        .collect();

    assert!(applied_heads.contains(&"A"));
    assert!(!applied_heads.contains(&"B"));

    assert!(json["branches"].as_array().unwrap().is_empty());

    let result = env
        .but("--json branch list --empty")
        .allow_json()
        .output()?;
    assert!(result.status.success());
    let stdout = String::from_utf8_lossy(&result.stdout);
    let json: serde_json::Value = serde_json::from_str(stdout.trim())?;

    let applied_heads: Vec<_> = json["appliedStacks"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|stack| stack["heads"].as_array().unwrap())
        .map(|head| head["name"].as_str().unwrap())
        .collect();

    assert!(applied_heads.contains(&"A"));
    assert!(applied_heads.contains(&"B"));

    Ok(())
}
