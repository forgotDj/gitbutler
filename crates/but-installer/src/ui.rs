//! User interface and output functions.
//!
//! Provides colored output functions for the installer. All functions ignore I/O errors
//! to ensure the installation can continue even if output fails (e.g., broken pipe).

use std::io::{self, IsTerminal, Write, stdin};

use owo_colors::{OwoColorize, Stream};

/// Print a line to stdout, ignoring all I/O errors
///
/// For an installer, we don't want to fail just because we can't write output.
/// The installation itself is more important than the output.
fn print_stdout(s: &str) {
    writeln!(io::stdout(), "{s}").ok();
}

/// Print a line to stderr, ignoring all I/O errors
///
/// For an installer, we don't want to fail just because we can't write output.
/// The installation itself is more important than the output.
fn print_stderr(s: &str) {
    writeln!(io::stderr(), "{s}").ok();
}

/// Prints a warning message to stderr in yellow.
pub fn warn(msg: &str) {
    print_stderr(&format!(
        "{} {}",
        "Warning:".if_supports_color(Stream::Stderr, |t| t.yellow()),
        msg
    ));
}

/// Prints a success message to stdout in green.
pub fn success(msg: &str) {
    print_stdout(&format!(
        "{}",
        msg.if_supports_color(Stream::Stdout, |t| t.green())
    ));
}

/// Prints an informational message to stdout in blue.
pub fn info(msg: &str) {
    print_stdout(&format!(
        "{}",
        msg.if_supports_color(Stream::Stdout, |t| t.blue())
    ));
}

/// Prints an error message to stderr in red.
pub fn error(msg: &str) {
    print_stderr(&format!(
        "{} {}",
        "Error:".if_supports_color(Stream::Stderr, |t| t.red()),
        msg
    ));
}

/// Prints a plain line to stdout without coloring.
pub fn println(msg: &str) {
    print_stdout(msg);
}

/// Prints an empty line to stdout.
pub fn println_empty() {
    print_stdout("");
}

/// Prompts a user for a [y/N] style confirmation.
///
/// Returns true if the user enters "y" or "yes" with any casing.
pub fn prompt_for_confirmation(prompt: &str) -> io::Result<bool> {
    print(prompt);
    print(" [y]es [N]o (default=No): ");

    let mut response = String::new();
    stdin().read_line(&mut response)?;
    response = response.trim().to_lowercase();

    Ok(response == "yes" || response == "y")
}

/// Checks if there is a terminal to prompt on.
pub fn can_prompt() -> bool {
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal()
}

/// Prints to stdout without a newline, ignoring all I/O errors.
///
/// Useful for progress indicators that overwrite themselves with `\r`.
pub fn print(s: &str) {
    let mut stdout = io::stdout();
    write!(stdout, "{s}").ok();
    stdout.flush().ok();
}
