import { getBaseURL, type GitButler, startGitButler } from "../src/setup.ts";
import { test } from "../src/test.ts";
import { getByTestId, waitForElementToStabilize, waitForTestId } from "../src/util.ts";
import { expect, type Page } from "@playwright/test";

let gitbutler: GitButler;

test.use({
	baseURL: getBaseURL(),
});

test.afterEach(async () => {
	await gitbutler?.destroy();
});

/**
 * Set up a workspace with branch1 applied (4 commits from project-with-stacks).
 */
async function setupWorkspaceWithCommits(page: Page, context: any, testInfo: any) {
	const workdir = testInfo.outputPath("workdir");
	const configdir = testInfo.outputPath("config");
	gitbutler = await startGitButler(workdir, configdir, context);

	await gitbutler.runScript("project-with-stacks.sh");
	await gitbutler.runScript("apply-upstream-branch.sh", ["branch1", "local-clone"]);

	await page.goto("/");
	await waitForTestId(page, "workspace-view");

	// Verify we have our expected commits
	const commits = getByTestId(page, "commit-row");
	await expect(commits).toHaveCount(4);
}

/**
 * Get the modifier key for multi-select (Meta on macOS, Control elsewhere).
 */
function getModifierKey(): "Meta" | "Control" {
	return process.platform === "darwin" ? "Meta" : "Control";
}

test("should select multiple commits with Cmd/Ctrl+Click", async ({ page, context }, testInfo) => {
	await setupWorkspaceWithCommits(page, context, testInfo);

	const firstCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: first commit",
	});
	const thirdCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: third commit",
	});

	// Click the first commit to select it
	await firstCommit.click();

	// Verify the commit drawer opens for the first commit
	const drawer = getByTestId(page, "commit-drawer");
	await expect(drawer).toBeVisible();

	// Cmd/Ctrl+Click the third commit to add it to selection
	const modKey = getModifierKey();
	await thirdCommit.click({ modifiers: [modKey] });

	// Both commits should have the selected visual state
	await expect(firstCommit).toHaveClass(/\bselected\b/);
	await expect(thirdCommit).toHaveClass(/\bselected\b/);

	// The second commit should NOT be selected
	const secondCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: second commit",
	});
	await expect(secondCommit).not.toHaveClass(/\bselected\b/);
});

test("should select a range of commits with Shift+Click", async ({ page, context }, testInfo) => {
	await setupWorkspaceWithCommits(page, context, testInfo);

	const firstCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: first commit",
	});
	const fourthCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: fourth commit",
	});

	// Click the fourth commit (top of list) to select it
	await fourthCommit.click();

	// Shift+Click the first commit to select the range
	await firstCommit.click({ modifiers: ["Shift"] });

	// All four commits should be selected
	const allCommits = getByTestId(page, "commit-row");
	const count = await allCommits.count();
	for (let i = 0; i < count; i++) {
		await expect(allCommits.nth(i)).toHaveClass(/\bselected\b/);
	}
});

test("should toggle individual commits with Cmd/Ctrl+Click", async ({
	page,
	context,
}, testInfo) => {
	await setupWorkspaceWithCommits(page, context, testInfo);

	const firstCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: first commit",
	});
	const secondCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: second commit",
	});

	const modKey = getModifierKey();

	// Click to select first commit
	await firstCommit.click();
	await expect(firstCommit).toHaveClass(/\bselected\b/);

	// Cmd/Ctrl+Click to add second commit
	await secondCommit.click({ modifiers: [modKey] });
	await expect(firstCommit).toHaveClass(/\bselected\b/);
	await expect(secondCommit).toHaveClass(/\bselected\b/);

	// Cmd/Ctrl+Click first commit again to deselect it
	await firstCommit.click({ modifiers: [modKey] });
	await expect(firstCommit).not.toHaveClass(/\bselected\b/);
	await expect(secondCommit).toHaveClass(/\bselected\b/);
});

test("should show multi-select context menu with squash and uncommit", async ({
	page,
	context,
}, testInfo) => {
	await setupWorkspaceWithCommits(page, context, testInfo);

	const firstCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: first commit",
	});
	const secondCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: second commit",
	});

	const modKey = getModifierKey();

	// Select two commits
	await firstCommit.click();
	await secondCommit.click({ modifiers: [modKey] });

	// Right-click a selected commit row to open the multi-select context menu
	await firstCommit.click({ button: "right" });

	// Wait for context menu to stabilize
	const squashItem = await waitForTestId(page, "commit-row-context-menu-squash-selected");
	await waitForElementToStabilize(page, squashItem);

	// Verify multi-select menu items are visible
	await expect(squashItem).toBeVisible();
	await expect(squashItem).toContainText("Squash 2 commits");

	const uncommitItem = getByTestId(page, "commit-row-context-menu-uncommit-selected");
	await expect(uncommitItem).toBeVisible();
	await expect(uncommitItem).toContainText("Uncommit 2 commits");

	// Single-commit items should NOT be visible
	const editMessageBtn = page.getByTestId("commit-row-context-menu-edit-message-menu-btn");
	await expect(editMessageBtn).toHaveCount(0);

	const editCommitBtn = page.getByTestId("commit-row-context-menu-edit-commit");
	await expect(editCommitBtn).toHaveCount(0);
});

