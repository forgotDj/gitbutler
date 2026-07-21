use std::sync::Arc;

use but_ctx::Context;
use but_graph::Workspace;
use gix::ObjectId;
use nonempty::NonEmpty;
use ratatui::{prelude::Backend, text::Span};

use crate::{
    CliId, CliResultExt,
    args::atoms::{BranchArg, CommittedFile, ResolvedCliIdArgRef},
    command::legacy::{
        reword2::RewordCommitOperation,
        squash2::{
            self, HowToRewordTarget, ResolvedSquashArgsRef, SquashOperation, SquashOutcome,
            SquashTarget, resolve_target,
        },
        status::{
            FilesStatusFlag,
            output::StatusOutputLineData,
            tui::{
                DetailsLayoutMessage, Message, ReloadCause, SelectAfterReload,
                app::{App, MoveCursorDiration, mark::MarkedCommit},
                mode::Mode,
                render::{ModeRender, RenderSingleLineSpans, SpanExt as _, source_span},
            },
        },
    },
    id::UncommittedHunkOrFile,
    tui::TerminalGuard,
};

use super::mark::MarksRef;

#[derive(Debug, Clone)]
pub enum SquashSource {
    Uncommitted,
    Commit(NonEmpty<MarkedCommit>),
    UncommittedHunk(NonEmpty<UncommittedHunkOrFile>),
    Branch(BranchArg),
    CommittedFile(NonEmpty<CommittedFile>),
}

impl SquashSource {
    pub fn contains(&self, other: &CliId) -> bool {
        match self {
            SquashSource::Uncommitted => {
                matches!(other, CliId::Uncommitted { .. })
            }
            SquashSource::Branch(name) => match other {
                CliId::Branch {
                    name: target_name, ..
                } => &name.0 == target_name,
                _ => false,
            },
            SquashSource::Commit(commits) => {
                let marks = MarksRef::from_commits(commits);
                marks.contains_cli_id(other) || marks.contains_child_of(other)
            }
            SquashSource::UncommittedHunk(hunks) => {
                let marks = MarksRef::from_hunks(hunks);
                marks.contains_cli_id(other) || marks.contains_child_of(other)
            }
            SquashSource::CommittedFile(committed_files) => {
                let marks = MarksRef::from_committed_files(committed_files);
                marks.contains_cli_id(other) || marks.contains_child_of(other)
            }
        }
    }

    pub fn can_target(&self, target: &CliId) -> bool {
        self.operation_for_target(target).is_some()
    }

