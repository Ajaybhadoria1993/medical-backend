// src/app.ts
import compression from 'compression';
import cors from 'cors';
import express, { Request, Response } from 'express';
import http from 'http';
import swaggerUi from 'swagger-ui-express';
import corsOptions from './configurations/corsConfig';
import { baseApiTemplate } from './htmltamplates/api';
import {
  asyncHandler,
  errorHandler,
  notFoundHandler,
} from './middlewear/errorHandler';
import { signFileUrlsInResponses } from './middlewear/signFileUrls.middleware';
import { standardRateLimit } from './middlewear/rateLimit.middleware';
import { requestLogger } from './middlewear/requestLogger';
import { SocketManager } from './socket/socketManager';
import { realtimeBus } from './main/realtime';
import { initNotificationPorts } from './adapters/notifications';
import { getQueueFailureSnapshot } from './main/notifications/queues/queueTelemetry';
import { envConfig } from './utils/envConfig';
import { loadRoutes } from './utils/loadRoutes';
import { apiPlayground } from './utils/playground';
import { generateOpenApiSpec } from './utils/swagger';
import logger from './utils/logger';
import path from 'path';

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

  // Global rate limiting for all API routes (100 req/min per user or IP)
  app.use('/api', standardRateLimit);

  // Signs stored file values on the way out, so no service has to remember to.
  app.use('/api', signFileUrlsInResponses);

  await loadRoutes(app);

  app.get(
    '/',
    asyncHandler((_req: Request, res: Response) => {
      const baseUrl = `http://localhost:${envConfig.PORT}`;
      res.status(200).type('html').send(baseApiTemplate(baseUrl));
    })
  );
  // Add this to your app.ts file after app.use(requestLogger) and before loadRoutes(app)

  app.get('/api/health', (_req: Request, res: Response) => {
    // Queue failures are reported here rather than only logged: a job that
    // exhausts its retries is silently dropped work, and nothing was watching
    // for it. An uptime monitor can alert on queues.totalExhausted rising.
    const queues = getQueueFailureSnapshot();
    res.status(200).json({
      status: queues.totalExhausted > 0 ? 'DEGRADED' : 'OK',
      timestamp: new Date().toISOString(),
      queues,
    });
  });

  app.get('/api/docs/json', apiPlayground);

  const openApiSpec = generateOpenApiSpec();
  app.use('/api/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

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
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

export default serverStarter;
