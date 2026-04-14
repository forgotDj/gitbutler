//! Functions to install the GitButler skill files

use std::{
    io::{IsTerminal, stdin},
    path::Path,
    process::{Command, Stdio},
};

use crate::ui::{open_tty, warn};

/// Check if `but skill install` is available
pub(crate) fn has_skill_install(but_binary: &Path) -> bool {
    let result = Command::new(but_binary)
        .arg("skill")
        .arg("install")
        .arg("--help")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    result.map(|status| status.success()).unwrap_or(false)
}

/// Install the GitButler skill files globally
pub(crate) fn but_skill_install_global(but_binary: &Path) {
    let stdin: Stdio = if stdin().is_terminal() {
        Stdio::inherit()
    } else {
        match open_tty() {
            Some(tty) => tty.into(),
            None => {
                warn("Could not open stdin to run `but skill install` interactively");
                return;
            }
        }
    };

    let status = Command::new(but_binary)
        .arg("skill")
        .arg("install")
        .arg("--global")
        .stdin(stdin)
        .status();

    match status {
        Err(err) => warn(&format!(
            "Something went wrong, skill files may not have been installed: {err}"
        )),
        Ok(status) if !status.success() => warn(&format!(
            "`but skill install` exited non-zero, skill files may not have been installed. {status}"
        )),
        _ => (),
    }
}