    pub fn operation_for_target(&self, target: &CliId) -> Option<&'static str> {
        Some(match self.route(target)? {
            SquashRoute::UncommittedHunkToCommit { .. }
            | SquashRoute::UncommittedToBranch { .. }
            | SquashRoute::UncommittedHunkToBranch { .. }
            | SquashRoute::UncommittedToCommit { .. } => "amend",
            SquashRoute::CommitToCommit { .. }
            | SquashRoute::CommitToBranch { .. }
            | SquashRoute::BranchToCommit { .. }
            | SquashRoute::BranchToBranch { .. }
            | SquashRoute::CommittedFileToCommit { .. }
            | SquashRoute::CommittedFileToBranch { .. }
            | SquashRoute::BranchToSelf { .. } => "squash",
            SquashRoute::CommittedFileToUncommitted { .. }
            | SquashRoute::CommitToUncommitted { .. } => "uncommit",
        })
    }

    fn route<'a>(&'a self, target: &'a CliId) -> Option<SquashRoute<'a>> {
        match self {
            SquashSource::Uncommitted => match target {
                CliId::Commit {
                    commit_id: target_commit,
                    ..
                } => Some(SquashRoute::UncommittedToCommit {
                    target: *target_commit,
                }),
                CliId::Branch {
                    name: target_branch,
                    ..
                } => Some(SquashRoute::UncommittedToBranch {
                    target: target_branch,
                }),
                _ => None,
            },
            SquashSource::Commit(source_commits) => match target {
                CliId::Commit {
                    commit_id: target_commit,
                    ..
                } => {
                    if source_commits.len() == 1 {
                        if source_commits.head.commit_id == *target_commit {
                            None
                        } else {
                            Some(SquashRoute::CommitToCommit {
                                sources: source_commits,
                                target: *target_commit,
                            })
                        }
                    } else {
                        Some(SquashRoute::CommitToCommit {
                            sources: source_commits,
                            target: *target_commit,
                        })
                    }
                }
                CliId::Branch {
                    name: target_branch,
                    ..
                } => Some(SquashRoute::CommitToBranch {
                    sources: source_commits,
                    target: target_branch,
                }),
                CliId::Uncommitted { .. } => Some(SquashRoute::CommitToUncommitted {
                    sources: source_commits,
                }),
                _ => None,
            },
            SquashSource::Branch(source_branch) => {
                if let CliId::Branch {
                    name: target_branch,
                    ..
                } = target
                    && &source_branch.0 == target_branch
                {
                    Some(SquashRoute::BranchToSelf {
                        source: source_branch,
                    })
                } else {
                    match target {
                        CliId::Commit {
                            commit_id: target_commit,
                            ..
                        } => Some(SquashRoute::BranchToCommit {
                            source: source_branch,
                            target: *target_commit,
                        }),
                        CliId::Branch {
                            name: target_branch,
                            ..
                        } => Some(SquashRoute::BranchToBranch {
                            source: source_branch,
                            target: target_branch,
                        }),
                        _ => None,
                    }
                }
            }
            SquashSource::UncommittedHunk(source_hunks) => match target {
                CliId::Commit {
                    commit_id: target_commit,
                    ..
                } => Some(SquashRoute::UncommittedHunkToCommit {
                    sources: source_hunks,
                    target: *target_commit,
                }),
                CliId::Branch {
                    name: target_branch,
                    ..
                } => Some(SquashRoute::UncommittedHunkToBranch {
                    sources: source_hunks,
                    target: target_branch,
                }),
                _ => None,
            },
            SquashSource::CommittedFile(source_files) => match target {
                CliId::Commit {
                    commit_id: target_commit,
                    ..
                } => Some(SquashRoute::CommittedFileToCommit {
                    sources: source_files,
                    target: *target_commit,
                }),
                CliId::Branch {
                    name: target_branch,
                    ..
                } => Some(SquashRoute::CommittedFileToBranch {
                    sources: source_files,
                    target: target_branch,
                }),
                CliId::Uncommitted { .. } => Some(SquashRoute::CommittedFileToUncommitted {
                    sources: source_files,
                }),
                _ => None,
            },
        }
    }
}

enum SquashRoute<'a> {
    UncommittedToCommit {
        target: ObjectId,
    },
    UncommittedToBranch {
        target: &'a str,
    },
    UncommittedHunkToCommit {
        sources: &'a NonEmpty<UncommittedHunkOrFile>,
        target: ObjectId,
    },
    UncommittedHunkToBranch {
        sources: &'a NonEmpty<UncommittedHunkOrFile>,
        target: &'a str,
    },
    CommitToUncommitted {
        sources: &'a NonEmpty<MarkedCommit>,
    },
    CommitToCommit {
        sources: &'a NonEmpty<MarkedCommit>,
        target: ObjectId,
    },
    CommitToBranch {
        sources: &'a NonEmpty<MarkedCommit>,
        target: &'a str,
    },
    BranchToCommit {
        source: &'a BranchArg,
        target: ObjectId,
    },
    BranchToBranch {
        source: &'a BranchArg,
        target: &'a str,
    },
    BranchToSelf {
        source: &'a BranchArg,
    },
    CommittedFileToCommit {
        sources: &'a NonEmpty<CommittedFile>,
        target: ObjectId,
    },
    CommittedFileToBranch {
        sources: &'a NonEmpty<CommittedFile>,
        target: &'a str,
    },
    CommittedFileToUncommitted {
        sources: &'a NonEmpty<CommittedFile>,
    },
}

