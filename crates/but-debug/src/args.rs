//! Command-line argument parsing for `but-debug`.

use std::path::PathBuf;

/// Top-level CLI arguments for `but-debug`.
#[derive(Debug, clap::Parser)]
#[command(
    name = "but-debug",
    about = "Debugging utilities for GitButler repositories",
    version = option_env!("GIX_VERSION")
)]
pub struct Args {
    /// Enable tracing for debug and performance information printed to stderr.
    #[arg(short = 't', long, action = clap::ArgAction::Count)]
    pub trace: u8,
    /// Run as if `but-debug` was started in `PATH` instead of the current working directory.
    #[arg(short = 'C', long, default_value = ".", value_name = "PATH")]
    pub current_dir: PathBuf,
    /// The debugging command to run.
    #[command(subcommand)]
    pub cmd: Subcommands,
}

/// The debugging subcommands supported by `but-debug`.
#[derive(Debug, clap::Subcommand)]
pub enum Subcommands {
    /// Return a segmented graph starting from `HEAD`.
    Graph(GraphArgs),
}

/// Arguments for the `graph` debugging subcommand.
#[derive(Debug, clap::Args)]
pub struct GraphArgs {
    /// Debug-print the whole graph and ignore all other dot-related flags.
    #[arg(long, short = 'd')]
    pub debug: bool,
    /// Print graph statistics first to get a grasp of huge graphs.
    #[arg(long, short = 's')]
    pub stats: bool,
    /// The rev-spec of the extra target to provide for traversal.
    #[arg(long)]
    pub extra_target: Option<String>,
    /// Disable post-processing of the graph, useful if that's failing.
    #[arg(long)]
    pub no_post: bool,
    /// Do not debug-print the workspace.
    ///
    /// If too large, it takes a long time or runs out of memory.
    #[arg(long)]
    pub no_debug_workspace: bool,
    /// Output the dot-file to stdout.
    #[arg(long, conflicts_with = "dot_show")]
    pub dot: bool,
    /// The maximum number of commits to traverse.
    ///
    /// Use only as safety net to prevent runaways.
    #[arg(long)]
    pub hard_limit: Option<usize>,
    /// The hint of the number of commits to traverse.
    ///
    /// Specifying no limit with `--limit` removes all limits.
    #[arg(long, short = 'l', default_value = "300")]
    pub limit: Option<Option<usize>>,
    /// Refill the limit when running over these hashes, provided as short or long hash.
    #[arg(long, short = 'e')]
    pub limit_extension: Vec<String>,
    /// Open the dot-file as SVG instead of writing it to stdout.
    #[arg(long)]
    pub dot_show: bool,
    /// The name of the ref to start the graph traversal at.
    pub ref_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory as _;

    use super::Args;

    #[test]
    fn clap_configuration_is_valid() {
        Args::command().debug_assert();
    }
}
