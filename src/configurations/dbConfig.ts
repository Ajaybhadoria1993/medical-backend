import { envConfig } from '../utils/envConfig';
export const databaseConfig: Readonly<{
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  ssl:
    | boolean
    | object
    | 'require'
    | 'allow'
    | 'prefer'
    | 'verify-full'
    | undefined;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  lifetime: number;
  onnotice?: (notice: any) => void;
}> = {
  host: envConfig.DB_HOST,
  user: envConfig.DB_USER,
  password: envConfig.DB_PASS,
  database: envConfig.DB_NAME,
  port: Number(envConfig.DB_PORT),
  ssl: ['localhost', 'host.docker.internal'].includes(envConfig.DB_HOST)
    ? false
    : 'require',
  max: 100,
  idleTimeoutMillis: 10_000, // Idle timeout in seconds
  connectionTimeoutMillis: 10_000, // Connection timeout in seconds
  lifetime: 30000,
  onnotice: (notice) => {
    // Only log important notices, or ignore them if they are just about existing objects
    if (
      notice.severity === 'NOTICE' &&
      (notice.code === '42P06' || notice.code === '42P07')
    ) {
      return;
    }
  },
};
