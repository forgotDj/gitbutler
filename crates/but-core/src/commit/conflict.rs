use bstr::{BStr, BString, ByteSlice};

use super::Headers;

/// The prefix prepended to the commit subject line to mark a conflicted commit.
pub const CONFLICT_MESSAGE_PREFIX: &str = "[conflict] ";

/// The git trailer token used to identify GitButler-managed conflicted commits.
/// The description explaining the conflict is embedded as the multi-line trailer
/// value, with continuation lines indented by 3 spaces per git convention.
const CONFLICT_TRAILER_TOKEN: &str = "GitButler-Conflict";

/// The full multi-line git trailer appended to conflicted commit messages.
/// The description is the trailer value; continuation lines are indented with
/// 3 spaces so standard git trailer tools can parse and manipulate them.
const CONFLICT_TRAILER: &str = concat!(
    "GitButler-Conflict: This is a GitButler-managed conflicted commit. Files are auto-resolved\n",
    "   using the \"ours\" side. The commit tree contains additional directories:\n",
    "     .conflict-side-0  \u{2014} our tree\n",
    "     .conflict-side-1  \u{2014} their tree\n",
    "     .conflict-base-0  \u{2014} the merge base tree\n",
    "     .auto-resolution  \u{2014} the auto-resolved tree\n",
    "     .conflict-files   \u{2014} metadata about conflicted files\n",
    "   To manually resolve, check out this commit, remove the directories\n",
    "   listed above, resolve the conflicts, and amend the commit."
);

/// Add conflict markers to a commit `message`: prepend `[conflict] ` to the
/// subject and append the `GitButler-Conflict` multi-line trailer after any
/// existing trailers, and return the new message.
/// The `message` is returned unchanged if it already contained conflict markers.
///
/// A single trailing newline is trimmed from the input before markers are
/// added; callers that need byte-exact round-trips should account for this.
pub fn add_conflict_markers(message: &BStr) -> BString {
    if message_is_conflicted(message) {
        return message.into();
    }
    let trimmed = message
        .as_bytes()
        .strip_suffix(b"\n")
        .unwrap_or(message.as_bytes());

    let capacity = CONFLICT_MESSAGE_PREFIX.len() + trimmed.len() + 2 + CONFLICT_TRAILER.len() + 1;
    let mut result = BString::from(Vec::with_capacity(capacity));
    result.extend_from_slice(CONFLICT_MESSAGE_PREFIX.as_bytes());
    result.extend_from_slice(trimmed);

    // Trailers must be in the last paragraph — join directly if one exists.
    if ends_in_trailer_block(trimmed) {
        result.push(b'\n');
    } else {
        result.extend_from_slice(b"\n\n");
    }
    result.extend_from_slice(CONFLICT_TRAILER.as_bytes());
    result.push(b'\n');
    result
}

/// Strip conflict markers from a commit message.
/// Returns the message unchanged when it is not conflicted (per
/// [`message_is_conflicted`]).
///
/// Strips the `[conflict] ` subject prefix (if present) and the
/// `GitButler-Conflict` trailer line together with all its indented
/// continuation lines.
///
/// Note: the returned message may not be byte-identical to the original —
/// trailing newlines are not preserved and line endings may be normalized.
pub fn strip_conflict_markers(message: &BStr) -> BString {
    if !message_is_conflicted(message) {
        return message.to_owned();
    }

    let bytes = message.as_bytes();

    // Strip the subject prefix if present.
    let without_prefix = bytes
        .strip_prefix(CONFLICT_MESSAGE_PREFIX.as_bytes())
        .unwrap_or(bytes);

    // Remove the GitButler-Conflict trailer only from the last paragraph
    // to avoid accidentally stripping user-authored content earlier in the body
    // that happens to match the trailer token.
    let lines: Vec<&[u8]> = without_prefix.lines().collect();
    let mut result_lines: Vec<&[u8]> = Vec::with_capacity(lines.len());

    // Find the start of the last paragraph (after the last blank line).
    let last_para_start = lines
        .iter()
        .enumerate()
        .rev()
        .find(|(_, l)| l.is_empty())
        .map(|(i, _)| i + 1)
        .unwrap_or(0);

    // Copy everything before the last paragraph unchanged.
    let mut i = 0;
    while i < last_para_start {
        result_lines.push(lines[i]);
        i += 1;
    }

    // In the last paragraph, strip the conflict trailer and its continuation lines.
    while i < lines.len() {
        let line = lines[i];
        if line_starts_with_conflict_trailer(line) {
            i += 1;
            while i < lines.len() && lines[i].first().is_some_and(|b| b.is_ascii_whitespace()) {
                i += 1;
            }
        } else {
            result_lines.push(line);
            i += 1;
        }
    }

    // Drop trailing blank lines left behind after removing the trailer.
    while result_lines.last().is_some_and(|l| l.is_empty()) {
        result_lines.pop();
    }

    let mut result = BString::from(Vec::new());
    for (idx, line) in result_lines.iter().enumerate() {
        if idx > 0 {
            result.push(b'\n');
        }
        result.extend_from_slice(line);
    }
    result
}

