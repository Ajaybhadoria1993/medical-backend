import {
  checkRateLimit,
  incrementFailedAttempts,
  resetRateLimit,
} from '../services/mfaRateLimit.service';

// Mock Redis
jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
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

import redisClient from '../../../configurations/redisConfig';

const mockRedis = redisClient as jest.Mocked<typeof redisClient>;

describe('MFA Rate Limit Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkRateLimit', () => {
    it('should allow when no previous attempts exist', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue(null);

      const result = await checkRateLimit('user-123');

      expect(result).toEqual({
        allowed: true,
        remainingAttempts: 5,
      });
      expect(mockRedis.get).toHaveBeenCalledWith('mfa:rate:user-123');
    });

    it('should allow when attempts are below the limit', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue('3');

      const result = await checkRateLimit('user-123');

      expect(result).toEqual({
        allowed: true,
        remainingAttempts: 2,
      });
    });

    it('should reject when attempts reach the limit (5)', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue('5');
      (mockRedis.ttl as jest.Mock).mockResolvedValue(600);

      const result = await checkRateLimit('user-123');

      expect(result).toEqual({
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: 600,
      });
    });

    it('should reject when attempts exceed the limit', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue('7');
      (mockRedis.ttl as jest.Mock).mockResolvedValue(450);

      const result = await checkRateLimit('user-123');

      expect(result).toEqual({
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: 450,
      });
    });

    it('should use default window when TTL is not positive', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue('5');
      (mockRedis.ttl as jest.Mock).mockResolvedValue(-1);

      const result = await checkRateLimit('user-123');

      expect(result).toEqual({
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: 900,
      });
    });

    it('should fail-closed when Redis is unavailable', async () => {
      (mockRedis.get as jest.Mock).mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await checkRateLimit('user-123');

      expect(result).toEqual({
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: 900,
      });
    });
  });

  describe('incrementFailedAttempts', () => {
    it('should increment and set TTL on first attempt', async () => {
      (mockRedis.incr as jest.Mock).mockResolvedValue(1);
      (mockRedis.expire as jest.Mock).mockResolvedValue(1);

      const result = await incrementFailedAttempts('user-123');

      expect(mockRedis.incr).toHaveBeenCalledWith('mfa:rate:user-123');
      expect(mockRedis.expire).toHaveBeenCalledWith('mfa:rate:user-123', 900);
      expect(result).toEqual({
        allowed: true,
        remainingAttempts: 4,
      });
    });

    it('should increment without resetting TTL on subsequent attempts', async () => {
      (mockRedis.incr as jest.Mock).mockResolvedValue(3);

      const result = await incrementFailedAttempts('user-123');

      expect(mockRedis.incr).toHaveBeenCalledWith('mfa:rate:user-123');
      expect(mockRedis.expire).not.toHaveBeenCalled();
      expect(result).toEqual({
        allowed: true,
        remainingAttempts: 2,
      });
    });

    it('should return not allowed when reaching the limit', async () => {
      (mockRedis.incr as jest.Mock).mockResolvedValue(5);
      (mockRedis.ttl as jest.Mock).mockResolvedValue(800);

      const result = await incrementFailedAttempts('user-123');

      expect(result).toEqual({
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: 800,
      });
    });

    it('should fail-closed when Redis is unavailable', async () => {
      (mockRedis.incr as jest.Mock).mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await incrementFailedAttempts('user-123');

      expect(result).toEqual({
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: 900,
      });
    });
  });

  describe('resetRateLimit', () => {
    it('should delete the rate limit key and return full attempts', async () => {
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      const result = await resetRateLimit('user-123');

      expect(mockRedis.del).toHaveBeenCalledWith('mfa:rate:user-123');
      expect(result).toEqual({
        allowed: true,
        remainingAttempts: 5,
      });
    });

    it('should succeed even if key does not exist', async () => {
      (mockRedis.del as jest.Mock).mockResolvedValue(0);

      const result = await resetRateLimit('user-123');

      expect(result).toEqual({
        allowed: true,
        remainingAttempts: 5,
      });
    });

    it('should fail-closed when Redis is unavailable', async () => {
      (mockRedis.del as jest.Mock).mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await resetRateLimit('user-123');

      expect(result).toEqual({
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: 900,
      });
    });
  });
});