#[derive(Debug, Clone)]
pub struct SquashMode {
    pub source: SquashSource,
    pub reword: SquashReword,
}

impl ModeRender for SquashMode {
    fn render_operation_target_marker(
        &self,
        app: &App,
        data: &StatusOutputLineData,
        line: &mut RenderSingleLineSpans<'_, '_>,
    ) {
        let Some(target) = data.cli_id() else {
            return;
        };

        if let Some(display) = self.source.operation_for_target(target) {
            if self.source.contains(target) {
                line.extend([source_span(app.theme), Span::raw(" ")]);
            }

            line.render(Span::raw("<< ").mode_colors(&*app.mode, app.theme));
            line.render(Span::raw(display).mode_colors(&*app.mode, app.theme));
            match self.reword {
                SquashReword::Infer => {}
                SquashReword::UseTarget => {
                    line.render(
                        Span::raw(" (use this message)").mode_colors(&*app.mode, app.theme),
                    );
                }
            }
            line.render(Span::raw(" >>").mode_colors(&*app.mode, app.theme));
            line.render(Span::raw(" "));
        } else {
            if self.source.contains(target) {
                line.extend([source_span(app.theme), Span::raw(" ")]);
            }
        }
    }

    fn render_operation_source_marker(
        &self,
        app: &App,
        data: &StatusOutputLineData,
        line: &mut RenderSingleLineSpans<'_, '_>,
    ) {
        if let Some(cli_id) = data.cli_id()
            && self.source.contains(cli_id)
        {
            line.extend([source_span(app.theme), Span::raw(" ")]);
        }
    }
}

#[derive(Debug, Copy, Clone)]
pub enum SquashReword {
    Infer,
    UseTarget,
}

#[derive(Debug)]
pub enum SquashMessage {
    Start,
    StartWith(Arc<CliId>),
    StartReverse,
    Confirm,
    UseTargetMessage,
}

impl App {
    pub fn handle_squash<T>(
        &mut self,
        squash_message: SquashMessage,
        ctx: &mut Context,
        terminal_guard: &mut T,
        messages: &mut Vec<Message>,
    ) -> anyhow::Result<()>
    where
        T: TerminalGuard,
        anyhow::Error: From<<T::Backend as Backend>::Error>,
    {
        match squash_message {
            SquashMessage::Start => self.handle_squash_start(messages),
            SquashMessage::StartWith(id) => self.handle_squash_start_with(id),
            SquashMessage::StartReverse => self.handle_squash_reverse(),
            SquashMessage::Confirm => self.handle_squash_confirm(ctx, terminal_guard, messages)?,
            SquashMessage::UseTargetMessage => self.handle_use_target_message(),
        }

        Ok(())
    }

    fn handle_squash_start(&mut self, messages: &mut Vec<Message>) {
        match &*self.mode {
            Mode::Normal(normal_mode) => match normal_mode.marks.as_ref() {
                MarksRef::Empty => {
                    let Some(selection) = self
                        .cursor
                        .selected_line(&self.status_lines)
                        .and_then(|line| line.data.cli_id())
                    else {
                        return;
                    };

                    messages.push(Message::Squash(SquashMessage::StartWith(Arc::clone(
                        selection,
                    ))));
                }
                MarksRef::Hunks { head, tail } => {
                    self.start_with_source(SquashSource::UncommittedHunk(NonEmpty {
                        head: head.clone(),
                        tail: tail.to_vec(),
                    }));
                }
                MarksRef::Commits { head, tail } => {
                    self.start_with_source(SquashSource::Commit(NonEmpty {
                        head: head.clone(),
                        tail: tail.to_vec(),
                    }));
                }
                MarksRef::CommittedFiles { head, tail } => {
                    self.start_with_source(SquashSource::CommittedFile(NonEmpty {
                        head: head.clone(),
                        tail: tail.to_vec(),
                    }));
                }
            },
            Mode::Details(details_mode) => match details_mode.return_mode.marks() {
                MarksRef::Empty => {
                    let Some(selection) = self.details.selected_section_cli_id() else {
                        return;
                    };
                    if details_mode.full_screen {
                        messages.push(Message::DetailsLayout(DetailsLayoutMessage::SwitchToSplit));
                    }
                    messages.extend([
                        Message::UnfocusDetails,
                        Message::Squash(SquashMessage::StartWith(Arc::clone(selection))),
                    ]);
                }
                MarksRef::Hunks { .. } => {
                    if details_mode.full_screen {
                        messages.push(Message::DetailsLayout(DetailsLayoutMessage::SwitchToSplit));
                    }
                    messages.extend([
                        Message::UnfocusDetails,
                        Message::Squash(SquashMessage::Start),
                    ]);
                }
                MarksRef::Commits { .. } | MarksRef::CommittedFiles { .. } => {}
            },
            _ => {}
        }
    }

