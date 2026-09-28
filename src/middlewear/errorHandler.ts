/* eslint-disable @typescript-eslint/no-explicit-any */
// src/middleware/errorHandler.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { docsRegistry } from '../utils/docsRegistry';
import logger from '../utils/logger';
import { envConfig } from '../utils/envConfig';

/**
 * HttpError - throw this in controllers/services for predictable HTTP responses
 * e.g. throw new HttpError(400, 'Bad input', { field: 'email' })
 */
export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(
    status = 500,
    message = 'Internal Server Error',
    details?: unknown
  ) {
    super(message);
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message = 'Bad Request', details?: unknown) {
    return new HttpError(400, message, details);
  }

  static unauthorized(message = 'Unauthorized', details?: unknown) {
    return new HttpError(401, message, details);
  }

  static forbidden(message = 'Forbidden', details?: unknown) {
    return new HttpError(403, message, details);
  }

  static notFound(message = 'Not Found', details?: unknown) {
    return new HttpError(404, message, details);
  }

  static conflict(message = 'Conflict', details?: unknown) {
    return new HttpError(409, message, details);
  }

  static internal(message = 'Internal Server Error', details?: unknown) {
    return new HttpError(500, message, details);
  }
}

/**
 * Global error utility functions for cleaner usage
 */
export const throwBadRequest = (msg?: string, details?: unknown) => {
  throw HttpError.badRequest(msg, details);
};
export const throwUnauthorized = (msg?: string, details?: unknown) => {
  throw HttpError.unauthorized(msg, details);
};
export const throwForbidden = (msg?: string, details?: unknown) => {
  throw HttpError.forbidden(msg, details);
};
export const throwNotFound = (msg?: string, details?: unknown) => {
  throw HttpError.notFound(msg, details);
};
export const throwConflict = (msg?: string, details?: unknown) => {
  throw HttpError.conflict(msg, details);
};
export const throwInternal = (msg?: string, details?: unknown) => {
  throw HttpError.internal(msg, details);
};

/**
 * asyncHandler wrapper for route handlers
 * usage: router.get('/', asyncHandler(async (req,res) => { ... }));
 */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Sanitize DB/Postgres error so we don't leak sensitive details
 */
function sanitizeDbError(err: any) {
  if (!err || typeof err !== 'object') return {};
  const out: Record<string, unknown> = {};
  if (err.code) out.code = err.code;
  if (err.severity_local) out.severity = err.severity_local;
  if (err.constraint) out.constraint = err.constraint;
  if (err.table) out.table = err.table;
  if (err.column) out.column = err.column;
  // Do NOT include query, detail, hint, or full message that might contain params
  return out;
}

/**
 * Build the client-safe payload from an arbitrary error.
 * Does NOT include stacks or sensitive data.
 */
