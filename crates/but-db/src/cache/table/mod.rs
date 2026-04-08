use crate::M;

/// The migrations to run for application wide caches.
pub const APP_MIGRATIONS: &[&[M<'static>]] = &[update::M];
/// The migrations to run for project-local caches.
pub const PROJECT_MIGRATIONS: &[&[M<'static>]] = &[removed_change_ids::M];

pub(crate) mod removed_change_ids;
pub(crate) mod update;