test("should collapse changed files when multiple commits are selected", async ({
	page,
	context,
}, testInfo) => {
	await setupWorkspaceWithCommits(page, context, testInfo);

	const firstCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: first commit",
	});
	const secondCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: second commit",
	});

	// Click first commit — changed files should be visible
	await firstCommit.click();

	// Verify changed files are shown for the selected commit
	const changedFilesContainer = page.locator(".changed-files-container");
	await expect(changedFilesContainer).toBeVisible();

	// Now Cmd/Ctrl+Click to add second commit
	const modKey = getModifierKey();
	await secondCommit.click({ modifiers: [modKey] });

	// Changed files container should no longer be visible
	await expect(changedFilesContainer).not.toBeVisible();
});

test("should squash 3 selected commits via context menu", async ({ page, context }, testInfo) => {
	test.setTimeout(120_000);
	await setupWorkspaceWithCommits(page, context, testInfo);

	const secondCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: second commit",
	});
	const thirdCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: third commit",
	});
	const fourthCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: fourth commit",
	});

	const modKey = getModifierKey();

	// Select three commits
	await secondCommit.click();
	await thirdCommit.click({ modifiers: [modKey] });
	await fourthCommit.click({ modifiers: [modKey] });

	// Right-click a selected commit row to open the multi-select context menu
	await secondCommit.click({ button: "right" });

	const squashItem = await waitForTestId(page, "commit-row-context-menu-squash-selected");
	await waitForElementToStabilize(page, squashItem);
	await expect(squashItem).toContainText("Squash 3 commits");
	await squashItem.click();

	// After squashing, the branch should show an upstream divergence section
	// because local history changed. The "Upstream has new commits" indicator confirms
	// the squash was successful.
	const upstreamSection = page.locator("text=Upstream has new commits");
	await expect(upstreamSection).toBeVisible();

	// The first commit should still be present (it was not part of the squash)
	const remainingFirst = getByTestId(page, "commit-row").filter({
		hasText: "branch1: first commit",
	});
	await expect(remainingFirst).toBeVisible();
});

test("should uncommit 3 selected commits via context menu", async ({ page, context }, testInfo) => {
	test.setTimeout(120_000);
	await setupWorkspaceWithCommits(page, context, testInfo);

	const secondCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: second commit",
	});
	const thirdCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: third commit",
	});
	const fourthCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: fourth commit",
	});

	const modKey = getModifierKey();

	// Select the top three commits
	await fourthCommit.click();
	await thirdCommit.click({ modifiers: [modKey] });
	await secondCommit.click({ modifiers: [modKey] });

	// Right-click a selected commit row to open the multi-select context menu
	await fourthCommit.click({ button: "right" });

	const uncommitItem = await waitForTestId(page, "commit-row-context-menu-uncommit-selected");
	await waitForElementToStabilize(page, uncommitItem);
	await expect(uncommitItem).toContainText("Uncommit 3 commits");
	await uncommitItem.click();

	// After uncommitting, the uncommitted changes should contain the files
	const uncommittedHeader = getByTestId(page, "uncommitted-changes-header");
	await expect(uncommittedHeader).toBeVisible();

	// The first commit should still exist (it was not selected)
	const remainingFirst = getByTestId(page, "commit-row").filter({
		hasText: "branch1: first commit",
	});
	await expect(remainingFirst).toBeVisible();
});

test("should deselect all when clicking a commit without modifier", async ({
	page,
	context,
}, testInfo) => {
	await setupWorkspaceWithCommits(page, context, testInfo);

	const firstCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: first commit",
	});
	const secondCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: second commit",
	});
	const thirdCommit = getByTestId(page, "commit-row").filter({
		hasText: "branch1: third commit",
	});

	const modKey = getModifierKey();

	// Select multiple commits
	await firstCommit.click();
	await secondCommit.click({ modifiers: [modKey] });
	await expect(firstCommit).toHaveClass(/\bselected\b/);
	await expect(secondCommit).toHaveClass(/\bselected\b/);

	// Plain click on third commit should deselect everything and select only third
	await thirdCommit.click();
	await expect(thirdCommit).toHaveClass(/\bselected\b/);
	await expect(firstCommit).not.toHaveClass(/\bselected\b/);
	await expect(secondCommit).not.toHaveClass(/\bselected\b/);
});
