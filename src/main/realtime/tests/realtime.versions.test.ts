/**
 * Tests for the realtime versions API.
 *
 * The query schema is the module's only untrusted input, and the endpoint's
 * whole job is to fan a client-supplied list into Redis reads — so the two
 * things worth pinning are that the list is parsed the way clients will send
 * it, and that it cannot fan out without a bound.
 */

const mockReadVersion = jest.fn();

jest.mock('../services/streamVersion.service', () => ({
  __esModule: true,
  readVersion: (section: string) => mockReadVersion(section),
}));

import { getVersionsQuerySchema } from '../schemas/realtime.schemas';
import { getVersionsController } from '../controllers/version.controller';

describe('getVersionsQuerySchema', () => {
  it('splits a comma-separated list', () => {
    const parsed = getVersionsQuerySchema.parse({
      sections: 'queue:c1:d1:2026-08-21,board:c1',
    });
    expect(parsed.sections).toEqual(['queue:c1:d1:2026-08-21', 'board:c1']);
  });

  it('trims whitespace and drops empty entries', () => {
    // Clients build this string by joining; a trailing comma is easy to emit.
    const parsed = getVersionsQuerySchema.parse({
      sections: ' board:c1 , , queue:c1:d1:2026-08-21 ,',
    });
    expect(parsed.sections).toEqual(['board:c1', 'queue:c1:d1:2026-08-21']);
  });

  it('accepts a single section', () => {
    expect(
      getVersionsQuerySchema.parse({ sections: 'board:c1' }).sections
    ).toEqual(['board:c1']);
  });

  it('rejects a missing or empty list', () => {
    expect(() => getVersionsQuerySchema.parse({})).toThrow();
    expect(() => getVersionsQuerySchema.parse({ sections: '' })).toThrow();
    expect(() => getVersionsQuerySchema.parse({ sections: ' , , ' })).toThrow();
  });

  it('caps the list so one request cannot fan out without bound', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `board:c${i}`).join(
      ','
    );
    expect(() =>
      getVersionsQuerySchema.parse({ sections: twenty })
    ).not.toThrow();

    const twentyOne = `${twenty},board:c20`;
    expect(() =>
      getVersionsQuerySchema.parse({ sections: twentyOne })
    ).toThrow();
  });

  it('rejects section ids carrying unexpected characters', () => {
    expect(() =>
      getVersionsQuerySchema.parse({ sections: 'board:c1 OR 1=1' })
    ).toThrow();
    expect(() =>
      getVersionsQuerySchema.parse({ sections: 'board:{clinic}' })
    ).toThrow();
  });
});

describe('getVersionsController', () => {
  const makeRes = () => {
    const res = {
      statusCode: 200,
      locals: {} as Record<string, unknown>,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res;
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns a version for every requested section, in order', async () => {
    mockReadVersion.mockImplementation(async (section: string) =>
      section === 'board:c1' ? 17 : 42
    );

    const req = {} as never;
    const res = makeRes();
    res.locals.validatedQuery = {
      sections: ['queue:c1:d1:2026-08-21', 'board:c1'],
    };

    await getVersionsController(req, res as never, jest.fn());

    expect(
      (res.body as { data: { versions: unknown[] } }).data.versions
    ).toEqual([
      { section: 'queue:c1:d1:2026-08-21', v: 42 },
      { section: 'board:c1', v: 17 },
    ]);
  });

  it('reports 0 for a section nothing has changed yet', async () => {
    // 0 is a real version, not an absence — the client stores and compares it
    // like any other, so a quiet clinic behaves the same as a busy one.
    mockReadVersion.mockResolvedValue(0);

    const req = {} as never;
    const res = makeRes();
    res.locals.validatedQuery = { sections: ['board:c-new'] };

    await getVersionsController(req, res as never, jest.fn());

    expect(
      (res.body as { data: { versions: unknown[] } }).data.versions
    ).toEqual([{ section: 'board:c-new', v: 0 }]);
  });
});
