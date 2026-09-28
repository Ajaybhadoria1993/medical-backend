// src/middleware/validateZod.ts
import type { Request, Response, NextFunction } from 'express';
import { ZodError, ZodType } from 'zod';
import { docsRegistry } from '../utils/docsRegistry';
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

export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      recordValidationError(req, result.error, 'body');
      // throw expressive error — your errorHandler should convert to HTTP 400
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = new Error('Invalid request body');
      err.status = 400;
      err.details = result.error.format();
      throw err;
    }
    // replace body with parsed data (useful for coercion)
    req.body = result.data;
    next();
  };
}

/**
 * Validates `req.query` and publishes the parsed result on
 * `res.locals.validatedQuery`.
 *
 * It does NOT write back to `req.query`. Express 5 defines that as a
 * getter-only property, so assigning to it throws
 * "Cannot set property query of #<IncomingMessage> which has only a getter"
 * and every request through this middleware 500s. Read the parsed value with
 * `getValidatedQuery` — `req.query` still holds the raw, uncoerced strings.
 */
export function validateQuery(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      recordValidationError(req, result.error, 'query');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = new Error('Invalid query parameters');
      err.status = 400;
      err.details = result.error.format();
      throw err;
    }
    res.locals.validatedQuery = result.data;
    next();
  };
}

/**
 * Reads what `validateQuery` parsed, typed to the schema's output.
 *
 * Only safe on a route that actually runs `validateQuery` — on any other it
 * returns undefined at runtime regardless of what the type claims.
 */
export function getValidatedQuery<T>(res: Response): T {
  return res.locals.validatedQuery as T;
}

/**
 * Validates `req.params` and publishes the parsed result on
 * `res.locals.validatedParams`. Read it with `getValidatedParams`.
 *
 * Mirrors `validateQuery` rather than writing back to `req.params`: this
 * middleware has no callers yet, and the first one should not have to
 * discover the Express 5 getter-only problem the way the query variant did.
 */
export function validateParams(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      recordValidationError(req, result.error, 'params');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = new Error('Invalid URL parameters');
      err.status = 400;
      err.details = result.error.format();
      throw err;
    }
    res.locals.validatedParams = result.data;
    next();
  };
}

/** Reads what `validateParams` parsed, typed to the schema's output. */
export function getValidatedParams<T>(res: Response): T {
  return res.locals.validatedParams as T;
}
