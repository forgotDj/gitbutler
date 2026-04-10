use but_core::ref_metadata::StackId;
use but_ctx::Context;

pub(crate) fn stack_id_by_commit_id(ctx: &Context, oid: gix::ObjectId) -> anyhow::Result<StackId> {
    let stacks = crate::legacy::commits::stacks(ctx)?
        .iter()
        .filter_map(|s| {
            s.id.map(|id| crate::legacy::commits::stack_details(ctx, id).map(|d| (id, d)))
        })
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    if let Some((id, _)) = stacks.iter().find(|(_, stack)| {
        stack
            .branch_details
            .iter()
            .any(|branch| branch.commits.iter().any(|commit| commit.id == oid))
    }) {
        return Ok(*id);
    }
    anyhow::bail!("No stack found for commit {oid}")
}
