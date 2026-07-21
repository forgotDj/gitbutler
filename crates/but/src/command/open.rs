use but_api::open::{list_program_specs, program::open_in_program_unchecked};
use but_ctx::Context;
use gix::utils::AsBStr;

use crate::{
    CliResult, IdMap,
    args::atoms::{CliIdArg, Purpose, ResolvedCliIdArg},
    bad_input,
};

pub(crate) fn open(
    ctx: &mut Context,
    cli_id: CliIdArg,
    program_id: Option<String>,
) -> CliResult<()> {
    let guard = ctx.shared_worktree_access();
    let id_map = IdMap::new_from_context(ctx, None, guard.read_permission())?;
    let (repo, _ws, _db) = ctx.workspace_and_db_with_perm(guard.read_permission())?;

    let (path, line_nr) =
        match cli_id.resolve_in_workspace(&repo, &id_map, Purpose::Uncommitted, None)? {
            ResolvedCliIdArg::UncommittedHunkOrFile(uncommitted) => {
                let first_assignment = uncommitted.hunk_assignments.first();
                let path =
                    gix::path::from_bstr(first_assignment.path_bytes.as_bstr()).to_path_buf();
                let line_nr = if uncommitted.is_entire_file {
                    None
                } else {
                    first_assignment.hunk_header.map(|header| {
                        (header.new_range().start + ctx.settings.context_lines) as i32
                    })
                };
                (path, line_nr)
            }
            resolved_id => {
                return Err(bad_input(format!(
                    "Expected uncommitted file or hunk, got {}",
                    resolved_id.kind_for_humans()
                ))
                .into());
            }
        };

    let program = if let Some(program_id) = program_id {
        match list_program_specs().iter().find(|ps| ps.id == program_id) {
            Some(program) => program,
            None => {
                return Err(bad_input("No such program")
                    .arg_name("--program-id")
                    .arg_value(program_id)
                    .into());
            }
        }
    } else {
        list_program_specs()
            .first()
            .expect("The list of programs cannot be empty")
    };

    open_in_program_unchecked(program, &path, line_nr)?;

    Ok(())
}
