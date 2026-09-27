/**
 * Collaboration routes – invitations cancel is on auth-email; this module
 * exposes project deletion safeguards (#1296) and permissions introspection
 * plus server-side permission enforcement (#1300).
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  CONFIRMATION_PHRASE,
  requestProjectDeletion,
  type ProjectFinancialSnapshot,
} from "../services/collaboration/project-deletion.js";
import { getPermissionsMatrix } from "../services/collaboration/permissions.js";
import {
  createProjectPermissionMiddleware,
  type ProjectRoleContextResolver,
} from "../middleware/project-permission.js";
import { requireStellarAddress } from "../middleware/project-access.js";

export const collaborationRouter = Router();

/**
 * Authoritative source for a project's collaboration record, wired at startup.
 *
 * Until it is registered the delete route fails closed: without a record there
 * is no role to resolve, and assuming one is how the client-supplied `role`
 * field used to work (#1300).
 */
let resolveProjectRoleContext: ProjectRoleContextResolver | null = null;

export function setProjectRoleContextResolver(
  resolver: ProjectRoleContextResolver,
): void {
  resolveProjectRoleContext = resolver;
}

const resolveRoleContext: ProjectRoleContextResolver = (projectId) =>
  resolveProjectRoleContext
    ? resolveProjectRoleContext(projectId)
    : Promise.resolve(null);


collaborationRouter.get("/permissions/matrix", (_req, res) => {
  res.status(200).json({ roles: getPermissionsMatrix() });
});

const deleteBodySchema = z.object({
  actor: z.string().min(1),
  confirmed: z.boolean(),
  confirmationText: z.string().optional(),
  financial: z.object({
    projectId: z.string().min(1),
    hasDeposits: z.boolean(),
    hasDistributions: z.boolean(),
    hasClaims: z.boolean(),
    transactionCount: z.number().int().nonnegative(),
    totalVolumeStroops: z.string().optional(),
  }),
});


collaborationRouter.post(
  "/projects/:projectId/delete",
  // The acting role is resolved from the verified requester address against the
  // project's stored collaboration record — never from the request body.
  requireStellarAddress,
  createProjectPermissionMiddleware("project:delete", resolveRoleContext),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = deleteBodySchema.parse(req.body);
      const projectId = req.params.projectId as string;

      if (body.financial.projectId !== projectId) {
        return res.status(400).json({ error: "project_id_mismatch" });
      }

      const snapshot: ProjectFinancialSnapshot = body.financial;
      const decision = requestProjectDeletion({
        snapshot,
        actor: body.actor,
        confirmed: body.confirmed,
        confirmationText: body.confirmationText,
      });

      if (!decision.allowed) {
        return res.status(409).json({
          error: "deletion_blocked",
          decision,
          confirmationPhrase: CONFIRMATION_PHRASE,
        });
      }

      return res.status(200).json({
        success: true,
        role: res.locals.collaboratorRole,
        decision,
      });
    } catch (error) {
      return next(error);
    }
  }
);

export { resolveCollaboratorRole };