    fn handle_squash_start_with(&mut self, source: Arc<CliId>) {
        match &*source {
            CliId::Uncommitted { .. } => {
                self.start_with_source(SquashSource::Uncommitted);
            }
            CliId::Branch { name, .. } => {
                self.start_with_source(SquashSource::Branch(BranchArg(name.clone())));
            }
            CliId::Commit {
                commit_id,
                id,
                change_id,
            } => {
                self.start_with_source(SquashSource::Commit(NonEmpty::new(MarkedCommit {
                    commit_id: *commit_id,
                    id: id.clone(),
                    change_id: change_id.clone(),
                })));
            }
            CliId::UncommittedHunkOrFile(hunk) => {
                self.start_with_source(SquashSource::UncommittedHunk(NonEmpty::new(hunk.clone())));
            }
            CliId::CommittedFile {
                commit_id,
                path,
                id,
            } => {
                self.start_with_source(SquashSource::CommittedFile(NonEmpty::new(CommittedFile {
                    commit_id: *commit_id,
                    path: path.clone(),
                    id: id.clone(),
                })));
            }
            CliId::PathPrefix { .. } | CliId::Stack { .. } => {}
        }
    }

    fn handle_squash_reverse(&mut self) {
        if !matches!(&*self.mode, Mode::Normal(..)) {
            return;
        }

        let Some(selection) = self
            .cursor
            .selected_line(&self.status_lines)
            .and_then(|line| line.data.cli_id())
        else {
            return;
        };

        if matches!(&**selection, CliId::UncommittedHunkOrFile(..)) {
            return;
        }

        self.start_with_source(SquashSource::Uncommitted);
    }

    fn start_with_source(&mut self, source: SquashSource) {
        self.mode
            .update_and_push_leave_normal_mode(&mut self.backstack, |mode| {
                *mode = Mode::Squash(SquashMode {
                    source,
                    reword: SquashReword::Infer,
                });
            });

        self.ensure_cursor_is_on_selectable_line(MoveCursorDiration::Up);
    }

    fn handle_use_target_message(&mut self) {
        let Mode::Squash(SquashMode { source, reword, .. }) = self
            .mode
            .get_mut_and_i_promise_not_to_switch_to_a_different_state()
        else {
            return;
        };
        if let Some(line) = self.cursor.selected_line(&self.status_lines)
            && let Some(target) = line.data.cli_id()
            && !source.can_target(target)
        {
            return;
        }
        *reword = match reword {
            SquashReword::Infer => SquashReword::UseTarget,
            SquashReword::UseTarget => SquashReword::Infer,
        };
    }

