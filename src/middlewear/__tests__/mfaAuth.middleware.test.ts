import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { requireMfaToken } from '../mfaAuth.middleware';

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'secret_key';

function createMockReq(token?: string): Partial<Request> {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    user: undefined as any,
  };
}

function createMockRes(): Partial<Response> {
  return {};
}

/**
 * Helper to invoke the asyncHandler-wrapped middleware and capture
 * the error passed to next(), or resolve if next() is called without error.
 */
function invokeMiddleware(
  middleware: any,
  req: Request,
  res: Response
): Promise<any> {
  return new Promise((resolve, reject) => {
    const next: NextFunction = (err?: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(undefined);
      }
    };
    middleware(req, res, next);
  });
}

describe('requireMfaToken middleware', () => {
  it('should reject requests without an authorization token', async () => {
    const req = createMockReq() as Request;
    const res = createMockRes() as Response;

    await expect(
      invokeMiddleware(requireMfaToken, req, res)
    ).rejects.toMatchObject({
      status: 401,
      message: 'Authorization token missing',
    });
  });

  it('should reject expired tokens with session expired message', async () => {
    const token = jwt.sign(
      { sub: 'user-123', scope: 'mfa_verification' },
      JWT_SECRET,
      { expiresIn: -1 } // already expired
    );

    const req = createMockReq(token) as Request;
    const res = createMockRes() as Response;

    await expect(
      invokeMiddleware(requireMfaToken, req, res)
    ).rejects.toMatchObject({
      status: 401,
      message: 'MFA verification session expired. Please log in again',
    });
  });

  it('should reject tokens without mfa_verification scope', async () => {
    const token = jwt.sign(
      { sub: 'user-123', scope: 'full_access' },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    const req = createMockReq(token) as Request;
    const res = createMockRes() as Response;

    await expect(
      invokeMiddleware(requireMfaToken, req, res)
    ).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token scope',
    });
  });

  it('should reject tokens with no scope claim', async () => {
    const token = jwt.sign({ sub: 'user-123' }, JWT_SECRET, {
      expiresIn: '5m',
    });

    const req = createMockReq(token) as Request;
    const res = createMockRes() as Response;

    await expect(
      invokeMiddleware(requireMfaToken, req, res)
    ).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token scope',
    });
  });

  it('should reject tokens with invalid signature', async () => {
    const token = jwt.sign(
      { sub: 'user-123', scope: 'mfa_verification' },
      'wrong-secret',
      { expiresIn: '5m' }
    );

    const req = createMockReq(token) as Request;
    const res = createMockRes() as Response;

    await expect(
      invokeMiddleware(requireMfaToken, req, res)
    ).rejects.toMatchObject({
      status: 401,
      message: 'Invalid or expired token',
    });
  });

  it('should reject tokens without a sub claim', async () => {
    const token = jwt.sign({ scope: 'mfa_verification' }, JWT_SECRET, {
      expiresIn: '5m',
    });

    const req = createMockReq(token) as Request;
    const res = createMockRes() as Response;

    await expect(
      invokeMiddleware(requireMfaToken, req, res)
    ).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token payload',
    });
  });

  it('should accept valid MFA token and attach userId to request', async () => {
    const userId = 'user-abc-123';
    const token = jwt.sign(
      { sub: userId, scope: 'mfa_verification' },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    const req = createMockReq(token) as Request;
    const res = createMockRes() as Response;

    await invokeMiddleware(requireMfaToken, req, res);

    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(userId);
  });

  it('should reject malformed authorization header', async () => {
    const req = {
      headers: { authorization: 'NotBearer some-token' },
      user: undefined as any,
    } as unknown as Request;
    const res = createMockRes() as Response;

    await expect(
      invokeMiddleware(requireMfaToken, req, res)
    ).rejects.toMatchObject({
      status: 401,
      message: 'Authorization token missing',
    });
  });
});
