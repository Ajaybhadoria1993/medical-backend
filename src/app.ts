// src/app.ts
import compression from 'compression';
import cors from 'cors';
import express, { Request, Response } from 'express';
import http from 'http';
import { mountApiDocs } from './apiDocs';
import corsOptions from './configurations/corsConfig';
import { errorHandler, notFoundHandler } from './middlewear/errorHandler';
import {
  signFileUrlsInResponses,
  stripSignedFileUrlsInRequests,
} from './middlewear/signFileUrls.middleware';
import { standardRateLimit } from './middlewear/rateLimit.middleware';
import { requestLogger } from './middlewear/requestLogger';
import { auditLog } from './middlewear/auditLog.middleware';
import { SocketManager } from './socket/socketManager';
import { realtimeBus } from './main/realtime';
import { initNotificationPorts } from './adapters/notifications';
import { initSuperadminAnalyticsPorts } from './adapters/superadminAnalytics';
import { initCreditsPorts } from './adapters/credits';
import { initSubscriptionPorts } from './adapters/subscription';
import { initTreatmentPlanPorts } from './adapters/treatmentPlan';
import { initSupportAccessPorts } from './adapters/supportAccess';
import { initReferralPorts } from './adapters/referral';
import { initPatientCommissionPorts } from './adapters/patientCommission';
import { getQueueFailureSnapshot } from './main/notifications/queues/queueTelemetry';
import { database } from './configurations/dbConnection';
import redisClient from './configurations/redisConfig';
import { sql } from 'drizzle-orm';
import { missingTemplateHeaderImages } from './main/notifications/utils/whatsappTemplate.utils';
import { envConfig } from './utils/envConfig';
import { loadRoutes } from './utils/loadRoutes';
import logger from './utils/logger';
import path from 'path';

// A hung dependency counts as down after 2s, so the probe itself never hangs.
const checkDependency = (
  probe: () => Promise<unknown>
): Promise<'up' | 'down'> =>
  Promise.race([
    probe().then(() => 'up' as const),
    new Promise<'down'>((resolve) => setTimeout(() => resolve('down'), 2000)),
  ]).catch(() => 'down' as const);

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/api', express.static(path.join(process.cwd(), 'public')));

export const socketManager = new SocketManager(server);

// Hand the live io instance to the realtime bus, so services can signal a
// state change without importing this module back. That cycle is exactly why
// the existing broadcast services resort to an inline require() at emit time.
realtimeBus.attach(socketManager.io);
initNotificationPorts(socketManager.io);
initSuperadminAnalyticsPorts();
initCreditsPorts();
initSubscriptionPorts();
initTreatmentPlanPorts();
initSupportAccessPorts();
initReferralPorts();
initPatientCommissionPorts();

if (envConfig.WHATSAPP_SENDING_ENABLED) {
  for (const envVar of missingTemplateHeaderImages())
    logger.warn(
      `${envVar} is not set — WhatsApp templates with an image header will be rejected by Meta`
    );
}

async function serverStarter() {
  // create SocketManager (attaches to HTTP server)

  app.use(cors(corsOptions));
  app.use(compression());
  app.use('/api/v1/prescription/scan/upload', express.json({ limit: '12mb' }));
  app.use('/api/v1/prescription/scan', express.json({ limit: '12mb' }));
  app.use('/api/v1/prescription/auto-align', express.json({ limit: '12mb' }));
  // Capture the raw request body so webhook HMAC signatures (e.g. Razorpay)
  // can be verified against the exact bytes the provider signed. The global
  // JSON parser otherwise consumes the stream, breaking signature checks.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: false }));
  app.use(requestLogger);
  app.use(auditLog);

  // 100 req/min per user or IP; the Razorpay webhook (new link and the old one Razorpay may still call) is left out:
  // it comes in bursts and is signature-checked.
  const RAZORPAY_WEBHOOKS = new Set([
    '/v2/subscription/webhooks/razorpay',
    '/v1/subscription/razorpay',
  ]);
  app.use('/api', (req, res, next) =>
    RAZORPAY_WEBHOOKS.has(req.path) ? next() : standardRateLimit(req, res, next)
  );

  // Saves plain file addresses; a signed link echoed back by a form would expire in storage.
  app.use('/api', stripSignedFileUrlsInRequests);

  // Signs stored file values on the way out, so no service has to remember to.
  app.use('/api', signFileUrlsInResponses);

  await loadRoutes(app);

  // Docker healthchecks and the CI deploy probe hit "/"; keep it a plain 200.
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).type('text').send('OK');
  });

  app.get('/api/health', async (_req: Request, res: Response) => {
    // Exhausted queue jobs are silently dropped work, so they surface here as
    // DEGRADED; a monitor can alert on the status.
    const queues = getQueueFailureSnapshot();
    const [db, redis] = await Promise.all([
      checkDependency(() => database.execute(sql`SELECT 1`)),
      checkDependency(() => redisClient.ping()),
    ]);
    // 503 when the DB or Redis is down, so an uptime monitor alerts on it.
    const down = db !== 'up' || redis !== 'up';
    const status = down
      ? 'DOWN'
      : queues.totalExhausted > 0
        ? 'DEGRADED'
        : 'OK';
    // The endpoint is public, so the breakdown goes to the logs, not the reply.
    if (status !== 'OK')
      logger.warn(`[Health] ${status}`, { db, redis, queues });
    res.status(down ? 503 : 200).json({ status });
  });

  mountApiDocs(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  const shutdown = async () => {
    logger.info('Shutting down...');
    // Close the running-late worker first so an in-flight job finishes and
    // releases its Redis lock; killing it mid-run leaves the job stalled until
    // the lock expires, which then surfaces as "Missing lock for job ...".
    await import('./main/appointment-engine/services/runningLateQueue.service')
      .then(({ runningLateQueue }) => runningLateQueue.close())
      .catch(() => {});
    await socketManager.close();
    // Audit entries are written in batches; save whatever is still queued.
    await import('./main/audit/services/auditLog.service')
      .then(({ AuditLogService }) => AuditLogService.flush())
      .catch(() => {});
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

export default serverStarter;
