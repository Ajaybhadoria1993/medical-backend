import { Response, Request } from 'express';
import { asyncHandler } from '../middlewear/errorHandler';
import corsOptions from '../configurations/corsConfig';
import { docsRegistry } from './docsRegistry';

/**
 * Endpoint that returns a simplified docs JSON the frontend expects.
 * The docsRegistry is expected to provide endpoints and errors.
 */
export const apiPlayground = asyncHandler(
  async (_req: Request, res: Response) => {
    const rawEndpoints = Array.from(
      docsRegistry.getEndpoints ? docsRegistry.getEndpoints() : []
    );
    const rawErrors = Array.from(
      docsRegistry.getErrors ? docsRegistry.getErrors() : []
    );

    rawEndpoints.sort((a, b) => {
      // stable sort by path then by method
      if ((a.path || '') !== (b.path || ''))
        return (a.path || '').localeCompare(b.path || '');
      return (a.method || '').localeCompare(b.method || '');
    });

    rawErrors.sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
    );

    function safeConvert(schema: unknown) {
      // The UI expects a simplified "frontend-friendly" schema, for example:
      // { type: 'object', properties: { foo: { type: 'string' } }, required: [...] }
      // If your docsRegistry already provides that, return as-is.
      if (!schema || typeof schema !== 'object') return { type: 'any' };
      // If it's already in correct shape, return; otherwise best-effort conversion could be placed here.
      return schema;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const endpoints = rawEndpoints.map((ep: any) => {
      const paramsSimple = safeConvert(ep.params);
      const querySimple = safeConvert(ep.query);
      const requestSimple = safeConvert(ep.requestSchema);
      const responseSimple = safeConvert(ep.responseSchema);

      return {
        method: ep.method,
        path: ep.path,
        description: ep.description ?? null,
        tags: ep.tags ?? [],
        registeredAt: ep.registeredAt ?? null,
        params: paramsSimple,
        query: querySimple,
        requestSchema: requestSimple,
        responseSchema: responseSimple,
        // optionally include example bodies if available for textarea fallback
        requestExample: ep.requestExample ?? null,
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors = rawErrors.map((e: any) => ({
      time: e.time,
      path: e.path,
      method: e.method ?? null,
      message: e.message,
      status: e.status ?? null,
    }));

    res.status(200).json({
      updatedAt: new Date().toISOString(),
      endpoints,
      errors,
      cors: corsOptions,
    });
  }
);