    fn handle_squash_confirm<T>(
        &mut self,
        ctx: &mut Context,
        terminal_guard: &mut T,
        messages: &mut Vec<Message>,
    ) -> anyhow::Result<()>
    where
        T: TerminalGuard,
        anyhow::Error: From<<T::Backend as Backend>::Error>,
    {
        let Mode::Squash(SquashMode { source, reword }) = &*self.mode else {
            return Ok(());
        };

        let Some(target) = self
            .cursor
            .selected_line(&self.status_lines)
            .and_then(|line| line.data.cli_id())
        else {
            return Ok(());
        };

        let mut guard = ctx.exclusive_worktree_access();
        let (repo, ws, _) = ctx.workspace_and_db_with_perm(guard.read_permission())?;
        let mut meta = ctx.meta()?;

        let Some(squash_op) = resolve_squash_operation(source, target, *reword, &repo, &ws, &meta)?
        else {
            return Ok(());
        };

        drop(repo);
        drop(ws);

        let _suspend_guard = squash_op
            .will_open_editor()
            .then(|| terminal_guard.suspend())
            .transpose()?;

        let outcome = squash2::run(ctx, &mut meta, guard.write_permission(), squash_op)?;

        let what_to_select = match outcome {
            SquashOutcome::Branch { new_commit, .. }
            | SquashOutcome::Commits { new_commit, .. }
            | SquashOutcome::Hunks { new_commit, .. } => SelectAfterReload::Commit(new_commit),
            SquashOutcome::Uncommit { .. } | SquashOutcome::UncommitHunk { .. } => {
                SelectAfterReload::Uncommitted
            }
        };

        drop(_suspend_guard);

        match self.flags.show_files {
            FilesStatusFlag::Commit(..) => {
                self.backstack.remove_show_file_list();
                self.flags.show_files = FilesStatusFlag::None;
            }
            FilesStatusFlag::None | FilesStatusFlag::All => {}
        }

        messages.extend([
            Message::EnterNormalModeAfterConfirmingOperation,
            Message::Reload(Some(what_to_select), ReloadCause::Mutation),
        ]);

        Ok(())
    }
}

