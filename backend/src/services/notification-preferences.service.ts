import {
  NotificationPreference,
  PREFERENCE_CATEGORIES,
  isMandatoryCategory,
  type PreferenceCategory,
} from "../entities/NotificationPreference.js";
import { getDataSource } from "./database.js";

export interface ResolvedPreference {
  category: PreferenceCategory;
  enabled: boolean;
  /** True when the category cannot be switched off. */
  mandatory: boolean;
}

/**
 * Returns the full preference set for a wallet (#1307).
 *
 * Every category is returned, not just the stored rows. A category the user
 * has never touched defaults to enabled — absence of a row must not read as
 * "opted out", or adding a category later would silently mute it for
 * everyone who already has preferences saved.
 *
 * Mandatory categories always report `enabled: true` regardless of what is
 * stored, so a stale row written before a category became mandatory cannot
 * suppress a security or payment notice.
 */
export async function getPreferences(
  wallet: string,
): Promise<ResolvedPreference[]> {
  const normalised = wallet.trim();
  if (!normalised) throw new Error("wallet is required");

  const rows = await getDataSource()
    .getRepository(NotificationPreference)
    .find({ where: { wallet: normalised } });

  const stored = new Map(rows.map((row) => [row.category, row.enabled]));

  return PREFERENCE_CATEGORIES.map((category) => {
    const mandatory = isMandatoryCategory(category);
    return {
      category,
      mandatory,
      enabled: mandatory ? true : (stored.get(category) ?? true),
    };
  });
}

export class MandatoryCategoryError extends Error {
  constructor(public readonly category: PreferenceCategory) {
    super(
      `The "${category}" category is mandatory and cannot be disabled. ` +
        `Security and payment notices carry financial or account-safety consequences.`,
    );
    this.name = "MandatoryCategoryError";
  }
}

/**
 * Updates preferences for a wallet.
 *
 * Rejects any attempt to disable a mandatory category rather than silently
 * ignoring it: a UI that thinks it switched something off, and a backend that
 * quietly kept sending, is worse than a clear refusal.
 *
 * Writes are upserts on `(wallet, category)` so repeated saves converge
 * rather than accumulating contradictory rows.
 */
export async function updatePreferences(
  wallet: string,
  updates: Array<{ category: PreferenceCategory; enabled: boolean }>,
): Promise<ResolvedPreference[]> {
  const normalised = wallet.trim();
  if (!normalised) throw new Error("wallet is required");

  for (const update of updates) {
    if (!update.enabled && isMandatoryCategory(update.category)) {
      throw new MandatoryCategoryError(update.category);
    }
  }

  const repository = getDataSource().getRepository(NotificationPreference);

  for (const update of updates) {
    await repository.upsert(
      {
        wallet: normalised,
        category: update.category,
        enabled: update.enabled,
        updatedAt: new Date(),
      },
      ["wallet", "category"],
    );
  }

  return getPreferences(normalised);
}

/**
 * Whether a notification in this category should be delivered.
 *
 * The single place delivery consults preferences, so a mandatory category
 * cannot be missed by a caller that forgets the rule.
 */
export async function shouldDeliver(
  wallet: string,
  category: PreferenceCategory,
): Promise<boolean> {
  if (isMandatoryCategory(category)) return true;
  const preferences = await getPreferences(wallet);
  return preferences.find((p) => p.category === category)?.enabled ?? true;
}
