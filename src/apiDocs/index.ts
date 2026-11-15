// Public surface: route files register here; app.ts mounts the UI.
import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { envConfig } from '../utils/envConfig';
import logger from '../utils/logger';
import { buildOpenApiSpec } from './spec';

export { docsRegistry } from './registry';
export type { EndpointDoc, Method } from './registry';

const DOCS_PATH = '/api/api-docs';

// Compares digests, so the check takes the same time whatever the guess.
const same = (a: string, b: string) =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest()
  );

const basicAuth =
  (user: string, password: string) =>
  (req: Request, res: Response, next: NextFunction) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    const decoded =
      scheme === 'Basic' ? Buffer.from(encoded ?? '', 'base64').toString() : '';
    const split = decoded.indexOf(':');
    const ok =
      split > 0 &&
      same(decoded.slice(0, split), user) &&
      same(decoded.slice(split + 1), password);
    if (ok) return next();
    res
      .status(401)
      .set('WWW-Authenticate', 'Basic realm="API docs", charset="UTF-8"')
      .send('Authentication required');
  };

/** Swagger UI at /api/api-docs behind a login. Off unless API_DOCS_USER and API_DOCS_PASSWORD are set. */
export function mountApiDocs(app: Express): void {
  const { API_DOCS_USER: user, API_DOCS_PASSWORD: password } = envConfig;
  if (!user || !password) {
    logger.info('[ApiDocs] Off: API_DOCS_USER / API_DOCS_PASSWORD not set');
    return;
  }

  const spec = buildOpenApiSpec();
  const auth = basicAuth(user, password);
  app.get(`${DOCS_PATH}/openapi.json`, auth, (_req, res) => res.json(spec));
  app.use(DOCS_PATH, auth, swaggerUi.serve, swaggerUi.setup(spec));
  logger.info(`[ApiDocs] Swagger UI at ${DOCS_PATH}`);
}
