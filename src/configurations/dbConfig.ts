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
  idle_timeout: number;
  connect_timeout: number;
  max_lifetime: number;
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
  // Prod and staging share one db.t4g.micro (~80 connections), so the two pools must fit together.
  max: envConfig.NODE_ENV === 'production' ? 50 : 20,
  // postgres.js option names, all in seconds.
  idle_timeout: 10,
  connect_timeout: 10,
  max_lifetime: 60 * 30,
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