fn resolve_squash_operation<'a>(
    source: &'a SquashSource,
    target: &'a CliId,
    reword: SquashReword,
    repo: &gix::Repository,
    ws: &Workspace,
    meta: &impl but_core::RefMetadata,
) -> anyhow::Result<Option<SquashOperation<'a>>> {
    let Some(op) = source.route(target) else {
        return Ok(None);
    };

    let reword = match reword {
        SquashReword::Infer => HowToRewordTarget::Reword(RewordCommitOperation::UseEditor),
        SquashReword::UseTarget => HowToRewordTarget::UseTargetMessage,
    };

    let resolved_args = match op {
        SquashRoute::UncommittedToCommit { target } => ResolvedSquashArgsRef::Normal {
            sources: Vec::from([ResolvedCliIdArgRef::Uncommitted]),
            target: SquashTarget::Commit {
                commit: target,
                reword: HowToRewordTarget::UseTargetMessage,
            },
        },
        SquashRoute::UncommittedToBranch { target } => {
            let source = Vec::from([ResolvedCliIdArgRef::Uncommitted]);
            let target_branch = target.to_owned();
            let target = ResolvedCliIdArgRef::Branch(&BranchArg(target_branch));
            resolve_squash_operation_with_branch(source, target, reword, repo, ws, meta)?
        }
        SquashRoute::UncommittedHunkToCommit { sources, target } => ResolvedSquashArgsRef::Normal {
            sources: sources
                .iter()
                .map(ResolvedCliIdArgRef::UncommittedHunkOrFile)
                .collect(),
            target: SquashTarget::Commit {
                commit: target,
                reword: HowToRewordTarget::UseTargetMessage,
            },
        },
        SquashRoute::CommittedFileToCommit { sources, target } => ResolvedSquashArgsRef::Normal {
            sources: sources
                .iter()
                .map(ResolvedCliIdArgRef::CommittedFile)
                .collect(),
            target: SquashTarget::Commit {
                commit: target,
                reword,
            },
        },
        SquashRoute::UncommittedHunkToBranch { sources, target } => {
            let source = sources
                .iter()
                .map(ResolvedCliIdArgRef::UncommittedHunkOrFile)
                .collect();
            let target_branch = target.to_owned();
            let target = ResolvedCliIdArgRef::Branch(&BranchArg(target_branch));
            resolve_squash_operation_with_branch(source, target, reword, repo, ws, meta)?
        }
        SquashRoute::CommitToCommit { sources, target } => ResolvedSquashArgsRef::Normal {
            sources: sources
                .iter()
                .map(|source| {
                    ResolvedCliIdArgRef::Commit(source.commit_id, source.change_id.as_ref())
                })
                .collect(),
            target: SquashTarget::Commit {
                commit: target,
                reword,
            },
        },
        SquashRoute::BranchToCommit { source, target } => {
            let source = ResolvedCliIdArgRef::Branch(source);
            let target = ResolvedCliIdArgRef::Commit(target, None);
            resolve_squash_operation_with_branch(
                Vec::from([source]),
                target,
                reword,
                repo,
                ws,
                meta,
            )?
        }
        SquashRoute::BranchToBranch { source, target } => {
            let source = ResolvedCliIdArgRef::Branch(source);
            let target_branch = target.to_owned();
            let target = ResolvedCliIdArgRef::Branch(&BranchArg(target_branch));
            resolve_squash_operation_with_branch(
                Vec::from([source]),
                target,
                reword,
                repo,
                ws,
                meta,
            )?
        }
        SquashRoute::CommitToBranch { sources, target } => {
            let sources = sources
                .iter()
                .map(|source| {
                    ResolvedCliIdArgRef::Commit(source.commit_id, source.change_id.as_ref())
                })
                .collect();
            let target_branch = target.to_owned();
            let target = ResolvedCliIdArgRef::Branch(&BranchArg(target_branch));
            resolve_squash_operation_with_branch(sources, target, reword, repo, ws, meta)?
        }
        SquashRoute::CommittedFileToBranch { sources, target } => {
            let sources = sources
                .iter()
                .map(ResolvedCliIdArgRef::CommittedFile)
                .collect();
            let target_branch = target.to_owned();
            let target = ResolvedCliIdArgRef::Branch(&BranchArg(target_branch));
            resolve_squash_operation_with_branch(sources, target, reword, repo, ws, meta)?
        }
        SquashRoute::BranchToSelf { source } => {
            ResolvedSquashArgsRef::SingleBranchSourceAndTarget {
                branch: source.clone(),
                reword,
            }
        }
        SquashRoute::CommitToUncommitted { sources } => ResolvedSquashArgsRef::Normal {
            sources: sources
                .iter()
                .map(|source| {
                    ResolvedCliIdArgRef::Commit(source.commit_id, source.change_id.as_ref())
                })
                .collect(),
            target: SquashTarget::Uncommitted,
        },
        SquashRoute::CommittedFileToUncommitted { sources } => ResolvedSquashArgsRef::Normal {
            sources: sources
                .iter()
                .map(ResolvedCliIdArgRef::CommittedFile)
                .collect(),
            target: SquashTarget::Uncommitted,
        },
    };

    let op = squash2::resolve(resolved_args, ws).into_internal_error()?;

    Ok(Some(op))
}

fn resolve_squash_operation_with_branch<'a>(
    sources: Vec<ResolvedCliIdArgRef<'a>>,
    target: ResolvedCliIdArgRef<'_>,
    reword: HowToRewordTarget,
    repo: &gix::Repository,
    ws: &Workspace,
    meta: &impl but_core::RefMetadata,
) -> anyhow::Result<ResolvedSquashArgsRef<'a>> {
    let head_info = but_workspace::head_info(
        repo,
        meta,
        but_workspace::ref_info::Options {
            project_meta: ws.graph.project_meta.clone(),
            expensive_commit_info: false,
            ..Default::default()
        },
    )?;

    let target = resolve_target(target, reword, &head_info).map_err(|err| match err {
        squash2::ResolveTargetError::Other(err) => err,
        other => {
            anyhow::anyhow!("BUG: failed to compute squash target: {other:?}")
        }
    })?;

    Ok(ResolvedSquashArgsRef::Normal { sources, target })
}
