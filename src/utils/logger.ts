import winston from 'winston';
import { envConfig } from './envConfig';

const { combine, timestamp, printf, colorize, align, errors, json } =
  winston.format;

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
    // Request lines already say it all in the message; their fields are for prod JSON.
    if (Object.keys(metadata).length > 0 && metadata.type !== 'request') {
      try {
        msg += `\n${safeStringify(metadata)}`;
      } catch (err) {
        msg += `\n[Serialization Error: ${err instanceof Error ? err.message : String(err)}]`;
      }
    }
    return msg;
  }
);

// Server logs ship to CloudWatch, so user/patient identifiers are masked in one place (§11).
// Not maskSensitive: that one keeps *Id fields for staff screens, and logs must drop userId.
const PII_ID_KEYS = ['userid', 'patientid', 'cachekey'];
const isPiiKey = (key: string) => {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return PII_ID_KEYS.includes(k) || /phone|mobile|email/.test(k);
};
const PII_TEXT: [RegExp, string][] = [
  [/(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, '[phone]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/((?:user|patient)(?:_?id)?[\s=:]+)[0-9a-f]{8}-[0-9a-f-]{27}/gi, '$1[id]'],
];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));

export const redactPii = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string')
    return PII_TEXT.reduce((s, [re, to]) => s.replace(re, to), value);
  if (depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redactPii(v, depth + 1));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      isPiiKey(k) ? '[redacted]' : redactPii(v, depth + 1),
    ])
  );
};

// Mutates in place: winston keeps level/splat on symbol keys that a copy would drop.
const redact = winston.format((info) => {
  for (const key of Object.keys(info)) {
    info[key] = isPiiKey(key) ? '[redacted]' : redactPii(info[key]);
  }
  return info;
});

const IS_SERVER = ['production', 'staging'].includes(envConfig.NODE_ENV);

// Servers log one JSON object per line so CloudWatch can filter on fields; Docker
// captures stdout, so no log files (they grew unrotated inside the container).
const logger = winston.createLogger({
  level: envConfig.NODE_ENV === 'development' ? 'debug' : 'info',
  // Every server line carries the deployed image tag, so errors map to a release.
  defaultMeta: IS_SERVER ? { version: envConfig.APP_VERSION } : undefined,
  format: IS_SERVER
    ? combine(errors({ stack: true }), redact(), timestamp(), json())
    : combine(
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

export default logger;
