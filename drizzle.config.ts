import type { Config } from 'drizzle-kit';

export default {
  schema: './src/main/**/models/*.ts',
  out: './src/drizzle/migrations',
  dialect: 'postgresql',
} satisfies Config;
