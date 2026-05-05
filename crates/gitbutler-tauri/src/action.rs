use but_api::json::Error;
use but_ctx::{Context, ProjectHandleOrLegacyProjectId};
use tracing::instrument;

#[tauri::command(async)]
#[instrument(err(Debug))]
pub fn list_actions(
    project_id: ProjectHandleOrLegacyProjectId,
    offset: i64,
    limit: i64,
) -> anyhow::Result<but_action::ActionListing, Error> {
    let ctx: Context = project_id.try_into()?;
    but_action::list_actions(&ctx, offset, limit).map_err(|e| Error::from(anyhow::anyhow!(e)))
}

#[tauri::command(async)]
#[instrument(err(Debug))]
pub fn handle_changes(
    project_id: ProjectHandleOrLegacyProjectId,
    change_summary: String,
    handler: but_action::ActionHandler,
) -> anyhow::Result<but_action::Outcome, Error> {
    let mut ctx: Context = project_id.try_into()?;
    but_action::handle_changes(
        &mut ctx,
        &change_summary,
        None,
        handler,
        but_action::Source::GitButler,
        None,
    )
    .map(|(_id, outcome)| outcome)
    .map_err(|e| Error::from(anyhow::anyhow!(e)))
}

#[tauri::command(async)]
#[instrument(err(Debug))]
pub fn list_workflows(
    project_id: ProjectHandleOrLegacyProjectId,
    offset: i64,
    limit: i64,
) -> anyhow::Result<but_action::WorkflowList, Error> {
    let ctx: Context = project_id.try_into()?;
    but_action::list_workflows(&ctx, offset, limit).map_err(|e| Error::from(anyhow::anyhow!(e)))
}