function buildClientPayload(err: unknown) {
  // default
  let status = 500;
  let message = 'Internal Server Error';
  let details: unknown = undefined;

  // S3 rejected the upload before it began — almost always missing/blank
  // AWS_ACCESS_TOKEN / AWS_SECRET_TOKEN rather than a fault in the request,
  // so report it as an unavailable dependency instead of a generic 500.
  if (
    err &&
    typeof err === 'object' &&
    (err as { name?: string }).name === 'CredentialsProviderError'
  ) {
    status = 503;
    message =
      'File upload is unavailable: storage credentials are not configured.';
    return { status, message, details };
  }

  // Multer upload errors (e.g. file exceeds the configured size limit)
  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large'
        : `Upload error: ${err.message}`;
    return { status, message, details };
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    status = 400;
    message = 'Validation error';
    details = err.issues.map((issue) => {
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
    return { status, message, details };
  }

  // HttpError thrown intentionally in code
  if (err instanceof HttpError) {
    status = err.status ?? 500;
    message = err.message ?? message;
    if (err.details !== undefined) details = err.details;
    return { status, message, details };
  }

  // Drizzle wraps the real driver error in `.cause` (e.g. DrizzleQueryError
  // whose own .message is "Failed query: insert into ... params: ..." -
  // never surface that raw text/query to the client). Unwrap to the
  // underlying Postgres error so the detection below can catch it.
  const pgErr =
    err &&
    typeof err === 'object' &&
    (err as any).cause &&
    typeof (err as any).cause === 'object' &&
    ((err as any).cause.code || (err as any).cause.name === 'PostgresError')
      ? (err as any).cause
      : err;

  const isDrizzleWrapper =
    err &&
    typeof err === 'object' &&
    ((err as any).name === 'DrizzleQueryError' ||
      /^Failed query:/.test((err as any).message ?? ''));

  // postgres / postgres-js style errors (loose detection)
  if (
    pgErr &&
    typeof pgErr === 'object' &&
    ((pgErr as any).name === 'PostgresError' ||
      (pgErr as any).code ||
      (pgErr as any).severity_local)
  ) {
    const code = (pgErr as any).code?.toString?.() ?? '';
    // map a few well-known codes to friendly messages
    if (code === '28P01') {
      status = 401;
      message = 'Database authentication failed';
    } else if (code === '3D000') {
      status = 500;
      message = 'Database not found';
    } else if (code === '23505') {
      status = 409;
      message = 'Duplicate resource';
    } else if (code === '22P02') {
      status = 404;
      message = 'Failed query';
    } else {
      status = 500;
      message = 'Database error';
    }
    details = sanitizeDbError(pgErr);
    return { status, message, details };
  }

  // Drizzle query failure whose cause wasn't a recognizable Postgres error
  // shape - still must not leak the raw "Failed query: insert into ..." text.
  if (isDrizzleWrapper) {
    status = 500;
    message = 'Database error';
    return { status, message, details };
  }

  // plain object that carries a status (some libs attach this)
  if (
    err &&
    typeof err === 'object' &&
    typeof (err as any).status === 'number'
  ) {
    status = (err as any).status;
    message = (err as any).message ?? message;
    details = (err as any).details ?? undefined;
    return { status, message, details };
  }

  // generic Error
  if (err instanceof Error) {
    message = err.message || message;
    return { status, message, details };
  }

  // unknown fallback
  return { status, message, details };
}

/**
 * Central JSON-only error handler for Express.
 * Place this LAST in your middleware stack.
 */
const skipPaths = [
  '/.well-known/appspecific/com.chrome.devtools.json',
  '/favicon.ico',
  // add more if needed
];

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) {
  const { status, message, details } = buildClientPayload(err);

  // Log server-side using winston logger
  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} - Internal Error:`, err);
  } else {
    logger.warn(
      `${req.method} ${req.originalUrl} - Client Error (${status}): ${message}`,
      { details }
    );
  }

  // --- RECORD THE ERROR TO docsRegistry (safe / non-blocking) ---
  try {
    if (!skipPaths.includes(req.path)) {
      docsRegistry.recordError({
        path: req.originalUrl || req.url,
        method: req.method,
        message: message ?? (err as any)?.message ?? String(err),
        stack:
          envConfig.NODE_ENV === 'production' ? undefined : (err as any)?.stack,
        status,
      });
    }
  } catch (e) {
    // do not throw from logger/registry
    logger.error('[ERROR] Failed to record error in docsRegistry', e);
  }
  // --- end record ---

  const payload: any = {
    success: false,
    status,
    message,
  };

  if (details !== undefined) payload.details = details;

  // never send stack in production
  if (envConfig.NODE_ENV !== 'production') {
    payload.stack = (err as any)?.stack;
  }

  res.status(status).type('json').json(payload);
}

/**
 * 404 JSON handler — place before errorHandler
 */
export function notFoundHandler(req: Request, res: Response) {
  // record 404 into docsRegistry as well (optional, useful for visibility)
  try {
    if (!skipPaths.includes(req.path)) {
      docsRegistry.recordError({
        path: req.originalUrl || req.url,
        method: req.method,
        message: `Route ${req.method} ${req.originalUrl} not found`,
        status: 404,
      });
    }
  } catch (e) {
    // ignore registry failure
    logger.error('[ERROR] Failed to record 404 in docsRegistry', e);
  }

  res.status(404).json({
    success: false,
    status: 404,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}
