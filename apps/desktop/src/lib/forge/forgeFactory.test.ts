import { DefaultForgeFactory } from "$lib/forge/forgeFactory.svelte";
import { GitHub } from "$lib/forge/github/github";
import { GitLab } from "$lib/forge/gitlab/gitlab";
import { type AppDispatch, type GitHubApi, type GitLabApi } from "$lib/state/clientState.svelte";
import { EventContext } from "$lib/telemetry/eventContext";
import { PostHogWrapper } from "$lib/telemetry/posthog";
import { mockCreateBackend } from "$lib/testing/mockBackend";
import { getSettingsdServiceMock } from "$lib/testing/mockSettingsdService";
import { expect, test, describe, vi } from "vitest";
import type { GitHubClient } from "$lib/forge/github/githubClient";
import type { GitLabClient } from "$lib/forge/gitlab/gitlabClient.svelte";
import type { BackendApi } from "$lib/state/backendApi";

describe.concurrent("DefaultforgeFactory", () => {
	const MockSettingsService = getSettingsdServiceMock();
	const backend = mockCreateBackend();
	const settingsService = new MockSettingsService();
	const eventContext = new EventContext();
	const posthog = new PostHogWrapper(settingsService, backend, eventContext);
	const gitHubApi = {
		endpoints: {},
		reducerPath: "github",
		injectEndpoints: vi.fn(),
	} as unknown as GitHubApi;
	const MockBackendApi = vi.fn();
	MockBackendApi.prototype.injectEndpoints = vi.fn();
	const backendApi: BackendApi = new MockBackendApi();
	const gitHubClient = { onReset: () => {} } as unknown as GitHubClient;
	const gitLabClient = { onReset: () => {} } as unknown as GitLabClient;

	// TODO: Replace with a better mock.
	const dispatch = (() => {}) as AppDispatch;
	const gitLabApi = {
		injectEndpoints: vi.fn(),
	} as unknown as GitLabApi;

	test("Create GitHub service", async () => {
		const factory = new DefaultForgeFactory({
			gitHubClient,
			gitHubApi,
			backendApi,
			gitLabClient,
			gitLabApi,
			posthog,
			dispatch,
		});
		expect(
			factory.build({
				repo: {
					domain: "github.com",
					name: "test-repo",
					owner: "test-owner",
				},
				baseBranch: "some-base",
				forgeType: "github",
			}),
		).instanceOf(GitHub);
	});

	test("Create GitLab service", async () => {
		const factory = new DefaultForgeFactory({
			gitHubClient,
			gitHubApi,
			backendApi,
			gitLabClient,
			gitLabApi,
			posthog,
			dispatch,
		});
		expect(
			factory.build({
				repo: {
					domain: "gitlab.com",
					name: "test-repo",
					owner: "test-owner",
				},
				baseBranch: "some-base",
				forgeType: "gitlab",
			}),
		).instanceOf(GitLab);
	});

	test("setConfig uses detectedForgeProvider when present", async () => {
		const factory = new DefaultForgeFactory({
			gitHubClient,
			gitHubApi,
			backendApi,
			gitLabClient,
			gitLabApi,
			posthog,
			dispatch,
		});
		factory.setConfig({
			repo: { domain: "github.example.net", name: "test-repo", owner: "test-owner" },
			baseBranch: "main",
			detectedForgeProvider: "github",
			forgeOverride: undefined,
		});
		expect(factory.current).instanceOf(GitHub);
		expect(factory.determinedForgeType).toBe("github");
	});

	test("setConfig falls back to detectedForgeProvider when forgeOverride is absent", async () => {
		const factory = new DefaultForgeFactory({
			gitHubClient,
			gitHubApi,
			backendApi,
			gitLabClient,
			gitLabApi,
			posthog,
			dispatch,
		});
		factory.setConfig({
			repo: { domain: "github.example.net", name: "test-repo", owner: "test-owner" },
			baseBranch: "main",
			detectedForgeProvider: "github",
			forgeOverride: undefined,
		});
		expect(factory.current).instanceOf(GitHub);
		expect(factory.determinedForgeType).toBe("github");
	});

	test("setConfig resolves to default when both detectedForgeProvider and forgeOverride are absent", async () => {
		const factory = new DefaultForgeFactory({
			gitHubClient,
			gitHubApi,
			backendApi,
			gitLabClient,
			gitLabApi,
			posthog,
			dispatch,
		});
		factory.setConfig({
			repo: { domain: "custom.example.com", name: "test-repo", owner: "test-owner" },
			baseBranch: "main",
			detectedForgeProvider: undefined,
			forgeOverride: undefined,
		});
		expect(factory.determinedForgeType).toBe("default");
	});

	test("forgeOverride takes precedence over detectedForgeProvider", async () => {
		const factory = new DefaultForgeFactory({
			gitHubClient,
			gitHubApi,
			backendApi,
			gitLabClient,
			gitLabApi,
			posthog,
			dispatch,
		});
		factory.setConfig({
			repo: { domain: "github.com", name: "test-repo", owner: "test-owner" },
			baseBranch: "main",
			detectedForgeProvider: "github",
			forgeOverride: "gitlab",
		});
		expect(factory.current).instanceOf(GitLab);
		expect(factory.determinedForgeType).toBe("gitlab");
	});
});
