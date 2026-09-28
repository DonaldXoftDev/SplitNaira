import type { NextFunction, Request, Response } from "express";
import { scValToNative } from "@stellar/stellar-sdk";

import {
  depositSchema,
  listProjectsSchema,
  lockProjectSchema,
  projectIdParamSchema,
} from "../schemas/splits.js";

import {
  buildDepositUnsignedXdr,
  buildLockProjectUnsignedXdr,
  decodeCursor,
  encodeCursor,
  fetchProjectById,
  listProjects as listProjectsService,
  serializeBigInts,
  simulateReadOnlyContractCall,
} from "../services/splits.service.js";

import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";

export class SplitsController {
  /**
   * List projects with pagination, search and type filtering.
   */
  async listProjects(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const parsed = listProjectsSchema.safeParse(req.query);

      if (!parsed.success) {
        throw new AppError(
          ErrorType.VALIDATION,
          ErrorCode.VALIDATION_ERROR,
          "Invalid query parameters.",
          undefined,
          parsed.error.flatten(),
        );
      }

      let { start, limit, search, type, cursor } = parsed.data;

      // Cursor takes precedence over the explicit start value.
      if (cursor) {
        try {
          start = decodeCursor(cursor);
        } catch {
          throw new AppError(
            ErrorType.VALIDATION,
            ErrorCode.VALIDATION_ERROR,
            "Invalid pagination cursor.",
          );
        }
      }

      const [projects, total] = await Promise.all([
        listProjectsService(start, limit, search, type),
        simulateReadOnlyContractCall("get_project_count"),
      ]);

      const totalCount = total
        ? Number(scValToNative(total))
        : 0;

      const nextStart = start + projects.length;

      const nextCursor =
        projects.length === limit && nextStart < totalCount
          ? encodeCursor(nextStart)
          : null;

      return res.status(200).json(
        serializeBigInts({
          projects,
          total: totalCount,
          nextCursor,
        }),
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Get a project by ID.
   */
  async getProject(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const { projectId } = projectIdParamSchema.parse(req.params);

      const project = await fetchProjectById(projectId);

      if (!project) {
        throw new AppError(
          ErrorType.VALIDATION,
          ErrorCode.NOT_FOUND,
          `Project ${projectId} not found.`,
        );
      }

      return res.status(200).json(serializeBigInts(project));
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Build an unsigned XDR transaction for locking a project.
   */
  async lockProject(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const { projectId } = projectIdParamSchema.parse(req.params);
      const { owner } = lockProjectSchema.parse(req.body);

      const result = await buildLockProjectUnsignedXdr({
        projectId,
        owner,
      });

      return res.status(200).json(serializeBigInts(result));
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Build an unsigned XDR transaction for depositing into a project.
   */
  async deposit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const { projectId } = projectIdParamSchema.parse(req.params);
      const { from, amount, token } = depositSchema.parse(req.body);

      const result = await buildDepositUnsignedXdr({
        projectId,
        from,
        amount,
        token,
      });

      return res.status(200).json(serializeBigInts(result));
    } catch (error) {
      return next(error);
    }
  }
}