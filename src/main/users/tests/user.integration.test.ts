import request from 'supertest';
import express from 'express';
import { UserService } from '../services/user.service';
import userRouter from '../routes/v1/users.route';
import { errorHandler, HttpError } from '../../../middlewear/errorHandler';

// Mock the service
jest.mock('../services/user.service');

// Mock otplib to avoid ESM parsing issues with @scure/base
jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/v1/users', userRouter);
app.use(errorHandler);

describe('User Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/users/request-registration', () => {
    it('should return 200 and success message when registration requested', async () => {
      (
        UserService.requestRegistrationVerification as jest.Mock
      ).mockResolvedValue({
        message: 'OTP sent to your email',
      });

      const response = await request(app)
        .post('/api/v1/users/request-registration')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'OTP sent to your email',
      });
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/users/request-registration')
        .send({ email: 'invalid-email' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/users/login', () => {
    it('should return 200 and token on successful login', async () => {
      const mockResult = {
        user: { id: '1', email: 'test@example.com' },
        accessToken: 'mock_access_token',
        refreshToken: 'mock_refresh_token',
      };
      (UserService.login as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/v1/users/login')
        .send({ email: 'test@example.com', password: 'Password123!' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        user: mockResult.user,
        accessToken: mockResult.accessToken,
        refreshToken: mockResult.refreshToken,
      });
    });

    it('should return 200 with mfaRequired when MFA is enabled', async () => {
      const mockResult = {
        mfaRequired: true,
        tempToken: 'mock_mfa_temp_token',
      };
      (UserService.login as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/v1/users/login')
        .send({ email: 'test@example.com', password: 'Password123!' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        mfaRequired: true,
        tempToken: 'mock_mfa_temp_token',
      });
    });
  });

  describe('GET /api/v1/users/verify-registration-token/:token', () => {
    it('should return 200 and success with email if token is valid', async () => {
      const mockResult = {
        message: 'Token is valid',
        email: 'test@example.com',
      };
      (UserService.checkRegistrationToken as jest.Mock).mockResolvedValue(
        mockResult
      );

      const response = await request(app)
        .get('/api/v1/users/verify-registration-token/mock_token_hash')
        .query({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Token is valid',
        data: mockResult,
      });
      expect(UserService.checkRegistrationToken).toHaveBeenCalledWith(
        'mock_token_hash',
        'test@example.com'
      );
    });

    it('should return 409 when user is already registered', async () => {
      const mockError = new HttpError(409, 'User is already registered', {
        code: 'ALREADY_REGISTERED',
        userStatus: 'Pending',
      });
      (UserService.checkRegistrationToken as jest.Mock).mockRejectedValue(
        mockError
      );

      const response = await request(app)
        .get('/api/v1/users/verify-registration-token/mock_token_hash')
        .query({ email: 'test@example.com' });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        success: false,
        status: 409,
        message: 'User is already registered',
        details: {
          code: 'ALREADY_REGISTERED',
          userStatus: 'Pending',
        },
      });
    });

    it('should return 400 when email format in query is invalid', async () => {
      const response = await request(app)
        .get('/api/v1/users/verify-registration-token/mock_token_hash')
        .query({ email: 'invalid-email-format' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/users/social-login', () => {
    it('should return 200 and tokens when doctor signs in with Apple on iOS', async () => {
      const mockResult = {
        user: {
          id: 'doctor-user-uuid',
          name: 'Dr. Apple Practitioner',
          email: 'doctor@icloud.com',
          userType: 'Doctor',
          userStatus: 'Active',
        },
        accessToken: 'mock_jwt_access_token',
        refreshToken: 'mock_refresh_token_123',
      };
      (UserService.socialLogin as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/v1/users/social-login')
        .query({ device: 'ios' })
        .send({
          provider: 'apple',
          idToken: 'valid_apple_id_token',
          name: 'Dr. Apple Practitioner',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        user: mockResult.user,
        token: mockResult.accessToken,
        accessToken: mockResult.accessToken,
        refreshToken: mockResult.refreshToken,
      });
      expect(UserService.socialLogin).toHaveBeenCalledWith(
        {
          provider: 'apple',
          idToken: 'valid_apple_id_token',
          name: 'Dr. Apple Practitioner',
          device: 'web',
        },
        expect.any(String),
        undefined,
        'ios'
      );
    });

    it('should return 400 validation error when provider is unsupported', async () => {
      const response = await request(app)
        .post('/api/v1/users/social-login')
        .send({
          provider: 'unsupported_provider',
          idToken: 'some_token',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});
