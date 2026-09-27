import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Notification categories (#1308).
 *
 * The split matters for preferences (#1307): `security` and `payment` carry
 * financial or account-safety consequences and stay mandatory, while the rest
 * may be opted out of.
 */
export const NOTIFICATION_CATEGORIES = [
  "security",
  "payment",
  "project",
  "participant",
  "system",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Categories a user is never allowed to silence. */
export const MANDATORY_CATEGORIES: readonly NotificationCategory[] = [
  "security",
  "payment",
];

export function isMandatoryCategory(category: NotificationCategory): boolean {
  return MANDATORY_CATEGORIES.includes(category);
}

@Entity("notifications")
// Listing is always "this recipient, newest first" — the composite serves the
// query and the keyset pagination cursor together.
@Index("IDX_notifications_recipient_created", ["recipient", "createdAt"])
@Index("IDX_notifications_recipient_read", ["recipient", "readAt"])
export class Notification {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Stellar address the notification belongs to. */
  @Column({ type: "varchar", length: 128 })
  recipient!: string;

  @Column({ type: "enum", enum: NOTIFICATION_CATEGORIES })
  category!: NotificationCategory;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "varchar", length: 1000 })
  body!: string;

  /**
   * Stable identity of the underlying event (#1309).
   *
   * Unique per recipient, so a retried webhook or a replayed ledger event
   * cannot produce a second row. Uniqueness is enforced in the database
   * rather than by a read-then-write check, which races under concurrency.
   */
  @Index("IDX_notifications_recipient_event_key", { unique: true })
  @Column({ type: "varchar", length: 200 })
  eventKey!: string;

  /**
   * Where the event came from, e.g. "ledger", "api", "scheduler".
   *
   * Preserved from the first occurrence so a duplicate delivery cannot
   * rewrite the provenance of the original.
   */
  @Column({ type: "varchar", length: 64 })
  source!: string;

  /** Resource this notification points at, e.g. a split or transaction id. */
  @Column({ type: "varchar", length: 128, nullable: true })
  resourceType!: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  resourceId!: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  /** Null while unread. Set once, idempotently. */
  @Column({ type: "timestamptz", nullable: true })
  readAt!: Date | null;

  /**
   * Timestamp of the *original* event, not of the duplicate that arrived
   * later — the issue calls for preserving it explicitly.
   */
  @Column({ type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
