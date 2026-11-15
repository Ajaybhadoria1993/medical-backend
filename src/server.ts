import serverStarter from './app';
import { envConfig } from './utils/envConfig';
import {
  pgDbConnection,
  medicineDbConnection,
} from './configurations/dbConnection';
import logger from './utils/logger';
import { initCronJobs } from './cron';

// Node 22 exits on any unhandled rejection; one dropped outside connection
// (e.g. the remote medicine DB resetting a socket) must not take the API down.
process.on('unhandledRejection', (reason) => {
  logger.error(
    '[Process] Unhandled promise rejection (server kept running):',
    reason
  );
});

async function startServer() {
  try {
    const appInstance = await serverStarter();
    await pgDbConnection();
    await medicineDbConnection();

    appInstance.listen(envConfig.PORT, '0.0.0.0', () => {
      logger.info(`Server is running at http://localhost:${envConfig.PORT}`);
      logger.info(`Environment: ${envConfig.NODE_ENV}`);

      // Initialize all cron jobs after server is ready
      initCronJobs();

      // Start the running-late BullMQ worker at boot. It was previously only
      // constructed via a dynamic import from appointment.service.ts, so on a
      // fresh process (or an instance that never handles an appointment
      // create/reschedule/cancel call) no Worker ever existed to consume jobs
      // already sitting in Redis — running-late notifications silently never
      // fired. Importing here for its side effect guarantees the Worker is
      // live as soon as the process is up.
      import('./main/appointment-engine/services/runningLateQueue.service')
        .then(() => {
          logger.info('[RunningLateQueue] Worker initialized at boot');
        })
        .catch((error) => {
          logger.error(
            '[RunningLateQueue] Failed to initialize worker at boot',
            {
              error,
            }
          );
        });
    });
  } catch (error) {
    logger.error('Error occurred while starting the server:', error);
    process.exit(1);
  }
}
startServer();
