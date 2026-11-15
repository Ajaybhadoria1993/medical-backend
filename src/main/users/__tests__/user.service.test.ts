import { UserService } from '../services/user.service';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import * as authUtils from '../../../utils/authUtils';
import { sendEmail } from '../../../utils/email';

// Mock dependencies
jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/authUtils');
jest.mock('../../../utils/email');
jest.mock('../../../utils/logger');
jest.mock('../../mfa/services/mfa.service', () => ({
  MfaService: {
    isMfaEnabled: jest.fn(),
  },
}));
jest.mock('../services/token.service', () => ({
  TokenService: {
    issueTokenPair: jest.fn(),
  },
}));
jest.mock('../../../utils/socialAuth', () => ({
  verifyGoogleIdToken: jest.fn(),
  verifyAppleIdToken: jest.fn(),
}));
jest.mock('../../notifications/services/loginAlertQueue.service', () => ({
  loginAlertQueue: {
    addLoginAlert: jest.fn().mockResolvedValue(undefined),
  },
}));

// Import after mock setup
import { MfaService } from '../../mfa/services/mfa.service';
import { TokenService } from '../services/token.service';
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
} from '../../../utils/socialAuth';

describe('UserService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sendEmail as jest.Mock).mockReturnValue({
      catch: jest.fn().mockResolvedValue({}),
    });
  });

  describe('requestRegistrationVerification', () => {
    it('should throw error if email is already in use', async () => {
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await expect(
        UserService.requestRegistrationVerification('test@example.com')
      ).rejects.toThrow(new HttpError(400, 'Email already in use'));
    });

    it('should send OTP if email is available', async () => {
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      (database.insert as jest.Mock).mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockResolvedValue({}),
        }),
      });

      (authUtils.generateOTP as jest.Mock).mockReturnValue('123456');
      (authUtils.hashToken as jest.Mock).mockReturnValue('hashed_otp');

      const result =
        await UserService.requestRegistrationVerification('test@example.com');

      expect(result).toEqual({ message: 'OTP sent to your email' });
      expect(database.insert).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should throw 401 for invalid email', async () => {
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        UserService.login('wrong@example.com', 'password')
      ).rejects.toThrow(new HttpError(401, 'Invalid email'));
    });

    it('should return user and token for valid credentials', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        password: 'hashed_password',
        isEmailVerified: true,
        userStatus: 'Active',
      };

      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockUser]),
          }),
        }),
      });

      (authUtils.comparePassword as jest.Mock).mockResolvedValue(true);
      (TokenService.issueTokenPair as jest.Mock).mockResolvedValue({
        accessToken: 'mock_access_token',
        refreshToken: 'mock_refresh_token',
      });
      (MfaService.isMfaEnabled as jest.Mock).mockResolvedValue(false);

      const result = await UserService.login('test@example.com', 'password');

      expect(result).toHaveProperty('accessToken', 'mock_access_token');
      expect(result).toHaveProperty('refreshToken', 'mock_refresh_token');
      expect((result as any).user.email).toBe('test@example.com');
    });

    it('should return mfaRequired and tempToken when MFA is enabled', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        password: 'hashed_password',
        isEmailVerified: true,
        userStatus: 'Active',
      };

      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockUser]),
          }),
        }),
      });

      (authUtils.comparePassword as jest.Mock).mockResolvedValue(true);
      (authUtils.signMfaTempToken as jest.Mock).mockReturnValue(
        'mock_mfa_temp_token'
      );
      (MfaService.isMfaEnabled as jest.Mock).mockResolvedValue(true);

      const result = await UserService.login('test@example.com', 'password');

      expect(result).toEqual({
        mfaRequired: true,
        tempToken: 'mock_mfa_temp_token',
      });
      expect(authUtils.signMfaTempToken).toHaveBeenCalledWith('1');
      expect(TokenService.issueTokenPair).not.toHaveBeenCalled();
    });
  });

  describe('checkRegistrationToken', () => {
    it('should throw error if token does not exist', async () => {
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        UserService.checkRegistrationToken('non_existent_token')
      ).rejects.toThrow(
        new HttpError(400, 'Invalid or expired registration link')
      );
    });

    it('should throw error if token is expired', async () => {
      const mockExpiredToken = {
        tokenHash: 'expired_token',
        type: 'registration_verification',
        expiresAt: new Date(Date.now() - 10000), // in the past
        email: 'test@example.com',
      };
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockExpiredToken]),
          }),
        }),
      });

      await expect(
        UserService.checkRegistrationToken('expired_token')
      ).rejects.toThrow(new HttpError(400, 'Registration link has expired'));
    });

    it('should return success and email if token is valid', async () => {
      const mockValidToken = {
        tokenHash: 'valid_token',
        type: 'registration_verification',
        expiresAt: new Date(Date.now() + 10000), // in the future
        email: 'test@example.com',
      };
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockValidToken]),
          }),
        }),
      });

      const result = await UserService.checkRegistrationToken('valid_token');
      expect(result).toEqual({
        message: 'Token is valid',
        email: 'test@example.com',
      });
    });

    it('should throw 409 and ALREADY_REGISTERED if token does not exist but email is already registered', async () => {
      const mockSelect = database.select as jest.Mock;
      mockSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ id: 'user_id', userStatus: 'Pending' }]), // User exists
          }),
        }),
      });

      await expect(
        UserService.checkRegistrationToken(
          'used_or_invalid_token',
          'test@example.com'
        )
      ).rejects.toThrow(
        new HttpError(409, 'User is already registered', {
          code: 'ALREADY_REGISTERED',
          userStatus: 'Pending',
        })
      );
    });

    it('should throw 409 and ALREADY_REGISTERED if token is expired but email is already registered', async () => {
      const mockSelect = database.select as jest.Mock;
      mockSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ id: 'user_id', userStatus: 'Active' }]), // User exists
          }),
        }),
      });

      await expect(
        UserService.checkRegistrationToken('expired_token', 'test@example.com')
      ).rejects.toThrow(
        new HttpError(409, 'User is already registered', {
          code: 'ALREADY_REGISTERED',
          userStatus: 'Active',
        })
      );
    });
  });

  describe('checkInviteToken', () => {
    it('should throw error if token does not exist', async () => {
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        UserService.checkInviteToken('non_existent_token')
      ).rejects.toThrow(
        new HttpError(400, 'Invalid or expired invitation link')
      );
    });

    it('should throw error if token is expired', async () => {
      const mockExpiredToken = {
        tokenHash: 'expired_token',
        type: 'set_initial_password',
        expiresAt: new Date(Date.now() - 10000), // in the past
        email: 'test@example.com',
      };
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockExpiredToken]),
          }),
        }),
      });

      await expect(
        UserService.checkInviteToken('expired_token')
      ).rejects.toThrow(new HttpError(400, 'Invitation link has expired'));
    });

    it('should return success, userId, and email if token is valid', async () => {
      const mockValidToken = {
        tokenHash: 'valid_token',
        type: 'set_initial_password',
        expiresAt: new Date(Date.now() + 10000), // in the future
        email: 'test@example.com',
        userId: 'some-uuid',
      };
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockValidToken]),
          }),
        }),
      });

      const result = await UserService.checkInviteToken('valid_token');
      expect(result).toEqual({
        message: 'Token is valid',
        userId: 'some-uuid',
        email: 'test@example.com',
      });
    });

    it('should throw 409 and ALREADY_REGISTERED if token does not exist but user has password set', async () => {
      const mockSelect = database.select as jest.Mock;
      mockSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: 'user_id',
                  password: 'hashed_password',
                  userStatus: 'Pending',
                },
              ]),
            }),
          }),
        });

      await expect(
        UserService.checkInviteToken(
          'used_or_invalid_token',
          'test@example.com'
        )
      ).rejects.toThrow(
        new HttpError(409, 'User is already registered', {
          code: 'ALREADY_REGISTERED',
          userStatus: 'Pending',
        })
      );
    });

    it('should throw 409 and ALREADY_REGISTERED if token is expired but user has password set', async () => {
      const mockSelect = database.select as jest.Mock;
      const mockExpiredToken = {
        tokenHash: 'expired_token',
        type: 'set_initial_password',
        expiresAt: new Date(Date.now() - 10000),
        email: 'test@example.com',
        userId: 'user_id',
      };
      mockSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockExpiredToken]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: 'user_id',
                  password: 'hashed_password',
                  userStatus: 'Active',
                },
              ]),
            }),
          }),
        });

      await expect(
        UserService.checkInviteToken('expired_token', 'test@example.com')
      ).rejects.toThrow(
        new HttpError(409, 'User is already registered', {
          code: 'ALREADY_REGISTERED',
          userStatus: 'Active',
        })
      );
    });
  });

  describe('socialLogin', () => {
    const mockTokens = {
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-123',
    };

    beforeEach(() => {
      (TokenService.issueTokenPair as jest.Mock).mockResolvedValue(mockTokens);
    });

    it('should successfully login an existing user with Apple Sign-In', async () => {
      (verifyAppleIdToken as jest.Mock).mockResolvedValue({
        provider: 'apple',
        providerId: '001490.apple.sub.123',
        email: 'doctor@icloud.com',
        name: 'Dr. Apple Practitioner',
      });

      const existingUser = {
        id: 'user-uuid-1',
        name: 'Dr. Apple Practitioner',
        email: 'doctor@icloud.com',
        userStatus: 'Active',
        emailVerifiedAt: new Date(),
        userType: 'Doctor',
        socialProvider: 'apple',
        socialProviderId: '001490.apple.sub.123',
        isArchive: false,
        isUserBlocked: false,
        password: null,
      };

      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            select: jest.fn().mockReturnValue({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([existingUser]),
                }),
              }),
            }),
            update: jest.fn(),
            insert: jest.fn(),
          };
          return callback(tx);
        }
      );

      const result = await UserService.socialLogin(
        {
          provider: 'apple',
          idToken: 'apple-jwt-token',
          device: 'ios',
          name: 'Dr. Apple Practitioner',
        },
        '127.0.0.1',
        'DoctorApp/1.0',
        'ios'
      );

      expect(verifyAppleIdToken).toHaveBeenCalledWith(
        'apple-jwt-token',
        'ios',
        'Dr. Apple Practitioner'
      );
      expect(result.user).toEqual(existingUser);
      expect(result.accessToken).toBe('access-token-123');
      expect(result.refreshToken).toBe('refresh-token-123');
    });

    it('should register a new user when signing in with Apple for the first time', async () => {
      (verifyAppleIdToken as jest.Mock).mockResolvedValue({
        provider: 'apple',
        providerId: '001490.apple.sub.999',
        email: 'newdoctor@icloud.com',
        name: 'New Doctor',
      });

      const createdUser = {
        id: 'new-user-uuid',
        name: 'New Doctor',
        email: 'newdoctor@icloud.com',
        userStatus: 'New',
        emailVerifiedAt: new Date(),
        userType: 'Admin',
        password: null,
      };

      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            select: jest.fn().mockReturnValue({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
            insert: jest.fn().mockReturnValue({
              values: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([createdUser]),
              }),
            }),
            update: jest.fn(),
          };
          return callback(tx);
        }
      );

      const result = await UserService.socialLogin(
        {
          provider: 'apple',
          idToken: 'apple-jwt-token',
          device: 'ios',
        },
        '127.0.0.1',
        'DoctorApp/1.0',
        'ios'
      );

      expect(result.user).toEqual(createdUser);
      expect(result.accessToken).toBe('access-token-123');
    });

    it('should successfully login an existing user with Google Sign-In', async () => {
      (verifyGoogleIdToken as jest.Mock).mockResolvedValue({
        provider: 'google',
        providerId: 'google-sub-123',
        email: 'doctor@gmail.com',
        name: 'Dr. Google User',
      });

      const existingUser = {
        id: 'user-google-1',
        name: 'Dr. Google User',
        email: 'doctor@gmail.com',
        userStatus: 'Active',
        emailVerifiedAt: new Date(),
        userType: 'Doctor',
        socialProvider: 'google',
        socialProviderId: 'google-sub-123',
        isArchive: false,
        isUserBlocked: false,
        password: null,
      };

      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            select: jest.fn().mockReturnValue({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([existingUser]),
                }),
              }),
            }),
            update: jest.fn(),
            insert: jest.fn(),
          };
          return callback(tx);
        }
      );

      const result = await UserService.socialLogin(
        {
          provider: 'google',
          idToken: 'google-jwt-token',
          device: 'web',
        },
        '127.0.0.1',
        'DoctorApp/1.0',
        'web'
      );

      expect(verifyGoogleIdToken).toHaveBeenCalledWith(
        'google-jwt-token',
        'web'
      );
      expect(result.user).toEqual(existingUser);
      expect(result.accessToken).toBe('access-token-123');
    });

    it('should throw 400 for unsupported social provider', async () => {
      await expect(
        UserService.socialLogin(
          {
            provider: 'facebook' as any,
            idToken: 'fb-token',
            device: 'web',
          },
          '127.0.0.1'
        )
      ).rejects.toThrow(
        new HttpError(400, 'Unsupported social login provider')
      );
    });
  });
});
