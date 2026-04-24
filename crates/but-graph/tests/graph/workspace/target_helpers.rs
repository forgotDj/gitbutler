use but_graph::Graph;

use crate::init::utils::{
    add_workspace_with_target, add_workspace_without_target, read_only_in_memory_scenario,
    standard_options,
};

#[test]
fn distinguishes_target_base_from_ref_tip() -> anyhow::Result<()> {
    let (repo, mut meta) = read_only_in_memory_scenario("ws/local-target-and-stack")?;
    let base_id = repo.rev_parse_single(":/M2")?.detach();
    let target_tip_id = repo.rev_parse_single("origin/main")?.detach();

    add_workspace_with_target(&mut meta, base_id);

    let ws = Graph::from_head(&repo, &*meta, standard_options())?
        .validated()?
        .into_workspace()?;

    assert_eq!(ws.target_base_oid(), Some(base_id));
    assert_eq!(ws.target_ref_tip_oid(), Some(target_tip_id));
    assert_eq!(
        ws.target_ref_name().map(ToString::to_string),
        Some("refs/remotes/origin/main".to_string())
    );

    Ok(())
}

#[test]
fn target_push_remote_prefers_metadata_override() -> anyhow::Result<()> {
    let (repo, mut meta) = read_only_in_memory_scenario("ws/local-target-and-stack")?;
    let base_id = repo.rev_parse_single(":/M2")?.detach();

    add_workspace_with_target(&mut meta, base_id);
    meta.data_mut()
        .default_target
        .as_mut()
        .expect("target was set by add_workspace_with_target")
        .push_remote_name = Some("push-remote".into());

    let ws = Graph::from_head(&repo, &*meta, standard_options())?
        .validated()?
        .into_workspace()?;

    assert_eq!(ws.target_push_remote_name(), Some("push-remote".into()));

    Ok(())
}

#[test]
fn target_push_remote_falls_back_to_target_ref_remote() -> anyhow::Result<()> {
    let (repo, mut meta) = read_only_in_memory_scenario("ws/local-target-and-stack")?;
    let base_id = repo.rev_parse_single(":/M2")?.detach();

    add_workspace_with_target(&mut meta, base_id);

    let ws = Graph::from_head(&repo, &*meta, standard_options())?
        .validated()?
        .into_workspace()?;

    assert_eq!(ws.target_push_remote_name(), Some("origin".into()));

    Ok(())
}

#[test]
fn target_helpers_return_none_without_target() -> anyhow::Result<()> {
    let (repo, mut meta) = read_only_in_memory_scenario("ws/no-target-without-ws-commit")?;

    add_workspace_without_target(&mut meta);

    let ws = Graph::from_head(&repo, &*meta, standard_options())?
        .validated()?
        .into_workspace()?;

    assert_eq!(ws.target_base_oid(), None);
    assert_eq!(ws.target_ref_tip_oid(), None);
    assert_eq!(ws.target_ref_name(), None);
    assert_eq!(ws.target_push_remote_name(), None);

    Ok(())
}
