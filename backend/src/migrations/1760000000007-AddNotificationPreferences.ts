import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddNotificationPreferences1760000000007
 *
 * Persists participant notification preferences (#1327).
 *
 * The `NotificationPreference` entity and its service landed with #1307, but no
 * migration ever created the table: reads silently degraded to "no rows saved"
 * and every write failed on a missing relation, so opting out was impossible
 * beyond the lifetime of a request.
 *
 * The unique index is load-bearing rather than decorative. The service saves
 * with `upsert(..., ["wallet", "category"])`, which compiles to
 * `ON CONFLICT ("wallet", "category")`; Postgres rejects that target unless a
 * unique index covers exactly those columns, so a plain index would make every
 * preference save raise
 * "there is no unique or exclusion constraint matching the ON CONFLICT specification".
 */
export class AddNotificationPreferences1760000000007
  implements MigrationInterface
{
  name = "AddNotificationPreferences1760000000007";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Deliberately a separate type from `notification_category_enum`: the two
    // vocabularies differ (delivery groups "project"/"participant", preferences
    // group "project_activity"/"participant_activity"), and sharing one enum
    // would let a preference be written for a category that is never delivered.
    await queryRunner.query(`
      CREATE TYPE "notification_preference_category_enum" AS ENUM (
        'security', 'payment', 'project_activity', 'participant_activity', 'marketing'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "notification_preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "wallet" character varying(128) NOT NULL,
        "category" "notification_preference_category_enum" NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_preferences" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_notification_preferences_wallet_category"
        ON "notification_preferences" ("wallet", "category")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notification_preferences_wallet"
        ON "notification_preferences" ("wallet")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notification_preferences_wallet"`);
    await queryRunner.query(
      `DROP INDEX "UQ_notification_preferences_wallet_category"`,
    );
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
    await queryRunner.query(
      `DROP TYPE "notification_preference_category_enum"`,
    );
  }
}
