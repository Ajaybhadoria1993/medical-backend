import { ClinicService } from '../services/clinic.service';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { sendSMS } from '../../../utils/smsClient';
import { hashToken } from '../../../utils/authUtils';
import { indianMobileSchema } from '../schemas/clinic.schemas';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');
jest.mock('../../../utils/smsClient');
jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
  },
}));

describe('Indian Mobile Number Schema Validation', () => {
  it('should validate and normalize valid Indian mobile numbers', () => {
    // Standard 10-digit number
    expect(indianMobileSchema.parse('9876543210')).toBe('9876543210');
    // With spaces
    expect(indianMobileSchema.parse('98765 43210')).toBe('9876543210');
    // With dashes
    expect(indianMobileSchema.parse('98765-43210')).toBe('9876543210');
    // With +91 country code and spaces
    expect(indianMobileSchema.parse('+91 98765 43210')).toBe('9876543210');
    // With 91 country code without +
    expect(indianMobileSchema.parse('919876543210')).toBe('9876543210');
    // With leading 0
    expect(indianMobileSchema.parse('09876543210')).toBe('9876543210');
  });

  it('should reject invalid mobile numbers or landline numbers', () => {
    // Landline numbers (starting with 1-5)
    expect(() => indianMobileSchema.parse('1123456789')).toThrow();
    expect(() => indianMobileSchema.parse('2226400010')).toThrow();
    // Invalid length
    expect(() => indianMobileSchema.parse('987654321')).toThrow(); // 9 digits
    expect(() => indianMobileSchema.parse('98765432101')).toThrow(); // 11 digits
    // Invalid starting digit
    expect(() => indianMobileSchema.parse('5987654321')).toThrow();
  });
});

describe('ClinicService.requestClinicPhoneUpdate', () => {
  const createChain = (finalValue: any) => {
    const chain: any = {};
    const methods = ['from', 'where', 'limit', 'select', 'set', 'returning'];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(finalValue);
    return chain;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends OTP via SMS and stores in Redis when clinic exists', async () => {
    // Mock clinic exists check
    (database.select as jest.Mock).mockReturnValueOnce(
      createChain([
        {
          id: 'clinic-123',
          clinicPhone: '9999999999',
          isClinicPhoneVerified: false,
        },
      ])
    );
    (redisClient.set as jest.Mock).mockResolvedValueOnce('OK');
    (sendSMS as jest.Mock).mockResolvedValueOnce(undefined);

    const result = await ClinicService.requestClinicPhoneUpdate(
      'clinic-123',
      '9876543210'
    );

    expect(result.message).toContain('Verification OTP sent');
    expect(redisClient.set).toHaveBeenCalledWith(
      'clinic:phone_otp:clinic-123',
      expect.stringContaining('"phone":"9876543210"'),
      'EX',
      600
    );
    expect(sendSMS).toHaveBeenCalledWith(
      '+919876543210',
      expect.stringContaining('verification code')
    );
  });

  it('throws 404 error if clinic does not exist', async () => {
    (database.select as jest.Mock).mockReturnValueOnce(createChain([]));

    await expect(
      ClinicService.requestClinicPhoneUpdate('clinic-123', '9876543210')
    ).rejects.toThrow('Clinic not found');
  });

  it('throws 400 error if phone number is already verified', async () => {
    (database.select as jest.Mock).mockReturnValueOnce(
      createChain([
        {
          id: 'clinic-123',
          clinicPhone: '9876543210',
          isClinicPhoneVerified: true,
        },
      ])
    );

    await expect(
      ClinicService.requestClinicPhoneUpdate('clinic-123', '9876543210')
    ).rejects.toThrow('This phone number is already verified');
  });

  it('deletes the OTP from Redis and throws 502 if SMS sending fails', async () => {
    (database.select as jest.Mock).mockReturnValueOnce(
      createChain([
        {
          id: 'clinic-123',
          clinicPhone: '9999999999',
          isClinicPhoneVerified: false,
        },
      ])
    );
    (redisClient.set as jest.Mock).mockResolvedValueOnce('OK');
    (sendSMS as jest.Mock).mockRejectedValueOnce(new Error('SNS unavailable'));

    await expect(
      ClinicService.requestClinicPhoneUpdate('clinic-123', '9876543210')
    ).rejects.toThrow('Failed to send verification code');

    expect(redisClient.del).toHaveBeenCalledWith('clinic:phone_otp:clinic-123');
  });
});

