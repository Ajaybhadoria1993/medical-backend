import winston from 'winston';
import { envConfig } from './envConfig';

const { combine, timestamp, printf, colorize, align, errors } = winston.format;

const safeStringify = (obj: any): string => {
  const cache = new WeakSet();
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) {
          return '[Circular]';
        }
        cache.add(value);
      }
      return value;
    },
    2
  );
};

const logFormat = printf(
  ({ level, message, timestamp, stack, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (stack) {
      msg += `\n${stack}`;
    }
    if (Object.keys(metadata).length > 0) {
      try {
        msg += `\n${safeStringify(metadata)}`;
      } catch (err) {
        msg += `\n[Serialization Error: ${err instanceof Error ? err.message : String(err)}]`;
      }
    }
    return msg;
  }
);

const logger = winston.createLogger({
  level: envConfig.NODE_ENV === 'development' ? 'debug' : 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    envConfig.NODE_ENV === 'development'
      ? colorize()
      : winston.format.uncolorize(),
    align(),
    logFormat
  ),
  transports: [new winston.transports.Console()],
});

// If we're in production, we might want to log to files as well
if (envConfig.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' })
  );
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

export default logger;
