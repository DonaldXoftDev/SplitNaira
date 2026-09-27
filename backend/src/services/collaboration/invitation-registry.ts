/**
 * Issue #1299 – Collaborator invitation lifecycle registry.
 *
 * Tracks pending invitations so owners can cancel them. Cancelled invitations
 * cannot be accepted. Cancellation events are recorded for audit.
 */

export type InvitationStatus = "pending" | "accepted" | "cancelled";

export interface InvitationRecord {
  id: string;
  email: string;
  tokenJti: string;
  projectId?: string;
  inviterWalletAddress?: string;
  status: InvitationStatus;
  createdAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
  acceptedAt?: string;
}

/** How the cancelling actor was authorized. */
export type InvitationCancelAuthority = "inviter" | "project_owner";

export interface InvitationCancelEvent {
  type: "invitation.cancelled";
  invitationId: string;
  email: string;
  projectId?: string;
  cancelledBy: string;
  /** Which authorization path allowed the cancellation. */
  authority: InvitationCancelAuthority;
  at: string;
}

/** In-memory store suitable for unit tests; swap for DB in production. */
const invitations = new Map<string, InvitationRecord>();
const tokenIndex = new Map<string, string>(); // tokenJti -> invitationId
const events: InvitationCancelEvent[] = [];

function newId(): string {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function resetInvitationRegistryForTests(): void {
  invitations.clear();
  tokenIndex.clear();
  events.length = 0;
}

export function registerInvitation(input: {
  email: string;
  tokenJti: string;
  projectId?: string;
  inviterWalletAddress?: string;
}): InvitationRecord {
  const record: InvitationRecord = {
    id: newId(),
    email: input.email.toLowerCase(),
    tokenJti: input.tokenJti,
    projectId: input.projectId,
    inviterWalletAddress: input.inviterWalletAddress,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  invitations.set(record.id, record);
  tokenIndex.set(record.tokenJti, record.id);
  return record;
}

export function getInvitationById(id: string): InvitationRecord | undefined {
  return invitations.get(id);
}

export function getInvitationByTokenJti(jti: string): InvitationRecord | undefined {
  const id = tokenIndex.get(jti);
  return id ? invitations.get(id) : undefined;
}

/**
 * Cancel a pending invitation.
 *
 * Two actors may cancel: the original inviter, or the project owner (when the
 * owner's address is supplied from authoritative project state).
 *
 * This fails closed. An invitation with no recorded inviter has no inviter to
 * match, so it can *only* be cancelled by an explicitly identified project
 * owner — an unrecognised actor is refused. (Previously any actor at all could
 * cancel such an invitation, which let anyone disable an invitation they had
 * never sent, since a cancelled invitation can no longer be accepted.)
 */
export function cancelInvitation(input: {
  invitationId: string;
  actorWalletAddress: string;
  /**
   * The project owner's address, when it is known from the project record.
   *
   * This is an *authorization claim*: callers must read it from stored project
   * state, never from the request being authorized.
   */
  projectOwnerAddress?: string;
}): InvitationRecord {
  const record = invitations.get(input.invitationId);
  if (!record) {
    throw Object.assign(new Error("invitation_not_found"), { code: "invitation_not_found", status: 404 });
  }
  if (record.status === "cancelled") {
    return record; // idempotent
  }
  if (record.status === "accepted") {
    throw Object.assign(new Error("invitation_already_accepted"), {
      code: "invitation_already_accepted",
      status: 409,
    });
  }

  const actor = typeof input.actorWalletAddress === "string" ? input.actorWalletAddress.trim() : "";
  if (!actor) {
    throw Object.assign(new Error("actor_required"), {
      code: "actor_required",
      status: 400,
    });
  }

  const inviter = (record.inviterWalletAddress ?? "").trim();
  const projectOwner = (input.projectOwnerAddress ?? "").trim();

  const isInviter = inviter !== "" && actor === inviter;
  const isProjectOwner = projectOwner !== "" && actor === projectOwner;

  if (!isInviter && !isProjectOwner) {
    // Distinguish "not the inviter" from "there is no inviter to be", so the
    // caller can tell a rejected actor from an invitation that needs an owner.
    const inviterUnknown = inviter === "";
    throw Object.assign(
      new Error(inviterUnknown ? "inviter_unknown" : "forbidden_not_inviter"),
      {
        code: inviterUnknown ? "inviter_unknown" : "forbidden_not_inviter",
        status: 403,
      },
    );
  }

  const authority: InvitationCancelAuthority = isProjectOwner
    ? "project_owner"
    : "inviter";

  record.status = "cancelled";
  record.cancelledAt = new Date().toISOString();
  record.cancelledBy = actor;

  const event: InvitationCancelEvent = {
    type: "invitation.cancelled",
    invitationId: record.id,
    email: record.email,
    projectId: record.projectId,
    cancelledBy: actor,
    authority,
    at: record.cancelledAt,
  };
  events.push(event);

  return record;
}

/**
 * Attempt to accept an invitation identified by token jti.
 * Rejects cancelled invitations.
 */
export function acceptInvitationByTokenJti(jti: string): InvitationRecord {
  const record = getInvitationByTokenJti(jti);
  if (!record) {
    // Token may pre-date registry; treat as accept-ok without record.
    throw Object.assign(new Error("invitation_not_tracked"), {
      code: "invitation_not_tracked",
      status: 404,
    });
  }
  if (record.status === "cancelled") {
    throw Object.assign(new Error("invitation_cancelled"), {
      code: "invitation_cancelled",
      status: 410,
    });
  }
  if (record.status === "accepted") {
    return record;
  }
  record.status = "accepted";
  record.acceptedAt = new Date().toISOString();
  return record;
}

export function listCancellationEvents(): readonly InvitationCancelEvent[] {
  return events;
}

export function listPendingInvitations(filter?: {
  projectId?: string;
  inviterWalletAddress?: string;
}): InvitationRecord[] {
  return Array.from(invitations.values()).filter((r) => {
    if (r.status !== "pending") return false;
    if (filter?.projectId && r.projectId !== filter.projectId) return false;
    if (
      filter?.inviterWalletAddress &&
      r.inviterWalletAddress !== filter.inviterWalletAddress
    ) {
      return false;
    }
    return true;
  });
}
