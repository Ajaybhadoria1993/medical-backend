import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { errorHandler } from '../errorHandler';
import { requireAuth, requireClinic, requireRole } from '../auth.middleware';
import { requirePermission } from '../permission.middleware';
import redisClient from '../../configurations/redisConfig';
import { envConfig } from '../../utils/envConfig';
import permissionsRouter from '../../main/permissions/routes/v1/permissions.route';
import { PERMISSION_KEYS } from '../../main/permissions/utils/permission.constants';
import { validate } from '../validation.middleware';
import { getClinicSchema } from '../../main/clinic/schemas/clinic.schemas';
import { getCliniController } from '../../main/clinic/controllers/clinic.controller';
import { ClinicService } from '../../main/clinic/services/clinic.service';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../main/clinic/services/clinic.service', () => ({
  ClinicService: {
    getClinicById: jest.fn(),
  },
}));

const JWT_SECRET = envConfig.JWT_SECRET_KEY || 'change-me';

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const RECEPTIONIST_ID = '22222222-2222-2222-2222-222222222222';
const LAB_ASSISTANT_ID = '33333333-3333-3333-3333-333333333333';
const CLINIC_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLINIC_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

type TestUser = {
  id: string;
  email: string;
  userType: string;
};

function buildApp() {
  const app = express();

  app.use(express.json());

  app.get(
    '/api/v1/protected/admin',
    requireAuth,
    requireRole(['Admin']),
    requireClinic,
    (req, res) =>
      res.json({
        success: true,
        userId: req.user.id,
        userType: req.user.userType,
        clinicId: req.clinicId,
      })
  );

  app.get(
    '/api/v1/protected/patient-manage',
    requireAuth,
    requireClinic,
    requirePermission(PERMISSION_KEYS.PATIENT_MANAGE),
    (_req, res) => res.json({ success: true })
  );

  app.get(
    '/api/v1/clinic/:clinicId',
    requireAuth,
    requireClinic,
    validate(getClinicSchema, 'params'),
    getCliniController
  );

  app.use('/api/v1/permissions', permissionsRouter);
  app.use(errorHandler);

  return app;
}

function activeUser(user: TestUser) {
  return {
    ...user,
    userStatus: 'Active',
    emailVerifiedAt: new Date().toISOString(),
    isArchive: false,
    isUserBlocked: false,
    isAdminDoctorAccess: false,
  };
}

function signToken(userId: string, overrides: Record<string, unknown> = {}) {
  return jwt.sign({ sub: userId, ...overrides }, JWT_SECRET, {
    expiresIn: '15m',
  });
}

function mockRedisState(params: {
  users: Record<string, TestUser>;
  clinicByUser?: Record<string, string>;
  permissionsByUserClinic?: Record<string, string[]>;
}) {
  const clinicByUser = params.clinicByUser ?? {};
  const permissionsByUserClinic = params.permissionsByUserClinic ?? {};

  (redisClient.get as jest.Mock).mockImplementation(async (key: string) => {
    if (key.startsWith('user:password_changed_at:')) return null;

    const userId = key.replace(/^user:/, '');
    if (params.users[userId]) {
      return JSON.stringify(activeUser(params.users[userId]));
    }

    const clinicUserId = key.replace(/^user_clinic:/, '');
    if (clinicByUser[clinicUserId]) {
      return `${clinicByUser[clinicUserId]}:status:Active`;
    }

    if (key.startsWith('perm:')) {
      const [, permissionUserId, clinicId] = key.split(':');
      return JSON.stringify(
        permissionsByUserClinic[`${permissionUserId}:${clinicId}`] ?? []
      );
    }

    return null;
  });
}

