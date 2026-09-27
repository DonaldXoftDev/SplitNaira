import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Record of a split being cancelled (#1304).
 *
 * This is an **off-chain** marker. The Soroban contract has no `cancel`
 * function, so this blocks funding through the API and hides the split from
 * the funding UI — it cannot stop someone invoking `deposit` on the contract
 * directly. See the PR description; making the guarantee real needs a
 * contract change.
 *
 * Cancellations are never deleted. "Preserve historical records" is an
 * acceptance criterion, and a split that was cancelled and later revisited
 * needs to show why and by whom.
 */
@Entity("split_cancellations")
export class SplitCancellation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /**
   * On-chain project id. Unique: a split can only be cancelled once, and the
   * database is what enforces that rather than a check-then-write.
   */
  @Index("IDX_split_cancellations_project", { unique: true })
  @Column({ type: "varchar", length: 128 })
  projectId!: string;

  /** Wallet that authorised the cancellation — the project owner. */
  @Column({ type: "varchar", length: 128 })
  cancelledBy!: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  reason!: string | null;

  @Column({ type: "timestamptz", default: () => "now()" })
  cancelledAt!: Date;
}