describe('ClinicService.verifyClinicPhone', () => {
  const createChain = (finalValue: any) => {
    const chain: any = {};
    const methods = ['from', 'where', 'limit', 'select', 'set', 'returning'];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(finalValue);
    return chain;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('successfully verifies OTP, updates clinicPhone and deletes Redis key', async () => {
    const redisMockValue = JSON.stringify({
      phone: '9876543210',
      otpHash: hashToken('123456'),
    });
    (redisClient.get as jest.Mock).mockResolvedValueOnce(redisMockValue);
    (database.update as jest.Mock).mockReturnValueOnce(createChain([]));
    (redisClient.del as jest.Mock).mockResolvedValue('OK');

    const result = await ClinicService.verifyClinicPhone(
      'clinic-123',
      '9876543210',
      '123456'
    );

    expect(result.message).toContain('verified successfully');
    expect(database.update).toHaveBeenCalled();
    expect(redisClient.del).toHaveBeenCalledWith('clinic:phone_otp:clinic-123');
    expect(redisClient.del).toHaveBeenCalledWith('clinic_details:clinic-123');
  });

  it('throws error if verification session expired', async () => {
    (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      ClinicService.verifyClinicPhone('clinic-123', '9876543210', '123456')
    ).rejects.toThrow('expired or does not exist');
  });

  it('throws error if phone number is mismatched', async () => {
    const redisMockValue = JSON.stringify({
      phone: '9876543210',
      otpHash: hashToken('123456'),
    });
    (redisClient.get as jest.Mock).mockResolvedValueOnce(redisMockValue);

    await expect(
      ClinicService.verifyClinicPhone('clinic-123', '9999999999', '123456')
    ).rejects.toThrow('Invalid mobile number for this verification session');
  });

  it('throws error if OTP is invalid', async () => {
    const redisMockValue = JSON.stringify({
      phone: '9876543210',
      otpHash: hashToken('123456'),
    });
    (redisClient.get as jest.Mock).mockResolvedValueOnce(redisMockValue);

    await expect(
      ClinicService.verifyClinicPhone('clinic-123', '9876543210', '000000')
    ).rejects.toThrow('Invalid verification code');
  });
});

describe('ClinicService.resendClinicPhoneOtp', () => {
  const staleLastSentAt = Date.now() - 5 * 60 * 1000; // well past the cooldown

  beforeEach(() => {
    jest.clearAllMocks();
    (redisClient.incr as jest.Mock).mockResolvedValue(1);
  });

  it('resends a fresh OTP when cooldown has elapsed and cap not reached', async () => {
    const redisMockValue = JSON.stringify({
      phone: '9876543210',
      otpHash: hashToken('123456'),
      resendCount: 1,
      lastSentAt: staleLastSentAt,
    });
    (redisClient.get as jest.Mock).mockResolvedValueOnce(redisMockValue);
    (redisClient.set as jest.Mock).mockResolvedValueOnce('OK');
    (sendSMS as jest.Mock).mockResolvedValueOnce(undefined);

    const result = await ClinicService.resendClinicPhoneOtp(
      'clinic-123',
      '9876543210'
    );

    expect(result.message).toContain('resent successfully');
    expect(result.resendCount).toBe(2);
    expect(redisClient.set).toHaveBeenCalledWith(
      'clinic:phone_otp:clinic-123',
      expect.stringContaining('"resendCount":2'),
      'EX',
      600
    );
    expect(sendSMS).toHaveBeenCalledWith(
      '+919876543210',
      expect.stringContaining('verification code')
    );
  });

  it('throws 400 if no active session exists', async () => {
    (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      ClinicService.resendClinicPhoneOtp('clinic-123', '9876543210')
    ).rejects.toThrow('No active verification session found');
  });

  it('throws 400 if phone does not match the active session', async () => {
    const redisMockValue = JSON.stringify({
      phone: '9876543210',
      otpHash: hashToken('123456'),
      resendCount: 0,
      lastSentAt: staleLastSentAt,
    });
    (redisClient.get as jest.Mock).mockResolvedValueOnce(redisMockValue);

    await expect(
      ClinicService.resendClinicPhoneOtp('clinic-123', '9999999999')
    ).rejects.toThrow('Invalid mobile number for this verification session');
  });

  it('throws 429 once the max resend count is reached', async () => {
    const redisMockValue = JSON.stringify({
      phone: '9876543210',
      otpHash: hashToken('123456'),
      resendCount: 5,
      lastSentAt: staleLastSentAt,
    });
    (redisClient.get as jest.Mock).mockResolvedValueOnce(redisMockValue);

    await expect(
      ClinicService.resendClinicPhoneOtp('clinic-123', '9876543210')
    ).rejects.toThrow('Maximum resend limit reached');
  });

  it('throws 429 if the resend cooldown has not elapsed', async () => {
    const redisMockValue = JSON.stringify({
      phone: '9876543210',
      otpHash: hashToken('123456'),
      resendCount: 0,
      lastSentAt: Date.now(),
    });
    (redisClient.get as jest.Mock).mockResolvedValueOnce(redisMockValue);

    await expect(
      ClinicService.resendClinicPhoneOtp('clinic-123', '9876543210')
    ).rejects.toThrow('Please wait');
  });

  it('throws 429 if the per-window rate limit is exceeded', async () => {
    (redisClient.incr as jest.Mock).mockResolvedValueOnce(999);

    await expect(
      ClinicService.resendClinicPhoneOtp('clinic-123', '9876543210')
    ).rejects.toThrow('Too many OTP requests');
    expect(redisClient.get).not.toHaveBeenCalled();
  });

  it('rolls back to the prior session and throws 502 if SMS sending fails', async () => {
    const redisMockValue = JSON.stringify({
      phone: '9876543210',
      otpHash: hashToken('123456'),
      resendCount: 0,
      lastSentAt: staleLastSentAt,
    });
    (redisClient.get as jest.Mock).mockResolvedValueOnce(redisMockValue);
    (redisClient.set as jest.Mock).mockResolvedValue('OK');
    (sendSMS as jest.Mock).mockRejectedValueOnce(new Error('SNS unavailable'));

    await expect(
      ClinicService.resendClinicPhoneOtp('clinic-123', '9876543210')
    ).rejects.toThrow('Failed to resend verification code');

    expect(redisClient.set).toHaveBeenLastCalledWith(
      'clinic:phone_otp:clinic-123',
      redisMockValue,
      'EX',
      600
    );
  });
});
