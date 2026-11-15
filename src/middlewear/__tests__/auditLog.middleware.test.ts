import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { auditLog } from '../auditLog.middleware';
import { AuditLogService } from '../../main/audit/services/auditLog.service';
import logger from '../../utils/logger';

jest.mock('../../main/audit/services/auditLog.service', () => ({
  AuditLogService: { record: jest.fn() },
}));
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const record = AuditLogService.record as jest.Mock;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = { id: 'user-1', email: 'a@b.c', userType: 'Receptionist' };
  req.clinicId = 'clinic-1';
  next();
}

/** Mounted the way loadRoutes mounts them, so baseUrl + route.path match production. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(auditLog);

  const appointments = express.Router();
  appointments.post('/', fakeAuth, (_req, res) => {
    res.status(201).json({ ok: true });
  });
  appointments.post('/:appointmentId/cancel', fakeAuth, (req, res) => {
    if (req.body?.fail) return res.status(400).json({ ok: false });
    res.json({ ok: true });
  });
  appointments.post('/:appointmentId/reminder', fakeAuth, (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/v1/appointments', appointments);

  const patient = express.Router();
  patient.put('/', fakeAuth, (_req, res) => res.json({ ok: true }));
  app.use('/api/v1/patient', patient);

  const subscription = express.Router();
  subscription.post('/subscribe', fakeAuth, (req, res) => {
    if (req.body?.free) res.locals.auditAction = 'subscription.activated_free';
    res.status(201).json({ ok: true });
  });
  app.use('/api/v1/subscription', subscription);

  const users = express.Router();
  users.post('/login', (_req, res) => {
    res.locals.auditUserId = 'user-9';
    res.json({ ok: true });
  });
  app.use('/api/v1/users', users);

  return app;
}

describe('auditLog middleware', () => {
  beforeEach(() => {
    record.mockReset().mockResolvedValue(undefined);
    (logger.warn as jest.Mock).mockClear();
  });

  it('records a tracked action with the id from the URL', async () => {
    await request(buildApp())
      .post('/api/v1/appointments/appt-1/cancel')
      .send({ reason: 'patient asked' })
      .expect(200);
    await flush();

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      userId: 'user-1',
      clinicId: 'clinic-1',
      action: 'appointment.cancelled',
      entityId: 'appt-1',
      ip: expect.any(String),
    });
  });

  it('matches a router root path and reads a body id without storing the body', async () => {
    const app = buildApp();
    await request(app).post('/api/v1/appointments').send({}).expect(201);
    await request(app)
      .put('/api/v1/patient')
      .send({ peteintId: 'pat-2', note: 'private note' })
      .expect(200);
    await flush();

    expect(record.mock.calls.map(([entry]) => entry.action)).toEqual([
      'appointment.booked',
      'patient.updated',
    ]);
    expect(record.mock.calls[1][0].entityId).toBe('pat-2');
    expect(JSON.stringify(record.mock.calls)).not.toContain('private note');
  });

  it('skips untracked routes and failed requests', async () => {
    const app = buildApp();
    await request(app).post('/api/v1/appointments/appt-1/reminder').expect(200);
    await request(app)
      .post('/api/v1/appointments/appt-1/cancel')
      .send({ fail: true })
      .expect(400);
    await flush();

    expect(record).not.toHaveBeenCalled();
  });

  it('records a controller-reported outcome on an otherwise untracked route', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/v1/subscription/subscribe')
      .send({ free: false })
      .expect(201);
    await request(app)
      .post('/api/v1/subscription/subscribe')
      .send({ free: true })
      .expect(201);
    await flush();

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].action).toBe('subscription.activated_free');
  });

  it('records a login from res.locals when there is no req.user', async () => {
    await request(buildApp()).post('/api/v1/users/login').expect(200);
    await flush();

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-9',
        clinicId: null,
        action: 'account.login',
      })
    );
  });

  it('keeps the response and the process healthy when the save fails', async () => {
    record.mockRejectedValue(new Error('db down'));

    await request(buildApp())
      .post('/api/v1/appointments/appt-1/cancel')
      .expect(200);
    await flush();

    expect(logger.warn).toHaveBeenCalledWith(
      '[AuditLog] Failed to save appointment.cancelled',
      expect.any(Error)
    );
  });
});
