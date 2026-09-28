/* eslint-disable @typescript-eslint/no-explicit-any */
// src/middleware/validation.middleware.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodType, ZodError } from 'zod';
import { asyncHandler } from './errorHandler'; // adjust path
import { docsRegistry } from '../utils/docsRegistry';

declare module 'express-serve-static-core' {
  interface Request {
    validatedBody?: any;
    validatedParams?: any;
    validatedQuery?: any;
  }
}

function pickTarget(req: Request, target: 'body' | 'params' | 'query') {
  switch (target) {
    case 'body':
      return req.body;
    case 'params':
      return req.params;
    case 'query':
      return req.query;
    default:
      return undefined;
  }
}

/**
 * Normalize ZodIssue into a detailed error object.
 */
function mapZodIssues(zerr: ZodError) {
  return zerr.issues.map((issue) => {
    const base: any = {
      path: issue.path.length ? issue.path.join('.') : '(root)',
      message: issue.message,
      code: issue.code,
    };
    const anyIssue = issue as any;
    if (anyIssue.expected !== undefined) base.expected = anyIssue.expected;
    if (anyIssue.received !== undefined) base.received = anyIssue.received;
    if (anyIssue.minimum !== undefined) base.minimum = anyIssue.minimum;
    if (anyIssue.maximum !== undefined) base.maximum = anyIssue.maximum;
    return base;
  });
}

function recordValidationError(req: Request, err: ZodError, target: string) {
  docsRegistry.recordError({
    path: req.originalUrl,
    method: req.method,
    message: `Invalid ${target}: ${err.issues
      .map((i) => `${i.path.join('.') || '(root)'} → ${i.message}`)
      .join('; ')}`,
    status: 400,
    stack: err.stack,
  });
}

/**
 * Middleware factory: validate request body/params/query with a Zod schema
 * Returns rich error details (field path, message, expected/received types).
 */
export const validate =
  (
    schema: ZodType<any>,
    target: 'body' | 'params' | 'query' = 'body'
  ): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = pickTarget(req, target);
      const parsed = await schema.parseAsync(payload);
      if (target === 'body') {
        req.validatedBody = parsed;
      }

      if (target === 'params') {
        req.validatedParams = parsed;
      }

      if (target === 'query') {
        req.validatedQuery = parsed;
      }

      return next();
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        recordValidationError(req, err, target);
        const details = mapZodIssues(err);
        return res.status(400).json({ success: false, errors: details });
      }
      return res.status(400).json({
        success: false,
        errors: { error: (err as Error)?.message ?? err },
      });
    }
  };

/**
 * HOC wrapper: validate and then call the provided handler (keeps asyncHandler)
 */
export const withValidation =
  (schema: ZodType<any>, target: 'body' | 'params' | 'query' = 'body') =>
  (handler: RequestHandler): RequestHandler =>
    asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      try {
        const payload = pickTarget(req, target);
        const parsed = await schema.parseAsync(payload);
        if (target === 'body') {
          req.validatedBody = parsed;
        }

        if (target === 'params') {
          req.validatedParams = parsed;
        }

        if (target === 'query') {
          req.validatedQuery = parsed;
        }
        return handler(req, res, next);
      } catch (err: unknown) {
        if (err instanceof ZodError) {
          recordValidationError(req, err, target);
          const details = mapZodIssues(err);
          res.status(400).json({ success: false, errors: details });
        }
        res.status(400).json({
          success: false,
          errors: { error: (err as Error)?.message ?? err },
        });
      }
    });
