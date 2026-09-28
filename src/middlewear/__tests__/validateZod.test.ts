/**
 * Regression tests for the Zod request validators.
 *
 * These exist because `validateQuery` used to assign the parsed result back to
 * `req.query`. Express 5 defines that as a getter-only property, so every
 * request through the middleware threw
 * "Cannot set property query of #<IncomingMessage> which has only a getter"
 * and 500'd. It went unnoticed because nothing used the middleware until the
 * queue and realtime routes did.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getValidatedParams,
  getValidatedQuery,
  validateParams,
  validateQuery,
} from '../validateZod';

jest.mock('../../utils/docsRegistry', () => ({
  docsRegistry: { recordError: jest.fn() },
}));

const schema = z.object({
  sections: z.string().transform((raw) => raw.split(',')),
});

/**
 * A request whose `query` is getter-only, exactly as Express 5 defines it.
 * A plain object would let an assignment succeed and hide the bug.
 */
function makeReq(query: Record<string, unknown>): Request {
  const req = {} as Request;
  Object.defineProperty(req, 'query', {
    get: () => query,
    configurable: false,
  });
  return req;
}

const makeRes = () => ({ locals: {} }) as unknown as Response;

describe('validateQuery', () => {
  it('does not attempt to overwrite the getter-only req.query', () => {
    const req = makeReq({ sections: 'board:c1,queue:c1' });
    const res = makeRes();
    const next = jest.fn();

    expect(() => validateQuery(schema)(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('publishes the parsed result on res.locals', () => {
    const req = makeReq({ sections: 'board:c1,queue:c1' });
    const res = makeRes();

    validateQuery(schema)(req, res, jest.fn());

    expect(getValidatedQuery<{ sections: string[] }>(res).sections).toEqual([
      'board:c1',
      'queue:c1',
    ]);
  });

  it('leaves req.query holding the raw, uncoerced value', () => {
    // Callers must not assume req.query was transformed — it still carries the
    // original string, which is why controllers read res.locals instead.
    const req = makeReq({ sections: 'board:c1,queue:c1' });
    const res = makeRes();

    validateQuery(schema)(req, res, jest.fn());

    expect(req.query.sections).toBe('board:c1,queue:c1');
  });

  it('throws a 400 and does not continue when validation fails', () => {
    const req = makeReq({});
    const res = makeRes();
    const next = jest.fn();

    expect(() => validateQuery(schema)(req, res, next)).toThrow(
      'Invalid query parameters'
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('validateParams', () => {
  const paramSchema = z.object({ id: z.string().min(1) });

  it('publishes the parsed result on res.locals', () => {
    const req = { params: { id: 'abc' } } as unknown as Request;
    const res = makeRes();
    const next = jest.fn();

    validateParams(paramSchema)(req, res, next);

    expect(getValidatedParams<{ id: string }>(res).id).toBe('abc');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws a 400 on invalid params', () => {
    const req = { params: { id: '' } } as unknown as Request;

    expect(() =>
      validateParams(paramSchema)(req, makeRes(), jest.fn())
    ).toThrow('Invalid URL parameters');
  });
});
