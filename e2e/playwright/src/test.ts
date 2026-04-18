import { test as base } from "@playwright/test";

/**
 * Extended test fixture that automatically captures browser console output
 * and attaches it as a plain-text file when a test fails.
 */
export const test = base.extend<{ _autoConsoleCapture: void }>({
	_autoConsoleCapture: [
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

			if (logs.length > 0 && testInfo.status !== "passed") {
				await testInfo.attach("console-log", {
					body: logs.join("\n"),
					contentType: "text/plain",
				});
			}
		},
		{ auto: true },
	],
});
