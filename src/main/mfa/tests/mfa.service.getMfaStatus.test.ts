import { MfaService } from '../services/mfa.service';

// Mock dependencies
jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  },
}));

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: jest.fn(),
  },
}));

jest.mock('../../../utils/mfaCrypto', () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn(),
}));

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));

jest.mock('../services/recoveryCode.utils', () => ({
  generateRecoveryCodes: jest.fn(),
  hashRecoveryCode: jest.fn(),
  verifyRecoveryCode: jest.fn(),
}));

jest.mock('../services/mfaRateLimit.service', () => ({
  checkRateLimit: jest.fn(),
  incrementFailedAttempts: jest.fn(),
  resetRateLimit: jest.fn(),
}));

import { database } from '../../../configurations/dbConnection';

const mockDb = database as jest.Mocked<typeof database>;

describe('MfaService.getMfaStatus', () => {
  const userId = 'test-user-id-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockSelectChainForGetMfaStatus(
    mfaResult: unknown[],
    countResult: unknown[]
  ) {
    let callCount = 0;
    const chain = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation(() => {
        callCount++;
        // Second call (count query) terminates at .where() - no .limit()
        if (callCount === 2) {
          return Promise.resolve(countResult);
        }
        return chain;
      }),
      limit: jest.fn().mockImplementation(() => {
        // First call (MFA record query) terminates at .limit()
        return Promise.resolve(mfaResult);
      }),
    };
    (mockDb.select as jest.Mock).mockReturnValue(chain);
    return chain;
  }

  it('should return mfaEnabled=false when MFA has never been enabled', async () => {
    // No active MFA record found - first query returns empty, count query won't be reached
    mockSelectChainForGetMfaStatus([], []);

    const result = await MfaService.getMfaStatus(userId);

    expect(result).toEqual({
      mfaEnabled: false,
      recoveryCodesRemaining: 0,
      lastModifiedAt: null,
    });
  });

  it('should return mfaEnabled=true with recovery code count when MFA is active', async () => {
    const lastModified = new Date('2024-01-15T10:30:00.000Z');

    mockSelectChainForGetMfaStatus(
      [{ isActive: true, lastModifiedAt: lastModified }],
      [{ count: 8 }]
    );

    const result = await MfaService.getMfaStatus(userId);

    expect(result).toEqual({
      mfaEnabled: true,
      recoveryCodesRemaining: 8,
      lastModifiedAt: '2024-01-15T10:30:00.000Z',
    });
  });

  it('should return recoveryCodesRemaining=0 when all codes are used', async () => {
    const lastModified = new Date('2024-02-20T14:00:00.000Z');

    mockSelectChainForGetMfaStatus(
      [{ isActive: true, lastModifiedAt: lastModified }],
      [{ count: 0 }]
    );

    const result = await MfaService.getMfaStatus(userId);

    expect(result).toEqual({
      mfaEnabled: true,
      recoveryCodesRemaining: 0,
      lastModifiedAt: '2024-02-20T14:00:00.000Z',
    });
  });

  it('should return lastModifiedAt as ISO string', async () => {
    const lastModified = new Date('2024-06-01T08:45:30.123Z');

    mockSelectChainForGetMfaStatus(
      [{ isActive: true, lastModifiedAt: lastModified }],
      [{ count: 10 }]
    );

    const result = await MfaService.getMfaStatus(userId);

    expect(result.lastModifiedAt).toBe('2024-06-01T08:45:30.123Z');
  });

  it('should handle null lastModifiedAt gracefully', async () => {
    mockSelectChainForGetMfaStatus(
      [{ isActive: true, lastModifiedAt: null }],
      [{ count: 5 }]
    );

    const result = await MfaService.getMfaStatus(userId);

    expect(result).toEqual({
      mfaEnabled: true,
      recoveryCodesRemaining: 5,
      lastModifiedAt: null,
    });
  });

  it('should return full count of 10 recovery codes for freshly enrolled user', async () => {
    const lastModified = new Date('2024-03-10T12:00:00.000Z');

    mockSelectChainForGetMfaStatus(
      [{ isActive: true, lastModifiedAt: lastModified }],
      [{ count: 10 }]
    );

    const result = await MfaService.getMfaStatus(userId);

    expect(result.recoveryCodesRemaining).toBe(10);
  });
});