describe('Auth and authorization API boundaries', () => {
  const app = buildApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows an authorized user to access permitted APIs', async () => {
    mockRedisState({
      users: {
        [ADMIN_ID]: {
          id: ADMIN_ID,
          email: 'admin@clinic.test',
          userType: 'Admin',
        },
      },
      clinicByUser: { [ADMIN_ID]: CLINIC_A_ID },
    });

    const response = await request(app)
      .get('/api/v1/protected/admin')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      userId: ADMIN_ID,
      userType: 'Admin',
      clinicId: CLINIC_A_ID,
    });
  });

  it('denies a Lab Assistant when an API is restricted to Admin', async () => {
    mockRedisState({
      users: {
        [LAB_ASSISTANT_ID]: {
          id: LAB_ASSISTANT_ID,
          email: 'lab@clinic.test',
          userType: 'Lab_Assistant',
        },
      },
      clinicByUser: { [LAB_ASSISTANT_ID]: CLINIC_A_ID },
    });

    const response = await request(app)
      .get('/api/v1/protected/admin')
      .set('Authorization', `Bearer ${signToken(LAB_ASSISTANT_ID)}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Insufficient role');
  });

  it('does not allow access by changing user or role data in the token', async () => {
    mockRedisState({
      users: {
        [RECEPTIONIST_ID]: {
          id: RECEPTIONIST_ID,
          email: 'reception@clinic.test',
          userType: 'Receptionist',
        },
      },
      clinicByUser: { [RECEPTIONIST_ID]: CLINIC_A_ID },
    });

    const tokenWithForgedRole = signToken(RECEPTIONIST_ID, {
      userType: 'Admin',
      role: 'Admin',
      userId: ADMIN_ID,
    });

    const response = await request(app)
      .get('/api/v1/protected/admin')
      .set('Authorization', `Bearer ${tokenWithForgedRole}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Insufficient role');
  });

  it("uses the authenticated user's ID for own-permission APIs even if token metadata names another user", async () => {
    mockRedisState({
      users: {
        [RECEPTIONIST_ID]: {
          id: RECEPTIONIST_ID,
          email: 'reception@clinic.test',
          userType: 'Receptionist',
        },
        [ADMIN_ID]: {
          id: ADMIN_ID,
          email: 'admin@clinic.test',
          userType: 'Admin',
        },
      },
      clinicByUser: { [RECEPTIONIST_ID]: CLINIC_A_ID },
      permissionsByUserClinic: {
        [`${RECEPTIONIST_ID}:${CLINIC_A_ID}`]: [],
        [`${ADMIN_ID}:${CLINIC_A_ID}`]: [PERMISSION_KEYS.PATIENT_MANAGE],
      },
    });

    const tokenWithForgedUserId = signToken(RECEPTIONIST_ID, {
      userId: ADMIN_ID,
    });

    const response = await request(app)
      .get('/api/v1/permissions/me')
      .set('Authorization', `Bearer ${tokenWithForgedUserId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.permissions).not.toContain(
      PERMISSION_KEYS.PATIENT_MANAGE
    );
  });

  it("does not allow a clinic user to access another clinic's data", async () => {
    mockRedisState({
      users: {
        [ADMIN_ID]: {
          id: ADMIN_ID,
          email: 'admin@clinic.test',
          userType: 'Admin',
        },
      },
      clinicByUser: { [ADMIN_ID]: CLINIC_A_ID },
    });

    const response = await request(app)
      .get(`/api/v1/clinic/${CLINIC_B_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      'Access denied. You cannot view another clinic.'
    );
    expect(ClinicService.getClinicById).not.toHaveBeenCalled();
  });

  it('requires authentication for protected APIs', async () => {
    const response = await request(app).get('/api/v1/protected/admin');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Authorization token missing');
  });

  it('rejects expired or invalid tokens', async () => {
    mockRedisState({
      users: {
        [ADMIN_ID]: {
          id: ADMIN_ID,
          email: 'admin@clinic.test',
          userType: 'Admin',
        },
      },
      clinicByUser: { [ADMIN_ID]: CLINIC_A_ID },
    });

    const expiredToken = jwt.sign({ sub: ADMIN_ID }, JWT_SECRET, {
      expiresIn: '-1s',
    });

    const expiredResponse = await request(app)
      .get('/api/v1/protected/admin')
      .set('Authorization', `Bearer ${expiredToken}`);

    const invalidResponse = await request(app)
      .get('/api/v1/protected/admin')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(expiredResponse.status).toBe(401);
    expect(expiredResponse.body.message).toContain('Invalid or expired token');
    expect(invalidResponse.status).toBe(401);
    expect(invalidResponse.body.message).toContain('Invalid or expired token');
  });

  it('keeps protected API permission checks aligned with frontend permissions', async () => {
    mockRedisState({
      users: {
        [RECEPTIONIST_ID]: {
          id: RECEPTIONIST_ID,
          email: 'reception@clinic.test',
          userType: 'Receptionist',
        },
      },
      clinicByUser: { [RECEPTIONIST_ID]: CLINIC_A_ID },
      permissionsByUserClinic: {
        [`${RECEPTIONIST_ID}:${CLINIC_A_ID}`]: [PERMISSION_KEYS.PATIENT_MANAGE],
      },
    });

    const token = signToken(RECEPTIONIST_ID);

    const frontendPermissions = await request(app)
      .get('/api/v1/permissions/me')
      .set('Authorization', `Bearer ${token}`);

    const protectedApi = await request(app)
      .get('/api/v1/protected/patient-manage')
      .set('Authorization', `Bearer ${token}`);

    expect(frontendPermissions.status).toBe(200);
    expect(frontendPermissions.body.data.permissions).toContain(
      PERMISSION_KEYS.PATIENT_MANAGE
    );
    expect(protectedApi.status).toBe(200);
  });
});
