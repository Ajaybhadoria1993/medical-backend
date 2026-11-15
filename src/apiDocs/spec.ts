import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { docsRegistry } from './registry';

extendZodWithOpenApi(z);

// /api/v1/users/... -> "Users": one Swagger group per module, whatever tags a route passed.
const tagFor = (path: string) => {
  const moduleName = path.split('/')[3];
  return moduleName
    ? moduleName.charAt(0).toUpperCase() + moduleName.slice(1)
    : 'General';
};

/** OpenAPI 3 spec for every endpoint registered so far; call after loadRoutes. */
export function buildOpenApiSpec() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  for (const doc of docsRegistry.getEndpoints()) {
    registry.registerPath({
      method: doc.method,
      path: doc.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}'),
      description: doc.description,
      deprecated: doc.deprecated,
      tags: [tagFor(doc.path)],
      security: [{ bearerAuth: [] }],
      request: {
        params: doc.params,
        query: doc.query,
        body: doc.requestSchema
          ? {
              content: {
                [doc.contentType ?? 'application/json']: {
                  schema: doc.requestSchema,
                },
              },
            }
          : undefined,
      },
      responses: {
        200: {
          description: 'Successful response',
          content: doc.responseSchema
            ? { 'application/json': { schema: doc.responseSchema } }
            : undefined,
        },
        400: { description: 'Bad Request' },
        401: { description: 'Unauthorized' },
        500: { description: 'Internal Server Error' },
      },
    });
  }

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'MediArogya API',
      version: '1.0.0',
      description: 'API documentation for MediArogya',
    },
    servers: [{ url: '/' }],
  });
}
