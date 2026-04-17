/**
 * This file contains functions for managing ui-specific feature flags.
 * The values are persisted in local storage. Entries are prefixed with 'feature'.
 *
 * @module appSettings
 */
import {
	getBooleanStorageItem,
	persisted,
	persistWithExpiration,
	setBooleanStorageItem,
} from "@gitbutler/shared/persisted";

const USE_NEW_REBASE_ENGINE_KEY = "feature-use-new-rebase-engine";
const USE_NEW_REBASE_ENGINE_MIGRATION_KEY = "feature-use-new-rebase-engine-default-true-migrated";

export const autoSelectBranchNameFeature = persisted(false, "autoSelectBranchLaneContentsFeature");
export const autoSelectBranchCreationFeature = persisted(false, "autoSelectBranchCreationFeature");

export const rewrapCommitMessage = persistWithExpiration(true, "rewrap-commit-msg", 1440 * 30);
export type StagingBehavior = "all" | "selection" | "none";
export const stagingBehaviorFeature = persisted<StagingBehavior>("all", "feature-staging-behavior");
export const fModeEnabled = persisted(true, "f-mode");
export const newlineOnEnter = persisted(false, "feature-newline-on-enter");
export const useNewRebaseEngine = persisted(false, USE_NEW_REBASE_ENGINE_KEY);

/**
 * Migrate users into the new rebase engine once.
 * This can always be reversed, and that decision will be respected
 */
export function migrateUseNewRebaseEngineDefaultToTrue(): void {
	// Skip if migrated already.
	if (getBooleanStorageItem(USE_NEW_REBASE_ENGINE_MIGRATION_KEY) === true) {
		return;
	}

	// Migrate only if they haven't yet enabled it.
	if (getBooleanStorageItem(USE_NEW_REBASE_ENGINE_KEY) !== true) {
		useNewRebaseEngine.set(true);
	}

	// Mark as migrated.
	setBooleanStorageItem(USE_NEW_REBASE_ENGINE_MIGRATION_KEY, true);
}
