import { resetSentry, setSentryUser } from "$lib/analytics/sentry";
import { showError } from "$lib/error/showError";
import { type UiState } from "$lib/state/uiState.svelte";
import { InjectionToken } from "@gitbutler/core/context";
import { type HttpClient } from "@gitbutler/shared/network/httpClient";
import { chipToasts } from "@gitbutler/ui";
import { derived, writable, type Readable } from "svelte/store";
import type { IBackend } from "$lib/backend";
import type { PostHogWrapper } from "$lib/telemetry/posthog";
import type { TokenMemoryService } from "$lib/user/tokenMemoryService";
import type { User } from "$lib/user/user";
import type { ApiUser } from "@gitbutler/shared/users/types";

export type LoginToken = {
	/** Used for polling the user; should NEVER be sent to the browser. */
	token: string;
	browser_token: string;
	expires: string;
	url: string;
};

export const USER_SERVICE = new InjectionToken<UserService>("UserService");

export class UserService {
	readonly loading = writable(false);

	readonly user = writable<User | undefined>(undefined, () => {
		this.refresh();
	});
	readonly userLogin = derived<Readable<User | undefined>, string | undefined>(
		this.user,
		(user, set) => {
			set(user?.login ?? undefined);
		},
	);
	readonly error = writable();
	readonly incomingUserLogin = writable<User | undefined>(undefined);

	async refresh() {
		const user = await this.backend.invoke<User | undefined>("get_user");
		if (user) {
			this.tokenMemoryService.setToken(user.access_token);
			// Telemetry is alreary set when the user is set.
			// Just in case the user ID changes in the backend outside the usual cycle, we set it again here.
			await this.setUserTelemetry(user);
			this.user.set(user);
			return user;
		}

		this.posthog.setAnonymousPostHogUser();
		this.user.set(undefined);
	}

	constructor(
		private backend: IBackend,
		private httpClient: HttpClient,
		private tokenMemoryService: TokenMemoryService,
		private posthog: PostHogWrapper,
		private uiState: UiState,
	) {}

	async setUser(user: User | undefined) {
		if (user) {
			await this.backend.invoke("set_user", { user });
			this.tokenMemoryService.setToken(user.access_token);
			await this.setUserTelemetry(user);
		} else {
			await this.clearUser();
		}
		this.user.set(user);
	}

	private async clearUser() {
		await this.backend.invoke("delete_user");
	}

	private async setUserTelemetry(user: User) {
		await this.posthog.setPostHogUser({ id: user.id, email: user.email, name: user.name });
		setSentryUser(user);
	}

	async setUserAccessToken(token: string, bypassConfirmationToast = false) {
		try {
			const currentUser = await this.refresh();
			if (currentUser) {
				// Error out if we're trying to set a token when we've already logged in.
				showError(
					"Error: Attempting to log in before logging out first",
					"There's already an account logged in, please log out before attempting to log in to another account.",
				);
				return;
			}

			const user = await this.backend.invoke<User>("login_with_token", { token });

			if (bypassConfirmationToast) {
				// In the case that the token is e.g. pasted directly, we don't need a confirmation toast.
				await this.setUser(user);
				return;
			}

			this.incomingUserLogin.set(user);
			// Display a login confirmation modal
			this.uiState.global.modal.set({
				type: "login-confirmation",
			});
		} catch (error) {
			console.error("Error setting user access token", error);
			showError("Error occurred while logging in", error);
		}
	}

	async acceptIncomingUser(incomingUser: User) {
		if (!incomingUser) {
			throw new Error("No incoming user to accept");
		}
		await this.setUser(incomingUser);
		this.incomingUserLogin.set(undefined);
	}

	async rejectIncomingUser() {
		this.incomingUserLogin.set(undefined);
	}

	async forgetUserCredentials() {
		await this.clearUser();
		this.user.set(undefined);
		this.tokenMemoryService.setToken(undefined);
		await this.posthog.resetPostHog();
		resetSentry();
	}

	private async getLoginUrl(): Promise<string> {
		await this.forgetUserCredentials();
		try {
			const token = await this.backend.invoke<LoginToken>("get_login_token");
			const url = new URL(token.url);
			url.host = this.httpClient.apiUrl.host;
			const buildType = await this.backend.invoke<string>("build_type").catch(() => undefined);
			if (buildType !== undefined && buildType !== "development")
				url.searchParams.set("bt", buildType);

			return url.toString();
		} catch (err) {
			console.error(err);
			showError("Error occurred while fetching the login URL", err);
			throw err;
		}
	}

	async openLoginPage(): Promise<void> {
		const url = await this.getLoginUrl();
		await this.backend.openExternalUrl(url);
	}

	async copyLoginPageLink(): Promise<void> {
		const url = await this.getLoginUrl();
		await this.backend
			.writeTextToClipboard(url)
			.then(() => {
				chipToasts.success("Login URL copied to clipboard");
			})
			.catch((err) => {
				showError("Error copying login URL to clipboard", err);
				throw err;
			});
	}

	async getUser(): Promise<ApiUser> {
		return await this.backend.invoke<ApiUser>("get_user_profile");
	}

	async updateUser(params: {
		name?: string;
		picture?: File;
		website?: string;
		twitter?: string;
		bluesky?: string;
		timezone?: string;
		location?: string;
		emailShare?: boolean;
	}): Promise<any> {
		let avatarBase64: string | undefined;
		let avatarFilename: string | undefined;
		if (params.picture) {
			const bytes = new Uint8Array(await params.picture.arrayBuffer());
			const chunks: string[] = [];
			for (let i = 0; i < bytes.length; i += 0x8000) {
				chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
			}
			avatarBase64 = btoa(chunks.join(""));
			avatarFilename = params.picture.name;
		}

		return await this.backend.invoke("update_user_profile", {
			params: {
				name: params.name,
				website: params.website,
				twitter: params.twitter,
				bluesky: params.bluesky,
				timezone: params.timezone,
				location: params.location,
				email_share: params.emailShare,
				avatar_base64: avatarBase64,
				avatar_filename: avatarFilename,
			},
		});
	}
}
