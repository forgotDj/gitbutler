use but_core::ref_metadata::StackId;
use but_ctx::Context;
use gix::ObjectId;
use itertools::Itertools;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewordOutcome {
    pub stack_id: StackId,
    pub branch_name: String,
    #[serde(with = "but_serde::object_id")]
    pub commit_id: ObjectId,
    pub new_message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameBranchOutcome {
    pub stack_id: StackId,
    pub old_branch_name: String,
    pub new_branch_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "subject", rename_all = "camelCase")]
pub enum Kind {
    Reword(Option<RewordOutcome>),
    RenameBranch(RenameBranchOutcome),
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "subject", rename_all = "camelCase")]
pub enum Status {
    Completed,
    Failed(String),
    Interrupted(Uuid),
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(tag = "type", content = "subject", rename_all = "camelCase")]
pub enum Trigger {
    Manual,
    Snapshot(Uuid),
    #[default]
    Unknown,
}

/// Represents a workflow that was executed by GitButler.
#[derive(Debug, Clone)]
pub struct Workflow {
    /// Unique identifier for the workflow.
    id: Uuid,
    /// The time when the workflow was captured.
    created_at: chrono::NaiveDateTime,
    /// The type of the workflow performed.
    kind: Kind,
    /// The trigger that initiated the workflow.
    triggered_by: Trigger,
    /// The status of the workflow.
    status: Status,
    /// Input commits
    input_commits: Vec<ObjectId>,
    /// Output commits
    output_commits: Vec<ObjectId>,
    /// Optional summary of the workflow
    summary: Option<String>,
}

impl TryFrom<Workflow> for but_db::Workflow {
    type Error = anyhow::Error;

    fn try_from(value: Workflow) -> Result<Self, Self::Error> {
        let kind = serde_json::to_string(&value.kind)?;
        let triggered_by = serde_json::to_string(&value.triggered_by)?;
        let status = serde_json::to_string(&value.status)?;
        let input_commits = serde_json::to_string(
            &value
                .input_commits
                .iter()
                .map(|c| c.to_string())
                .collect_vec(),
        )?;
        let output_commits = serde_json::to_string(
            &value
                .output_commits
                .iter()
                .map(|c| c.to_string())
                .collect_vec(),
        )?;
        let summary = value.summary.as_deref().map(|s| s.to_string());
        Ok(Self {
            id: value.id.to_string(),
            created_at: value.created_at,
            kind,
            triggered_by,
            status,
            input_commits,
            output_commits,
            summary,
        })
    }
}

impl Workflow {
    pub fn new(
        kind: Kind,
        triggered_by: Trigger,
        status: Status,
        input_commits: Vec<ObjectId>,
        output_commits: Vec<ObjectId>,
        summary: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            created_at: chrono::Local::now().naive_local(),
            kind,
            triggered_by,
            status,
            input_commits,
            output_commits,
            summary,
        }
    }

    pub(crate) fn persist(self, ctx: &Context) -> anyhow::Result<()> {
        ctx.db
            .get_cache_mut()?
            .workflows_mut()
            .insert(self.try_into()?)
            .map_err(|e| anyhow::anyhow!("Failed to persist workflow: {e}"))?;
        Ok(())
    }
}
