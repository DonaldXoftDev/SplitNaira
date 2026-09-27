import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authJwtMiddleware } from "../middleware/auth-jwt.js";
import {
  listNotifications,
  markAllRead,
  markRead,
} from "../services/notifications.service.js";

export const notificationsRouter = Router();

// Every route here is scoped to the authenticated wallet. The recipient is
// taken from the verified token, never from the request, so one user cannot
// read or acknowledge another's notifications by changing a parameter.
notificationsRouter.use(authJwtMiddleware);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

const idParamSchema = z.object({ id: z.string().uuid() });

function recipientOf(req: Request): string {
  return req.user!.walletAddress;
}

/**
 * @openapi
 * GET /notifications
 * summary: List the authenticated user's notifications
 * description: Newest first, keyset-paginated. Returns the unread count alongside the page.
 * tags: [Notifications]
 */
notificationsRouter.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, cursor, unreadOnly } = listQuerySchema.parse(req.query);
      const result = await listNotifications({
        recipient: recipientOf(req),
        limit,
        cursor,
        unreadOnly,
      });

      return res.status(200).json({
        items: result.items.map(serialize),
        nextCursor: result.nextCursor,
        unreadCount: result.unreadCount,
      });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * @openapi
 * POST /notifications/{id}/read
 * summary: Mark one notification read
 * description: Idempotent — re-marking preserves the original read timestamp.
 * tags: [Notifications]
 */
notificationsRouter.post(
  "/:id/read",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const updated = await markRead(recipientOf(req), id);

      if (!updated) {
        // Also the answer when the notification belongs to someone else:
        // distinguishing "not yours" from "not found" would leak existence.
        return res.status(404).json({
          error: "not_found",
          message: "Notification not found.",
        });
      }

      return res.status(200).json(serialize(updated));
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * @openapi
 * POST /notifications/read-all
 * summary: Mark every unread notification read
 * tags: [Notifications]
 */
notificationsRouter.post(
  "/read-all",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await markAllRead(recipientOf(req));
      return res.status(200).json({ updated });
    } catch (error) {
      return next(error);
    }
  },
);

/** Shapes a notification for the API, linking it to its resource. */
function serialize(notification: {
  id: string;
  category: string;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: notification.id,
    category: notification.category,
    title: notification.title,
    body: notification.body,
    resource:
      notification.resourceType && notification.resourceId
        ? { type: notification.resourceType, id: notification.resourceId }
        : null,
    metadata: notification.metadata,
    read: notification.readAt !== null,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}
