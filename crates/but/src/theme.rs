//! A global, serializable color theme for CLI output.
//!
//! Styled output *must* begin from one of the global theme's styles. Using [`colored`] or [`Style`]
//! indepentently of this theme is prohibited, as that breaks user-defined theming.
//!
//! The theme controls the styling of semantic elements (branch names, commit IDs, file statuses,
//! etc.) for human-readable output modes. It can be loaded from a JSON file so users can customize
//! colors, or left at its defaults which reproduce the original hard-coded palette.
//!
//! # Startup
//!
//! Call [`init`] exactly once before any output is produced (typically in [`crate::handle_args`]).
//! After that, [`get`] returns a `&'static Theme`.
//!
//! Note that unit tests **do not need to initialize** the theme as we always return the hard-coded
//! default for tests.
//!
//!
//! # Serialization
//!
//! Style fields are [`ratatui::style::Style`] values which serialize to JSON like:
//!
//! ```json
//! { "fg": "Green", "add_modifier": "BOLD" }
//! ```
//!
//! Missing fields in a user-supplied file fall back to the built-in defaults thanks to
//! `#[serde(default)]`.

use std::{path::Path, sync::OnceLock};

use colored::{ColoredString, Colorize as _};
use ratatui::style::{Color, Modifier, Style};
use serde::{Deserialize, Serialize};

/// Global theme instance, initialized once at startup.
static THEME: OnceLock<Theme> = OnceLock::new();

/// Initialize the global theme.
///
/// Must be called exactly once, before any call to [`get`].
/// Panics if called more than once.
pub fn init(theme: Theme) {
    THEME
        .set(theme)
        .expect("theme may only be initialized once");
}

/// Return a reference to the global theme.
///
/// Panics if [`init`] has not been called yet.
pub fn get() -> &'static Theme {
    #[cfg(test)]
    {
        let theme = THEME.get();
        if let Some(theme) = theme {
            return theme;
        }
        let _ = THEME.set(Theme::default());
        get()
    }
    #[cfg(not(test))]
    {
        THEME
            .get()
            .expect("theme::init() must be called before getting the theme")
    }
}

/// Load a theme from a JSON file.
///
/// Fields that are absent in the file keep their [`Theme::default`] values.
pub fn load(path: &Path) -> anyhow::Result<Theme> {
    let contents = std::fs::read_to_string(path)?;
    let theme: Theme = serde_json::from_str(&contents)?;
    Ok(theme)
}

/// Extension trait that lets a [`Style`] paint a string via the [`colored`] crate.
///
/// ```ignore
/// use crate::theme::Paint;
/// let t = crate::theme::get();
/// writeln!(out, "{}", t.local_branch.paint(&name))?;
/// ```
pub trait Paint {
    /// Apply this style to `text`, producing a [`ColoredString`].
    fn paint(&self, text: &str) -> ColoredString;
}

impl Paint for Style {
    fn paint(&self, text: &str) -> ColoredString {
        let mut styled = text.normal();

        if let Some(fg) = self.fg {
            styled = apply_foreground(styled, fg);
        }
        if let Some(bg) = self.bg {
            styled = apply_background(styled, bg);
        }
        styled = apply_modifiers(styled, self.add_modifier);

        styled
    }
}

/// Apply foreground color using `colored`.
fn apply_foreground(styled: ColoredString, color: Color) -> ColoredString {
    match color {
        Color::Black => styled.black(),
        Color::Red => styled.red(),
        Color::Green => styled.green(),
        Color::Yellow => styled.yellow(),
        Color::Blue => styled.blue(),
        Color::Magenta => styled.magenta(),
        Color::Cyan => styled.cyan(),
        Color::Gray | Color::White => styled.white(),
        Color::DarkGray => styled.bright_black(),
        Color::LightRed => styled.bright_red(),
        Color::LightGreen => styled.bright_green(),
        Color::LightYellow => styled.bright_yellow(),
        Color::LightBlue => styled.bright_blue(),
        Color::LightMagenta => styled.bright_magenta(),
        Color::LightCyan => styled.bright_cyan(),
        Color::Rgb(r, g, b) => styled.truecolor(r, g, b),
        Color::Indexed(_) | Color::Reset => styled,
    }
}

/// Apply background color using `colored`.
fn apply_background(styled: ColoredString, color: Color) -> ColoredString {
    match color {
        Color::Black => styled.on_black(),
        Color::Red => styled.on_red(),
        Color::Green => styled.on_green(),
        Color::Yellow => styled.on_yellow(),
        Color::Blue => styled.on_blue(),
        Color::Magenta => styled.on_magenta(),
        Color::Cyan => styled.on_cyan(),
        Color::Gray | Color::White => styled.on_white(),
        Color::DarkGray => styled.on_bright_black(),
        Color::LightRed => styled.on_bright_red(),
        Color::LightGreen => styled.on_bright_green(),
        Color::LightYellow => styled.on_bright_yellow(),
        Color::LightBlue => styled.on_bright_blue(),
        Color::LightMagenta => styled.on_bright_magenta(),
        Color::LightCyan => styled.on_bright_cyan(),
        Color::Rgb(r, g, b) => styled.on_truecolor(r, g, b),
        Color::Indexed(_) | Color::Reset => styled,
    }
}

