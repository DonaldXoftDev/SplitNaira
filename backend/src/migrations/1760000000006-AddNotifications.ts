import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddNotifications1760000000006
 *
 * Persistent notification store (#1308) with database-enforced deduplication
 * (#1309).
 */
export class AddNotifications1760000000006 implements MigrationInterface {
  name = "AddNotifications1760000000006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "notification_category_enum" AS ENUM (
        'security', 'payment', 'project', 'participant', 'system'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recipient" character varying(128) NOT NULL,
        "category" "notification_category_enum" NOT NULL,
        "title" character varying(200) NOT NULL,
        "body" character varying(1000) NOT NULL,
        "eventKey" character varying(200) NOT NULL,
        "source" character varying(64) NOT NULL,
        "resourceType" character varying(128),
        "resourceId" character varying(128),
        "metadata" jsonb,
        "readAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id")
      )
    `);

    /*
     * Deduplication is enforced here, not in application code. A
     * read-then-insert check loses under concurrency: two workers handling the
     * same replayed event both see "not present" and both insert. The unique
     * index makes the second one fail deterministically, which the service
     * then treats as "already delivered".
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_notifications_recipient_event_key"
        ON "notifications" ("recipient", "eventKey")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_created"
        ON "notifications" ("recipient", "createdAt" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_read"
        ON "notifications" ("recipient", "readAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notifications_recipient_read"`);
    await queryRunner.query(`DROP INDEX "IDX_notifications_recipient_created"`);
    await queryRunner.query(`DROP INDEX "IDX_notifications_recipient_event_key"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "notification_category_enum"`);
  }
}
