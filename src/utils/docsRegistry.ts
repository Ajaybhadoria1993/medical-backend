/* eslint-disable @typescript-eslint/no-explicit-any */
// src/utils/docsRegistry.ts
import type { ZodError } from 'zod';

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options';

export interface EndpointDoc {
  method: Method;
  // full path including prefix, e.g. /api/v1/users or /api/v1/users/:id
  path: string;
  description?: string;
  // content type (optional), defaults to application/json
  contentType?: string;
  // the raw zod schema (optional) for request / response
  requestSchema?: ZodError | null | any;
  responseSchema?: ZodError | null | any;
  // examples (optional)
  requestExample?: any;
  responseExample?: any;
  // tags etc optional
  tags?: string[];
  params?: ZodError | null | any;
  query?: ZodError | null | any;
  registeredAt?: string;
  deprecated?: boolean;
}

export interface RecordedError {
  time: string; // ISO
  path: string;
  method?: string;
  message: string;
  stack?: string;
  status?: number;
}

class DocsRegistry {
  private endpoints: EndpointDoc[] = [];
  private errors: RecordedError[] = [];

  addEndpoint(doc: EndpointDoc) {
    const now = new Date().toISOString();
    // attach registeredAt if not present (or update if you prefer)
    doc.registeredAt = doc.registeredAt ?? now;

    const exists = this.endpoints.find(
      (d) => d.path === doc.path && d.method === doc.method
    );
    if (exists) {
      // merge non-null props and update registeredAt if new
      Object.assign(exists, { ...exists, ...doc });
      if (!exists.registeredAt) exists.registeredAt = now;
      return;
    }
    this.endpoints.push(doc);
  }

  getEndpoints() {
    return this.endpoints;
  }

  recordError(err: Omit<RecordedError, 'time'>) {
    this.errors.unshift({
      ...err,
      time: new Date().toISOString(),
    });
    // keep only last N
    this.errors = this.errors.slice(0, 100);
  }

  getErrors() {
    return this.errors;
  }
}

export const docsRegistry = new DocsRegistry();