/// Returns `true` when the commit is conflicted either by message marker
/// (current encoding) or by the legacy `gitbutler-conflicted` header.
pub fn is_conflicted(message: &BStr, headers: Option<&Headers>) -> bool {
    message_is_conflicted(message) || headers.is_some_and(Headers::is_conflicted)
}

/// Returns `true` when the commit message contains a `GitButler-Conflict:`
/// trailer in the last paragraph. The `[conflict] ` subject prefix is
/// informational and not required for detection.
///
/// Trailing blank lines are skipped so that messages edited by users or tools
/// that append newlines are still detected correctly.
pub fn message_is_conflicted(message: &BStr) -> bool {
    let bytes = message.as_bytes();
    let mut in_content = false;
    for line in bytes.lines().rev() {
        if line.is_empty() {
            if in_content {
                break;
            }
            // Skip trailing blank lines before the last paragraph.
            continue;
        }
        in_content = true;
        if line_starts_with_conflict_trailer(line) {
            return true;
        }
    }
    false
}

/// If `old_message` is conflicted but `new_message` is not, re-apply the
/// conflict markers to `new_message`. This is used during reword and squash
/// so that editing a conflicted commit's message doesn't silently drop the
/// conflict state.
///
/// Strips any existing partial markers from `new_message` before re-adding
/// to avoid double-prefixing or duplicate trailers.
pub fn rewrite_conflict_markers_on_message_change(
    old_message: &BStr,
    new_message: BString,
) -> BString {
    if message_is_conflicted(old_message) && !message_is_conflicted(new_message.as_ref()) {
        // Strip the `[conflict] ` prefix if the user left it in,
        // then re-add the full set of markers.
        let clean = new_message
            .as_bytes()
            .strip_prefix(CONFLICT_MESSAGE_PREFIX.as_bytes())
            .map(BString::from)
            .unwrap_or(new_message);
        add_conflict_markers(clean.as_ref())
    } else {
        new_message
    }
}

/// Returns `true` if `bytes` ends with a git trailer block — a paragraph where
/// every line is either a `Token: value` trailer or an indented continuation.
fn ends_in_trailer_block(bytes: &[u8]) -> bool {
    let lines: Vec<&[u8]> = bytes.lines().collect();

    // Trailers must be in a paragraph separated by a blank line from the subject.
    // If there is no blank line, there is no trailer block.
    let Some(blank_pos) = lines
        .iter()
        .enumerate()
        .rev()
        .find(|(_, l)| l.is_empty())
        .map(|(i, _)| i)
    else {
        return false;
    };
    let para_start = blank_pos + 1;

    let para = &lines[para_start..];
    if para.is_empty() {
        return false;
    }

    let mut found_any = false;
    let mut prev_was_trailer_or_continuation = false;
    for line in para {
        let is_continuation = line.first().is_some_and(|b| b.is_ascii_whitespace());
        if is_continuation {
            if !prev_was_trailer_or_continuation {
                return false;
            }
            prev_was_trailer_or_continuation = true;
        } else if is_trailer_line(line) {
            found_any = true;
            prev_was_trailer_or_continuation = true;
        } else {
            return false;
        }
    }
    found_any
}

/// Returns `true` for lines of the form `Token: value` where `Token` contains
/// no spaces and the value is non-empty (i.e. `: ` follows the token).
fn is_trailer_line(line: &[u8]) -> bool {
    let Some(colon) = line.find_byte(b':') else {
        return false;
    };
    if colon == 0 {
        return false;
    }
    let token = &line[..colon];
    !token.contains(&b' ') && line.get(colon + 1) == Some(&b' ')
}

/// Returns `true` when `line` starts with `GitButler-Conflict:`.
fn line_starts_with_conflict_trailer(line: &[u8]) -> bool {
    line.strip_prefix(CONFLICT_TRAILER_TOKEN.as_bytes())
        .is_some_and(|rest| rest.first() == Some(&b':'))
}

#[cfg(test)]
mod tests {
    use crate::commit::Headers;
    use bstr::BStr;

