/* eslint-disable @typescript-eslint/no-explicit-any */
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options';

export interface EndpointDoc {
  method: Method;
  /** Full path including the prefix, e.g. /api/v1/users/:id */
  path: string;
  description?: string;
  /** Defaults to application/json. */
  contentType?: string;
  // Zod schemas; typed loosely because route files pass several Zod versions' types.
  requestSchema?: any;
  responseSchema?: any;
  params?: any;
  query?: any;
  tags?: string[];
  deprecated?: boolean;
}

class DocsRegistry {
  private endpoints: EndpointDoc[] = [];

  /** A repeat method + path merges into the first entry. */
  addEndpoint(doc: EndpointDoc) {
    const existing = this.endpoints.find(
      (d) => d.path === doc.path && d.method === doc.method
    );
    if (existing) Object.assign(existing, doc);
    else this.endpoints.push(doc);
  }

  getEndpoints(): readonly EndpointDoc[] {
    return this.endpoints;
  }
}

export const docsRegistry = new DocsRegistry();
