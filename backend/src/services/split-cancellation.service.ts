import { SplitCancellation } from "../entities/SplitCancellation.js";
import { getDataSource } from "./database.js";
import {
  deriveSplitState,
  isCancellable,
  type ProjectSnapshot,
} from "../lib/split-lifecycle.js";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

export class NotCancellableError extends Error {
  constructor(public readonly state: string) {
    super(
      `A split in the "${state}" state cannot be cancelled. ` +
        `Only splits that have not begun distributing may be cancelled.`,
    );
    this.name = "NotCancellableError";
  }
}

export class AlreadyCancelledError extends Error {
  constructor() {
    super("This split has already been cancelled.");
    this.name = "AlreadyCancelledError";
  }
}

/** Returns the cancellation record for a split, if any. */
export async function getCancellation(
  projectId: string,
): Promise<SplitCancellation | null> {
  return getDataSource()
    .getRepository(SplitCancellation)
    .findOne({ where: { projectId: projectId.trim() } });
}

/**
 * Cancels a split (#1304).
 *
 * Caller must already have established that `cancelledBy` is the project
 * owner — authorisation lives with the existing `assertProjectOwner` guard
 * rather than being re-implemented here.
 *
 * Refuses when the derived state is past the point of no return, so a split
 * mid-distribution or already settled cannot have its history rewritten.
 *
 * **Limitation, stated plainly:** this is an off-chain marker. The Soroban
 * contract exposes no `cancel`, so this stops funding through the API but
 * cannot stop a direct on-chain `deposit`. A real guarantee needs a contract
 * function.
 */
export async function cancelSplit(input: {
  project: ProjectSnapshot;
  cancelledBy: string;
  reason?: string | null;
}): Promise<SplitCancellation> {
  const projectId = input.project.projectId.trim();
  const existing = await getCancellation(projectId);
  if (existing) throw new AlreadyCancelledError();

  const state = deriveSplitState(input.project, null);
  if (!isCancellable(state)) throw new NotCancellableError(state);

  const repository = getDataSource().getRepository(SplitCancellation);
  const record = repository.create({
    projectId,
    cancelledBy: input.cancelledBy.trim(),
    reason: input.reason?.trim() || null,
    cancelledAt: new Date(),
  });

  try {
    return await repository.save(record);
  } catch (error) {
    // Two concurrent cancellations: the unique index rejects the second.
    // Report it as already-cancelled rather than a server error.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new AlreadyCancelledError();
    }
    throw error;
  }
}

/**
 * Guard for funding paths (#1304): "prevent new funding after cancellation".
 *
 * Enforced wherever the API builds a deposit transaction. Again: this covers
 * the API surface only.
 */
export async function assertFundingAllowed(projectId: string): Promise<void> {
  const cancellation = await getCancellation(projectId);
  if (cancellation) {
    throw new Error(
      `This split was cancelled on ${cancellation.cancelledAt.toISOString()} and cannot accept new funding.`,
    );
  }
}
