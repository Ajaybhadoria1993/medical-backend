// src/middleware/ensure1mgJwt.ts
import { Request, Response, NextFunction } from 'express';
import { getCachedJwt, clearJwtCache } from '../utils/jwtGenerator';

/**
 * Attach generated 1mg JWT to req.oneMgJwt.
 * Uses an inflight promise to avoid concurrent token generation stampedes.
 */
let inflight: Promise<string> | null = null;

// export interface ReqWith1mg extends Request {
//   oneMgJwt: string;
// }

declare module 'express' {
  interface Request {
    oneMgJwt?: string;
  }
}

export async function ensure1mgJwt(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // If a token generation is already in progress, await it
    if (inflight) {
      req.oneMgJwt = await inflight;
      return next();
    }

    // Create an inflight promise so other requests wait for the same token generation
    inflight = (async () => {
      try {
        // getCachedJwt will return cached token or generate a new one
        return await getCachedJwt();
      } catch {
        // On error (e.g. cache/key problem), clear cache and retry once
        clearJwtCache();
        return await getCachedJwt();
      } finally {
        // ensure inflight is cleared for next time (done in finally so it's cleared even on error)
        // but we must not clear it here before awaiting caller gets value; this finally runs after return
      }
    })();

    // Wait for token, attach to request
    const token = await inflight;
    req.oneMgJwt = token;
  } catch (err) {
    // On unrecoverable error, clear cache and forward error
    clearJwtCache();
    return next(err);
  } finally {
    // clear inflight so the next generation can proceed when needed
    inflight = null;
  }

  return next();
}
