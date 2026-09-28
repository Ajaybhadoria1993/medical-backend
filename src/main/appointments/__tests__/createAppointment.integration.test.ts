import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import appointmentsRouter from '../routes/v1/appointments.route';
import { errorHandler } from '../../../middlewear/errorHandler';
import redisClient from '../../../configurations/redisConfig';
import { envConfig } from '../../../utils/envConfig';
import { AppointmentService } from '../services/appointment.service';
import { StaffScopeService } from '../../permissions/services/staffScope.service';

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const JWT_SECRET = envConfig.JWT_SECRET_KEY || 'change-me';

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const CLINIC_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOCTOR_ID = '65a8df2d-60fa-4e71-88df-b59f3dbd9821';
const PATIENT_ID = '77ce9842-88f1-4fb2-b7e1-88b1d8f583e7';

const app = express();
app.use(express.json());
app.use('/api/v1/appointments', appointmentsRouter);
app.use(errorHandler);

const token = jwt.sign({ sub: ADMIN_ID }, JWT_SECRET, { expiresIn: '15m' });

/** Minimum valid create body: every field the route schema marks required. */
const validBody = {
  doctorId: DOCTOR_ID,
  patientId: PATIENT_ID,
  appointmentDate: '2099-01-01',
  appointmentType: 'Consultation',
};

const post = (body: unknown) =>
  request(app)
    .post('/api/v1/appointments')
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);

/** Serves every cache read the middleware chain makes, so none of it hits the DB. */
function mockRedis() {
  (redisClient.get as jest.Mock).mockImplementation(async (key: string) => {
    if (key === `user:${ADMIN_ID}`) {
      return JSON.stringify({
        id: ADMIN_ID,
        email: 'admin@clinic.test',
        userType: 'Admin',
        userStatus: 'Active',
        emailVerifiedAt: new Date().toISOString(),
        isArchive: false,
        isUserBlocked: false,
        isAdminDoctorAccess: false,
      });
    }
    if (key === `user_clinic:${ADMIN_ID}`) return `${CLINIC_ID}:status:Active`;
    // ownerId deliberately differs from the caller, so auto-logout short-circuits.
    if (key === `clinic_autologout:${CLINIC_ID}`) {
      return JSON.stringify({
        clinicId: CLINIC_ID,
        ownerId: 'someone-else',
        autoLogoutMinutes: null,
      });
    }
    return null;
  });
}

describe('POST /api/v1/appointments — route boundary', () => {
  let createAppointment: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis();
    jest
      .spyOn(StaffScopeService, 'assertDoctorAllowed')
      .mockResolvedValue(undefined as never);
    createAppointment = jest
      .spyOn(AppointmentService, 'createAppointment')
      .mockResolvedValue({ id: 'appt-1' } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts a valid body and hands the parsed payload to the service', async () => {
    const res = await post(validBody);

    expect(res.status).toBe(201);
    expect(createAppointment).toHaveBeenCalledTimes(1);
    const [userId, clinicId, payload, performerId] =
      createAppointment.mock.calls[0];
    expect(userId).toBe(ADMIN_ID);
    expect(clinicId).toBe(CLINIC_ID);
    expect(performerId).toBe(ADMIN_ID);
    expect(payload).toMatchObject(validBody);
  });

  // The service no longer re-parses the body, so the route is the only thing
  // turning "3" into 3. A string here would never match a numeric token set.
  it('coerces a numeric-string tokenNo to a number before the service sees it', async () => {
    await post({ ...validBody, tokenNo: '3' });

    const payload = createAppointment.mock.calls[0][2];
    expect(payload.tokenNo).toBe(3);
    expect(typeof payload.tokenNo).toBe('number');
  });

  it('coerces a numeric-string sessionIndex to a number', async () => {
    await post({ ...validBody, sessionIndex: '2' });

    const payload = createAppointment.mock.calls[0][2];
    expect(payload.sessionIndex).toBe(2);
  });

  it.each([
    ['non-numeric tokenNo', { tokenNo: 'abc' }],
    ['tokenNo above MAX_TOKEN_NUMBER', { tokenNo: 1000 }],
    ['zero tokenNo', { tokenNo: 0 }],
    ['malformed doctorId', { doctorId: 'not-a-uuid' }],
    ['malformed clinicServiceId', { clinicServiceId: 'not-a-uuid' }],
    ['unknown bookingSource', { bookingSource: 'carrier-pigeon' }],
    ['empty appointmentTime', { appointmentTime: '' }],
  ])(
    'rejects %s with 400 and never reaches the service',
    async (_label, patch) => {
      const res = await post({ ...validBody, ...patch });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      // `errors` is the validate() middleware's own shape, so this pins the
      // rejection to the schema rather than to any later guard returning 400.
      expect(res.body.errors).toBeDefined();
      expect(createAppointment).not.toHaveBeenCalled();
    }
  );

  // Pairs with the "above MAX_TOKEN_NUMBER" case: proves the cap is a real
  // boundary and not the schema rejecting every tokenNo it is handed.
  it('accepts tokenNo at the MAX_TOKEN_NUMBER boundary', async () => {
    const res = await post({ ...validBody, tokenNo: 999 });

    expect(res.status).toBe(201);
    expect(createAppointment.mock.calls[0][2].tokenNo).toBe(999);
  });

  it.each([
    ['appointmentType', 'appointmentType'],
    ['appointmentDate', 'appointmentDate'],
    ['doctorId', 'doctorId'],
  ])('rejects a body missing %s', async (_label, field) => {
    const body: Record<string, unknown> = { ...validBody };
    delete body[field];

    const res = await post(body);

    expect(res.status).toBe(400);
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request before validation runs', async () => {
    const res = await request(app)
      .post('/api/v1/appointments')
      .send({ garbage: true });

    expect(res.status).toBe(401);
    expect(createAppointment).not.toHaveBeenCalled();
  });
});