    use super::*;

    fn marked(msg: &str) -> String {
        String::from_utf8(add_conflict_markers(BStr::new(msg)).into()).unwrap()
    }

    fn stripped(msg: &str) -> String {
        String::from_utf8(strip_conflict_markers(BStr::new(msg)).into()).unwrap()
    }

    fn message_is_marked_conflicted(msg: &str) -> bool {
        message_is_conflicted(BStr::new(msg))
    }

    /// Round-trip: add then strip returns the original (modulo the trailing
    /// newline that `add_conflict_markers` always trims).
    #[test]
    fn simple_subject_roundtrip() {
        let original = "fix the bug";
        let result = stripped(&marked(original));
        assert_eq!(result, original);
        assert!(message_is_marked_conflicted(&marked(original)));
    }

    #[test]
    fn trailing_newline_is_trimmed_by_add() {
        // add_conflict_markers trims a trailing newline; strip reflects that.
        assert_eq!(stripped(&marked("fix the bug\n")), "fix the bug");
    }

    #[test]
    fn subject_and_body_roundtrip() {
        let original = "fix the bug\n\nDetailed explanation here.";
        assert_eq!(stripped(&marked(original)), original);
    }

    #[test]
    fn existing_trailers_are_preserved_and_ours_comes_last() {
        let original = "fix the bug\n\nChange-Id: I1234567\nSigned-off-by: User <u@e.com>";
        let result = marked(original);
        assert!(message_is_marked_conflicted(&result));

        // Existing trailers must still be present
        assert!(result.contains("Change-Id: I1234567\n"));
        assert!(result.contains("Signed-off-by: User <u@e.com>\n"));

        // Our trailer must come after the existing ones
        let signed_pos = result.find("Signed-off-by:").unwrap();
        let conflict_pos = result.find(CONFLICT_TRAILER_TOKEN).unwrap();
        assert!(
            conflict_pos > signed_pos,
            "GitButler-Conflict trailer must follow existing trailers"
        );

        // Roundtrip
        assert_eq!(stripped(&result), original);
    }

    #[test]
    fn subject_with_only_trailers_roundtrip() {
        let original = "fix the bug\n\nChange-Id: I1234567";
        assert_eq!(stripped(&marked(original)), original);
    }

    #[test]
    fn body_and_trailers_roundtrip() {
        let original =
            "fix the bug\n\nSome explanation.\n\nChange-Id: I1234567\nSigned-off-by: A <a@b.com>";
        assert_eq!(stripped(&marked(original)), original);
    }

    #[test]
    fn description_is_the_trailer_value_not_a_separate_paragraph() {
        let result = marked("subject");
        // The description must appear on the same line as GitButler-Conflict:
        // (or as indented continuation lines), not as a separate paragraph.
        let trailer_start = format!("{CONFLICT_TRAILER_TOKEN}:");
        let conflict_line = result
            .lines()
            .find(|l| l.starts_with(&trailer_start))
            .expect("trailer line must exist");
        assert!(
            conflict_line.len() > trailer_start.len(),
            "trailer token must have an inline value, got: {conflict_line:?}"
        );
    }

    #[test]
    fn prefix_without_trailer_is_not_conflicted() {
        assert!(!message_is_marked_conflicted(
            "[conflict] looks real but no trailer"
        ));
    }

    #[test]
    fn trailer_without_prefix_is_still_conflicted() {
        let msg = "normal commit\n\nGitButler-Conflict: sneaky";
        // Detection depends only on the trailer, not the prefix.
        assert!(message_is_marked_conflicted(msg));
        // Strip removes the trailer even without the prefix.
        assert_eq!(stripped(msg), "normal commit");
    }

    #[test]
    fn add_is_idempotent() {
        let original = "subject";
        let once = marked(original);
        let twice = marked(&once);

        assert!(message_is_marked_conflicted(&once));
        assert_eq!(twice, once);
        assert_eq!(stripped(&once), stripped(&stripped(&once)));
    }

    #[test]
    fn strip_is_idempotent() {
        let original = marked("subject");
        let once = stripped(&original);
        let twice = stripped(&once);

        assert_eq!(twice, once);
    }

    #[test]
    fn trailing_blank_lines_after_trailer_still_detected() {
        let msg = format!("subject\n\n{CONFLICT_TRAILER}\n\n");
        assert!(
            message_is_marked_conflicted(&msg),
            "trailing blank lines must not break detection"
        );
    }