/// Apply all style modifiers supported by `colored`.
fn apply_modifiers(mut styled: ColoredString, modifiers: Modifier) -> ColoredString {
    if modifiers.contains(Modifier::BOLD) {
        styled = styled.bold();
    }
    if modifiers.contains(Modifier::DIM) {
        styled = styled.dimmed();
    }
    if modifiers.contains(Modifier::ITALIC) {
        styled = styled.italic();
    }
    if modifiers.contains(Modifier::UNDERLINED) {
        styled = styled.underline();
    }
    if modifiers.contains(Modifier::SLOW_BLINK) || modifiers.contains(Modifier::RAPID_BLINK) {
        styled = styled.blink();
    }
    if modifiers.contains(Modifier::REVERSED) {
        styled = styled.reversed();
    }
    if modifiers.contains(Modifier::HIDDEN) {
        styled = styled.hidden();
    }
    if modifiers.contains(Modifier::CROSSED_OUT) {
        styled = styled.strikethrough();
    }
    styled
}

/// The CLI color theme.
///
/// Style fields ([`Style`]) control colors and text attributes for semantic
/// elements.  All fields fall back to their defaults when missing from a
/// deserialized file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Theme {
    // Concrete "things"
    /// Local branch name
    pub local_branch: Style,
    /// Remote / target branch name
    pub remote_branch: Style,
    /// Commit short hash / object ID wherever it appears outside of CLI IDs.
    pub commit_id: Style,
    /// Short CLI identifiers
    pub cli_id: Style,
    /// PR / review number decorations
    pub pr_number: Style,
    /// Hyperlinks (PR URLs, review links).
    pub link: Style,
    /// Configuration value (user name, email, provider, alias value, etc.).
    pub config_value: Style,
    /// Configuration key / setting name (e.g. git config keys, alias names).
    pub config_key: Style,

    // Modifications
    /// An addition
    pub addition: Style,
    /// A deletion
    pub deletion: Style,
    /// A modification
    pub modification: Style,
    /// A renaming
    pub renaming: Style,

    // State signals
    /// Something completed successfully or is in a good state
    pub success: Style,
    /// The user should pay attention to this.
    pub attention: Style,
    /// Something went wrong or is in an error state
    pub error: Style,
    /// Highlight something that is purely informational
    pub info: Style,

    // General purpose
    /// Subdued hint text for supplemental information that should not demand attention
    pub hint: Style,
    /// Something that is important to the user, such as a prompt for input
    pub important: Style,
    /// Suggested command the user can run (e.g. `but config target …`).
    pub command_suggestion: Style,
}

/// Helper — builds a [`Style`] with the given foreground color.
const fn style_fg(fg: Color) -> Style {
    Style::new().fg(fg)
}

/// Helper — builds a bold + colored [`Style`].
const fn style_fg_bold(fg: Color) -> Style {
    Style::new().fg(fg).add_modifier(Modifier::BOLD)
}

impl Default for Theme {
    /// Produces the canonical color palette.
    fn default() -> Self {
        Self {
            // Concrete "things"
            local_branch: style_fg(Color::Green),
            remote_branch: style_fg(Color::Magenta),
            commit_id: style_fg(Color::Cyan),
            cli_id: style_fg_bold(Color::Blue),
            pr_number: style_fg(Color::Blue),
            link: Style::new()
                .fg(Color::Blue)
                .add_modifier(Modifier::UNDERLINED),
            config_value: style_fg(Color::Cyan),
            config_key: style_fg(Color::Green),

            // Modifications
            addition: style_fg(Color::Green),
            deletion: style_fg(Color::Red),
            modification: style_fg(Color::Yellow),
            renaming: style_fg(Color::Magenta),

            // State signals
            success: style_fg(Color::Green),
            attention: style_fg(Color::Yellow),
            error: style_fg(Color::Red),
            info: style_fg(Color::Cyan),

            // General purpose
            hint: Style::new().add_modifier(Modifier::DIM),
            important: Style::new().add_modifier(Modifier::BOLD),
            command_suggestion: Style::new().fg(Color::Blue).add_modifier(Modifier::DIM),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_default_theme_through_json() {
        let theme = Theme::default();
        let json = serde_json::to_string_pretty(&theme).unwrap();
        let deserialized: Theme = serde_json::from_str(&json).unwrap();
        assert_eq!(theme, deserialized);
    }

    #[test]
    fn partial_json_fills_missing_fields_with_defaults() {
        let json = r#"{ "local_branch": { "fg": "Cyan", "add_modifier": "BOLD" } }"#;
        let theme: Theme = serde_json::from_str(json).unwrap();

        assert_eq!(theme.local_branch, style_fg_bold(Color::Cyan));
        assert_eq!(theme.remote_branch, Theme::default().remote_branch);
        assert_eq!(theme.cli_id, Theme::default().cli_id);
        assert_eq!(theme.addition, Theme::default().addition);
    }

    #[test]
    fn empty_json_produces_default_theme() {
        let theme: Theme = serde_json::from_str("{}").unwrap();
        assert_eq!(theme, Theme::default());
    }

    #[test]
    fn paint_produces_colored_output() {
        let style = style_fg_bold(Color::Green);
        let result = style.paint("hello");
        assert!(result.to_string().contains("hello"));
    }
}
