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
    insert: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../../../utils/mfaCrypto', () => ({
  encrypt: jest.fn(),
}));

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
}));

import redisClient from '../../../configurations/redisConfig';
import { database } from '../../../configurations/dbConnection';
import { encrypt } from '../../../utils/mfaCrypto';
import { generateSecret, generateURI } from 'otplib';

const mockRedis = redisClient as jest.Mocked<typeof redisClient>;
const mockDb = database as jest.Mocked<typeof database>;
const mockEncrypt = encrypt as jest.MockedFunction<typeof encrypt>;
const mockGenerateSecret = generateSecret as jest.MockedFunction<
  typeof generateSecret
>;
const mockGenerateURI = generateURI as jest.MockedFunction<typeof generateURI>;

describe('MfaService.initEnrollment', () => {
  const userId = 'test-user-id-123';
  const userEmail = 'user@example.com';
  const fakeSecret = 'JBSWY3DPEHPK3PXP1234';
  const fakeEncrypted = 'abc123:def456:ghi789';
  const fakeOtpauthUri = `otpauth://totp/Medisetu:${userEmail}?secret=${fakeSecret}&issuer=Medisetu`;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock setup for happy path
    mockGenerateSecret.mockReturnValue(fakeSecret);
    mockGenerateURI.mockReturnValue(fakeOtpauthUri);
    mockEncrypt.mockReturnValue(fakeEncrypted);
    (mockRedis.set as jest.Mock).mockResolvedValue('OK');
  });

  function mockSelectChain(results: unknown[]) {
    const chain = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(results),
    };
    (mockDb.select as jest.Mock).mockReturnValue(chain);
    return chain;
  }

  function mockSelectChainSequence(resultSets: unknown[][]) {
    let callCount = 0;
    const chain = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockImplementation(() => {
        const results = resultSets[callCount] || [];
        callCount++;
        return Promise.resolve(results);
      }),
    };
    (mockDb.select as jest.Mock).mockReturnValue(chain);
    return chain;
  }

  it('should successfully enroll a new user without existing MFA record', async () => {
    // First call: isMfaEnabled check (no active record)
    // Second call: get user email
    // Third call: check existing record
    mockSelectChainSequence([
      [], // isMfaEnabled: no active record
      [{ email: userEmail }], // user email lookup
      [], // no existing MFA record
    ]);

    const insertChain = {
      values: jest.fn().mockResolvedValue(undefined),
    };
    (mockDb.insert as jest.Mock).mockReturnValue(insertChain);

    const result = await MfaService.initEnrollment(userId);

    expect(result).toEqual({
      otpauthUri: fakeOtpauthUri,
      base32Secret: fakeSecret,
    });
    expect(mockGenerateSecret).toHaveBeenCalledWith({ length: 20 });
    expect(mockEncrypt).toHaveBeenCalledWith(fakeSecret);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalledWith(
      `mfa:pending:${userId}`,
      '1',
      'EX',
      600
    );
  });

  it('should reject with 409 if MFA is already active', async () => {
    // isMfaEnabled returns true (active record found)
    mockSelectChain([{ id: 'some-mfa-id' }]);

    await expect(MfaService.initEnrollment(userId)).rejects.toMatchObject({
      status: 409,
      message: 'MFA is already enabled on this account',
    });
  });

  it('should overwrite existing pending enrollment', async () => {
    // First: no active MFA, Second: user email, Third: existing pending record
    mockSelectChainSequence([
      [], // isMfaEnabled: no active record
      [{ email: userEmail }], // user email lookup
      [{ id: 'existing-mfa-id' }], // existing pending record
    ]);

    const updateChain = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
    };
    (mockDb.update as jest.Mock).mockReturnValue(updateChain);

    const result = await MfaService.initEnrollment(userId);

    expect(result).toEqual({
      otpauthUri: fakeOtpauthUri,
      base32Secret: fakeSecret,
    });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should throw 500 if encryption fails', async () => {
    mockSelectChainSequence([
      [], // isMfaEnabled: no active record
      [{ email: userEmail }], // user email lookup
    ]);

    mockEncrypt.mockImplementation(() => {
      throw new Error('Encryption key missing');
    });

    await expect(MfaService.initEnrollment(userId)).rejects.toMatchObject({
      status: 500,
      message: 'MFA enrollment could not be completed',
    });
  });

  it('should throw 400 if user is not found', async () => {
    mockSelectChainSequence([
      [], // isMfaEnabled: no active record
      [], // user not found
    ]);

    await expect(MfaService.initEnrollment(userId)).rejects.toMatchObject({
      status: 400,
      message: 'User not found',
    });
  });

  it('should still succeed if Redis fails to set pending key', async () => {
    mockSelectChainSequence([
      [], // isMfaEnabled: no active record
      [{ email: userEmail }], // user email lookup
      [], // no existing MFA record
    ]);

    const insertChain = {
      values: jest.fn().mockResolvedValue(undefined),
    };
    (mockDb.insert as jest.Mock).mockReturnValue(insertChain);

    // Redis fails
    (mockRedis.set as jest.Mock).mockRejectedValue(
      new Error('Connection refused')
    );

    const result = await MfaService.initEnrollment(userId);

    // Should still return successfully (Redis failure is non-fatal)
    expect(result).toEqual({
      otpauthUri: fakeOtpauthUri,
      base32Secret: fakeSecret,
    });
  });

  it('should generate the otpauth URI with correct parameters', async () => {
    mockSelectChainSequence([
      [], // isMfaEnabled: no active record
      [{ email: userEmail }], // user email lookup
      [], // no existing MFA record
    ]);

    const insertChain = {
      values: jest.fn().mockResolvedValue(undefined),
    };
    (mockDb.insert as jest.Mock).mockReturnValue(insertChain);

    await MfaService.initEnrollment(userId);

    expect(mockGenerateURI).toHaveBeenCalledWith({
      issuer: 'Infinity Medisetu',
      label: userEmail,
      secret: fakeSecret,
    });
  });
});
