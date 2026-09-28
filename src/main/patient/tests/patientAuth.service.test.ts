import { PatientAuthService } from '../services/patientAuth.service';
import { database } from '../../../configurations/dbConnection';
import { UniversalNotificationService } from '../../notifications/services/universalNotification.service';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../configurations/redisConfig', () => ({
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  del: jest.fn().mockResolvedValue(1),
  setex: jest.fn().mockResolvedValue('OK'),
}));
jest.mock('../../../utils/logger');
jest.mock('../../users/services/token.service', () => ({
  TokenService: {
    issueTokenPair: jest.fn().mockResolvedValue({
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
      expiresIn: 3600,
    }),
  },
}));
jest.mock('../../notifications/services/universalNotification.service', () => ({
  UniversalNotificationService: {
    send: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../notifications/services/loginAlertQueue.service', () => ({
  loginAlertQueue: {
    addLoginAlert: jest.fn().mockReturnValue({ catch: jest.fn() }),
  },
}));

describe('PatientAuthService - Bypass Tests for 9999999999', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createSelectChain = (finalValue: any) => {
    const chain: any = {};
    const methods = ['from', 'where', 'limit', 'innerJoin', 'leftJoin'];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => Promise.resolve(finalValue).then(resolve);
    return chain;
  };

  describe('sendOtp', () => {
    it('should bypass SMS sending and store fixed OTP 000000 for 9999999999', async () => {
      (database.select as jest.Mock).mockReturnValue(createSelectChain([]));
      (database.delete as jest.Mock).mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
      (database.insert as jest.Mock).mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });

      const result = await PatientAuthService.sendOtp('9999999999');

      expect(result.message).toContain('bypass mode');
      expect(database.insert).toHaveBeenCalled();
      // Should NOT send SMS via UniversalNotificationService
      expect(UniversalNotificationService.send).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('should allow direct login with OTP 000000 for 9999999999 without requiring token row', async () => {
      (database.delete as jest.Mock).mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      // Existing patient lookup
      const mockPatient = {
        id: 'patient-123',
        name: 'Test Patient',
        email: null,
        mobile: '9999999999',
        userType: 'Patient',
        userStatus: 'Active',
        isUserBlocked: false,
        isArchive: false,
        emailVerifiedAt: null,
        isAdminDoctorAccess: false,
      };

      (database.select as jest.Mock)
        .mockReturnValueOnce(createSelectChain([mockPatient])) // patient lookup
        .mockReturnValueOnce(
          createSelectChain([{ gender: 'Male', dob: '1990-01-01' }])
        ); // profile lookup

      const result = await PatientAuthService.verifyOtp('9999999999', '000000');

      expect(result.accessToken).toBe('mock_access_token');
      expect(result.user.id).toBe('patient-123');
      expect(result.user.mobile).toBe('9999999999');
      expect(result.isProfileComplete).toBe(true);
    });

    it('should auto-create a new patient on first-time login with OTP 000000 for 9999999999', async () => {
      (database.delete as jest.Mock).mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      const newPatient = {
        id: 'new-patient-456',
        name: null,
        email: null,
        mobile: '9999999999',
        userType: 'Patient',
        userStatus: 'Active',
        isUserBlocked: false,
        isArchive: false,
        emailVerifiedAt: null,
        isAdminDoctorAccess: false,
      };

      (database.select as jest.Mock)
        .mockReturnValueOnce(createSelectChain([])) // no existing patient
        .mockReturnValueOnce(createSelectChain([])); // empty profile

      (database.transaction as jest.Mock).mockImplementation(
        async (cb: any) => {
          const tx = {
            insert: jest.fn().mockReturnValue({
              values: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([newPatient]),
              }),
            }),
          };
          return cb(tx);
        }
      );

      const result = await PatientAuthService.verifyOtp('9999999999', '000000');

      expect(result.isNewUser).toBe(true);
      expect(result.isProfileComplete).toBe(false);
      expect(result.user.id).toBe('new-patient-456');
    });

    it('should reject invalid OTP for 9999999999 if wrong OTP is provided', async () => {
      (database.select as jest.Mock).mockReturnValueOnce(createSelectChain([])); // no matching token record in DB

      await expect(
        PatientAuthService.verifyOtp('9999999999', '123456')
      ).rejects.toThrow('Invalid OTP. Please check and try again.');
    });
  });

  describe('resendOtp', () => {
    it('should succeed and bypass SMS sending for 9999999999', async () => {
      (database.select as jest.Mock).mockReturnValue(createSelectChain([]));
      (database.insert as jest.Mock).mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });

      const result = await PatientAuthService.resendOtp('9999999999');

      expect(result.message).toContain('bypass mode');
      expect(UniversalNotificationService.send).not.toHaveBeenCalled();
    });
  });
});
