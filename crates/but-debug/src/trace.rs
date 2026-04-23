//! Tracing setup for `but-debug`.

use anyhow::Result;

/// Initialize tracing output according to the requested verbosity.
pub(crate) fn init(trace_level: u8) -> Result<()> {
    if trace_level == 0 {
        return Ok(());
    }

    let level = match trace_level {
        1 => tracing::metadata::LevelFilter::INFO,
        2 => tracing::metadata::LevelFilter::DEBUG,
        _ => tracing::metadata::LevelFilter::TRACE,
    };

    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_max_level(level)
        .init();
    Ok(())
}
