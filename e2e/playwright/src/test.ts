import { test as base } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const FLAT_RESULTS_DIR = path.resolve(import.meta.dirname, "../test-results-flat");

/**
 * Sanitize a string for use as a filename.
 */
function sanitizeFilename(name: string): string {
	return name
		.replace(/[^a-zA-Z0-9_-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * Extended test fixture that, on failure, writes console logs and video
 * to a flat directory with filenames derived from the test title.
 *
 * Output: e2e/playwright/test-results-flat/
 *   <suite>--<test-name>.log
 *   <suite>--<test-name>.webm
 */
export const test = base.extend<{ _autoArtifacts: void }>({
	_autoArtifacts: [
		async ({ page }, use, testInfo) => {
			const logs: string[] = [];

			page.on("console", (msg) => {
				const type = msg.type().toUpperCase().padEnd(7);
				logs.push(`[${type}] ${msg.text()}`);
			});

			page.on("pageerror", (err) => {
				logs.push(`[ERROR  ] ${err.message}`);
			});

			await use();

			if (testInfo.status !== testInfo.expectedStatus) {
				const titlePath = testInfo.titlePath.slice(1);
				const baseName = sanitizeFilename(titlePath.join("--"));
				const retry = testInfo.retry > 0 ? `-retry${testInfo.retry}` : "";
				const prefix = `${baseName}${retry}`;

				fs.mkdirSync(FLAT_RESULTS_DIR, { recursive: true });

				if (logs.length > 0) {
					fs.writeFileSync(path.join(FLAT_RESULTS_DIR, `${prefix}.log`), logs.join("\n"));
				}

				const video = page.video();
				if (video) {
					await video.saveAs(path.join(FLAT_RESULTS_DIR, `${prefix}.webm`));
				}
			}
		},
		{ auto: true },
	],
});
