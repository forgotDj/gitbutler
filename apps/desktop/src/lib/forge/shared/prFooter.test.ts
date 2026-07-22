import { updatePrDescriptionTables } from "$lib/forge/shared/prFooter";
import { describe, expect, test, vi } from "vitest";
import type { PrService } from "$lib/forge/prService.svelte";

function mockPrService(bodies: Record<number, string | null> = {}) {
	const fetch = vi.fn(async (_projectId: string, number: number) => ({
		number,
		body: bodies[number] ?? null,
	}));
	const updateReviewFooters = vi.fn(async () => undefined);
	const service = { fetch, updateReviewFooters } as unknown as PrService;
	return { service, fetch, updateReviewFooters };
}

describe("updatePrDescriptionTables", () => {
	test("translates desktop top-to-base ordering to Rust base-to-top ordering", async () => {
		const { service, fetch, updateReviewFooters } = mockPrService({
			100: "Base description",
			102: "Top description",
		});

		await updatePrDescriptionTables(service, "project", [102, 101, 100], "#");

		expect(fetch.mock.calls.map(([, number]) => number)).toEqual([100, 101, 102]);
		expect(updateReviewFooters).toHaveBeenCalledWith("project", [
			{ number: 100, body: "Base description", unitSymbol: "#", targetBranch: null },
			{ number: 101, body: null, unitSymbol: "#", targetBranch: null },
			{ number: 102, body: "Top description", unitSymbol: "#", targetBranch: null },
		]);
	});

	test("does not invoke Rust for a single review", async () => {
		const { service, fetch, updateReviewFooters } = mockPrService();

		await updatePrDescriptionTables(service, "project", [100]);

		expect(fetch).not.toHaveBeenCalled();
		expect(updateReviewFooters).not.toHaveBeenCalled();
	});

	test("propagates Rust synchronization failures", async () => {
		const { service, updateReviewFooters } = mockPrService();
		updateReviewFooters.mockRejectedValueOnce(new Error("forge update failed"));

		await expect(updatePrDescriptionTables(service, "project", [101, 100])).rejects.toThrow(
			"forge update failed",
		);
	});
});
