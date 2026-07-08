import {
	branchHeader,
	createDependentBranch,
	expectCurrentBranchChip,
	setupSingleBranchProject,
	SINGLE_BRANCH_NAME,
} from "./helpers.ts";
import { assertBranch } from "../../src/branch.ts";
import { test } from "../../src/test.ts";
import { dragAndDropByLocator, getByTestId } from "../../src/util.ts";
import { expect, type Page } from "@playwright/test";

test.use({
	gitbutlerOptions: {
		config: {
			onboardingComplete: true,
			featureFlags: { singleBranch: true },
		},
	},
});

test("can reorder empty branches by dragging within the single-branch stack", async ({
	page,
	gitbutler,
}) => {
	const localClone = await setupSingleBranchProject(gitbutler, page);

	// Build a stack of empty branches. Each `createDependentBranch` is created above the current tip
	// and checked out, so `empty-top` ends up as the checked-out entrypoint with two empty branches
	// (`empty-mid`, `empty-low`) below it, sitting on the commit-owning `single-branch-fixture` base.
	await createDependentBranch(page, "empty-low");
	await createDependentBranch(page, "empty-mid");
	await createDependentBranch(page, "empty-top");

	await expect(getByTestId(page, "branch-card")).toHaveCount(4);
	await expectCurrentBranchChip(page, "empty-top");
	await expectBranchHeaderOrder(page, ["empty-top", "empty-mid", "empty-low", SINGLE_BRANCH_NAME]);

	// Drag `empty-low` onto the insertion dropzone above `empty-mid` to put it on top of `empty-mid`.
	// Both branches are empty and below the entrypoint, so the whole stack stays projected and the
	// move is a pure `branch_order` metadata reorder.
	//
	await dragAndDropByLocator(
		page,
		branchHeader(page, "empty-low"),
		branchHeader(page, "empty-mid"),
		{ force: true, position: { x: 120, y: 0 } },
	);

	// `empty-low` now sits above `empty-mid`; the entrypoint and base are unchanged.
	await expectBranchHeaderOrder(page, ["empty-top", "empty-low", "empty-mid", SINGLE_BRANCH_NAME]);
	await expectCurrentBranchChip(page, "empty-top");
	await assertBranch("empty-top", localClone);
});

async function expectBranchHeaderOrder(page: Page, expectedBranchNames: string[]): Promise<void> {
	await expect
		.poll(
			async () =>
				await page
					.locator('[data-testid="branch-header"]')
					.evaluateAll((headers) =>
						headers.map((header) => header.getAttribute("data-testid-branch-header")),
					),
			{
				message: `Expected branch header order ${JSON.stringify(expectedBranchNames)}`,
				intervals: [100, 200, 500, 1000],
			},
		)
		.toEqual(expectedBranchNames);
}