    /// The trailer token appearing in the body (not the last paragraph) must
    /// not be stripped — only the actual trailer in the last paragraph is removed.
    #[test]
    fn strip_only_removes_trailer_from_last_paragraph() {
        let body_with_token = format!(
            "[conflict] subject\n\nGitButler-Conflict: mentioned in body\n\n{CONFLICT_TRAILER}\n"
        );
        assert!(message_is_marked_conflicted(&body_with_token));
        let result = stripped(&body_with_token);
        assert!(
            result.contains("GitButler-Conflict: mentioned in body"),
            "body occurrence must be preserved, got: {result:?}"
        );
        assert!(
            !result.contains("This is a GitButler-managed"),
            "the trailer itself must be removed"
        );
    }

    #[test]
    fn rewrite_does_not_double_prefix() {
        let original = "fix bug";
        let conflicted = marked(original);
        // Simulate a new message that already has the prefix but no trailer.
        let partial = format!("{CONFLICT_MESSAGE_PREFIX}fix bug");
        let result = rewrite_conflict_markers_on_message_change(
            BStr::new(&conflicted),
            BString::from(partial),
        );
        let result_str = std::str::from_utf8(result.as_ref()).unwrap();
        // Must not produce "[conflict] [conflict] fix bug".
        let prefix_count = result_str.matches(CONFLICT_MESSAGE_PREFIX).count();
        assert_eq!(prefix_count, 1, "prefix must appear exactly once");
        assert!(message_is_marked_conflicted(result_str));
    }

    #[test]
    fn detects_conflicts_from_headers_too() {
        assert!(is_conflicted(
            BStr::new("ordinary message"),
            Some(&Headers {
                change_id: None,
                conflicted: Some(1),
            }),
        ));
        assert!(!is_conflicted(
            BStr::new("ordinary message"),
            Some(&Headers::default()),
        ));
        assert!(!is_conflicted(BStr::new("ordinary message"), None));
    }

    /// Verify that gix parses the `GitButler-Conflict` trailer alongside
    /// other standard trailers (Byron's review feedback).
    #[test]
    fn gix_parses_conflict_trailer_with_existing_trailers() {
        let original =
            "fix the bug\n\nSome body.\n\nChange-Id: I1234567\nSigned-off-by: A <a@b.com>";
        let result = marked(original);

        let msg = gix::objs::commit::MessageRef::from_bytes(BStr::new(&result));
        let body = msg.body().expect("message must have a body");
        let trailers: Vec<_> = body.trailers().collect();

        let tokens: Vec<&str> = trailers.iter().map(|t| t.token.to_str().unwrap()).collect();
        assert!(
            tokens.contains(&"Change-Id"),
            "Change-Id trailer must be parseable by gix, got: {tokens:?}"
        );
        assert!(
            tokens.contains(&"Signed-off-by"),
            "Signed-off-by trailer must be parseable by gix, got: {tokens:?}"
        );
        assert!(
            tokens.contains(&"GitButler-Conflict"),
            "GitButler-Conflict trailer must be parseable by gix, got: {tokens:?}"
        );
    }

    /// The `GitButler-Conflict` trailer must always be the last trailer in
    /// the message so it does not interfere with other trailer-based tools.
    #[test]
    fn conflict_trailer_is_last() {
        let original = "fix bug\n\nSome body.\n\nChange-Id: I123\nSigned-off-by: A <a@b.com>";
        let result = marked(original);

        let msg = gix::objs::commit::MessageRef::from_bytes(BStr::new(&result));
        let body = msg.body().expect("message must have a body");
        let trailers: Vec<_> = body.trailers().collect();
        let last = trailers.last().expect("must have at least one trailer");
        assert_eq!(
            last.token.to_str().unwrap(),
            "GitButler-Conflict",
            "conflict trailer must be the last trailer"
        );
    }

    /// Verify gix sees the `[conflict]` prefix in the title even for
    /// subject-only messages.
    ///
    /// Note: gix's trailer parser does not detect trailers when the body
    /// consists of only a single trailer paragraph (no preceding body text).
    /// Our manual detection handles this case; the gix interop tests below
    /// verify that messages WITH body text are parsed correctly by standard
    /// git trailer tools.
    #[test]
    fn subject_only_roundtrip_with_gix() {
        let original = "fix the bug";
        let result = marked(original);

        let msg = gix::objs::commit::MessageRef::from_bytes(BStr::new(&result));
        assert_eq!(
            msg.title.to_str().unwrap(),
            "[conflict] fix the bug",
            "gix must see the prefixed title"
        );

        // Round-trip
        assert_eq!(stripped(&result), original);
    }
}
