/// Start the `but-debug` CLI.
fn main() -> anyhow::Result<()> {
    but_debug::handle_args(std::env::args_os())
}
