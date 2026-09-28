// src/configurations/corsConfig.ts
import { CorsOptions } from 'cors';
import { envConfig } from '../utils/envConfig';
import logger from '../utils/logger';

/**
 * Parses allowed origins from CORS_ALLOWED_ORIGINS env var.
 * Supports comma-separated values for multiple origins.
 *
 * In development: allows localhost origins automatically.
 * In production: only explicitly listed origins are allowed.
 */
function getAllowedOrigins(): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [];

  // Allowed origins from CORS_ALLOWED_ORIGINS env var (comma-separated)
  const corsOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (corsOrigins) {
    corsOrigins
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((origin) => origins.push(origin));
  }

  // In development, allow common local dev ports
  if (envConfig.NODE_ENV === 'development') {
    origins.push(/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/);
  }

  return origins;
}

const allowedOrigins = getAllowedOrigins();

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    // Dev: allow any origin so devtunnel/ngrok URLs work; prod/staging stay allow-listed.
    if (!origin || envConfig.NODE_ENV === 'development') {
      return callback(null, true);
    }

    const isAllowed = allowedOrigins.some((allowed) => {
      if (allowed instanceof RegExp) return allowed.test(origin);
      return allowed === origin;
    });
    if (isAllowed) {
      return callback(null, true);
    }

    logger.warn(`[CORS] Blocked request from origin: ${origin}`);
    return callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-access-token',
    'X-Requested-With',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ],
  exposedHeaders: [
    // Carries a download's file name; the browser hides it from scripts otherwise.
    'Content-Disposition',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
  ],
  credentials: true,
  maxAge: 86400, // Preflight cache: 24 hours
  optionsSuccessStatus: 204,
};

export default corsOptions;
