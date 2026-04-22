import { getBaseURL, type GitButler, startGitButler } from "../src/setup.ts";
import { test } from "../src/test.ts";
import { clickByTestId, dragAndDropByLocator, getByTestId, waitForTestId } from "../src/util.ts";
import { expect } from "@playwright/test";
import { writeFileSync } from "fs";

let gitbutler: GitButler;

test.use({
	baseURL: getBaseURL(),
});

test.afterEach(async () => {
	await gitbutler?.destroy();
});

test("should show commit-failed modal when amending causes a conflict", async ({
	page,
	context,
}, testInfo) => {
	const workdir = testInfo.outputPath("workdir");
	const configdir = testInfo.outputPath("config");
	gitbutler = await startGitButler(workdir, configdir, context);

	// Set up a project with a branch that has two commits modifying the same
	// line of a 20-line file. Amending the first commit with a conflicting
	// worktree change will cause a cherry-pick merge conflict when rebasing
	// the second commit on top.
	await gitbutler.runScript("project-with-conflicting-commits.sh");
	await gitbutler.runScript("apply-upstream-branch.sh", ["conflicting-branch", "local-clone"]);

	await page.goto("/");
	await waitForTestId(page, "workspace-view");

	// Should have one stack with two commits
	const stacks = getByTestId(page, "stack");
	await expect(stacks).toHaveCount(1);

	const commits = getByTestId(page, "commit-row");
	await expect(commits).toHaveCount(2);

	// Write a conflicting worktree change to a_file.
	// HEAD has "JULIET-SECOND" on line 10 (from commit 2).
	// We change it to "JULIET-WORKTREE". When this is amended into the first
	// commit, rebasing the second commit will fail because it expects
	// "JULIET-FIRST" but finds "JULIET-WORKTREE".
	const filePath = gitbutler.pathInWorkdir("local-clone/a_file");
	const newContent =
		[
			"alpha",
			"bravo",
			"charlie",
			"delta",
			"echo",
			"foxtrot",
			"golf",
			"hotel",
			"india",
			"JULIET-WORKTREE",
			"kilo",
			"lima",
			"mike",
			"november",
			"oscar",
			"papa",
			"quebec",
			"romeo",
			"sierra",
			"tango",
		].join("\n") + "\n";
	writeFileSync(filePath, newContent);

	// Wait for the uncommitted change to appear
	const fileLocator = page
		.getByTestId("uncommitted-changes-file-list")
		.getByTestId("file-list-item")
		.filter({ hasText: "a_file" });
	await expect(fileLocator).toBeVisible({ timeout: 5000 });

	// Drag the uncommitted file onto the FIRST commit (bottom one).
	// "Change juliet to JULIET-FIRST" is the first commit.
	const firstCommit = getByTestId(page, "commit-row").filter({
		hasText: "Change juliet to JULIET-FIRST",
	});
	await expect(firstCommit).toBeVisible();

	await dragAndDropByLocator(page, fileLocator, firstCommit);

	// The commit-failed modal should appear because rebasing the second commit
	// on top of the amended first commit causes a cherry-pick merge conflict.
	const modal = getByTestId(page, "global-modal-commit-failed");
	await expect(modal).toBeVisible({ timeout: 10000 });

	// The modal should indicate that some changes were not committed
	await expect(modal).toContainText(/changes were not committed|Failed to create commit/);

	// Close the modal
	await clickByTestId(page, "global-modal-action-button");
	await expect(modal).not.toBeVisible();
});

test("should squash commits via drag-and-drop without errors", async ({
	page,
	context,
}, testInfo) => {
	const workdir = testInfo.outputPath("workdir");
	const configdir = testInfo.outputPath("config");
	gitbutler = await startGitButler(workdir, configdir, context);

	// project-with-stacks creates branch1 with 4 commits
	await gitbutler.runScript("project-with-stacks.sh");
	await gitbutler.runScript("apply-upstream-branch.sh", ["branch1", "local-clone"]);

	await page.goto("/");
	await waitForTestId(page, "workspace-view");

	// Should have 4 commits in one stack
	const commits = getByTestId(page, "commit-row");
	await expect(commits).toHaveCount(4);

	// Drag the top commit onto the second commit to squash them
	const topCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: fourth commit",
	});
	const secondCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: third commit",
	});
	await expect(topCommit).toBeVisible();
	await expect(secondCommit).toBeVisible();

	await dragAndDropByLocator(page, topCommit, secondCommit);

	// After squashing, the branch should show an upstream divergence section
	// because local history changed. The upstream action row confirms
	// the squash was successful.
	const upstreamSection = getByTestId(page, "upstream-commits-commit-action");
	await expect(upstreamSection).toBeVisible({ timeout: 15_000 });

	// The first commit should still be present (it was not part of the squash)
	const remainingFirst = getByTestId(page, "commit-row").filter({
		hasText: "branch1: first commit",
	});
	await expect(remainingFirst).toBeVisible();

	// No error modal should appear
	const modal = getByTestId(page, "global-modal-commit-failed");
	await expect(modal).not.toBeVisible();
});
