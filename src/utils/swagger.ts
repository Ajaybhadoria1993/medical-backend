import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { docsRegistry } from './docsRegistry';
import { z } from 'zod';

extendZodWithOpenApi(z);

export function generateOpenApiSpec() {
  const registry = new OpenAPIRegistry();

  // Register bearer auth
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  const endpoints = docsRegistry.getEndpoints();

  endpoints.forEach((endpoint) => {
    const {
      method,
      path,
      description,
      tags,
      requestSchema,
      responseSchema,
      params,
      query,
      contentType,
    } = endpoint;

    // Convert Express path parameters (e.g., :id) to OpenAPI format ({id})
    const openApiPath = path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');

    // Dynamic tagging based on path - ENFORCED
    // Always try to extract module name to group by folder
    let finalTags = tags;
    const parts = path.split('/');
    // Expecting path like /api/v1/users/... -> extract 'users'
    // parts: ['', 'api', 'v1', 'users', ...]
    if (parts.length > 3) {
      const moduleName = parts[3];
      // Override existing tags to ensure strict grouping by module
      finalTags = [moduleName.charAt(0).toUpperCase() + moduleName.slice(1)];
    } else if (!finalTags || finalTags.length === 0) {
      // Fallback if path parsing fails and no tags exist
      finalTags = ['General'];
    }

    registry.registerPath({
      method: method,
      path: openApiPath,
      description: description,
      tags: finalTags,
      security: [{ bearerAuth: [] }], // Default to requiring auth, can be customized per endpoint if needed
      request: {
        params: params ? params : undefined,
        query: query ? query : undefined,
        body: requestSchema
          ? {
              content: {
                [contentType || 'application/json']: {
                  schema: requestSchema,
                },
              },
            }
          : undefined,
      },
      responses: {
        200: {
          description: 'Successful response',
          content: responseSchema
            ? {
                'application/json': {
                  schema: responseSchema,
                },
              }
            : undefined,
        },
        // Add default error responses
        400: {
          description: 'Bad Request',
        },
        401: {
          description: 'Unauthorized',
        },
        500: {
          description: 'Internal Server Error',
        },
      },
    });
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Clinic Management Software API',
      version: '1.0.0',
      description: 'API documentation for the Clinic Management Software',
    },
    servers: [
      {
        url: '/', // Fixed: Changed from /api/v1 to / to avoid duplicate prefixes
        description: 'API V1',
      },
    ],
  });
}
