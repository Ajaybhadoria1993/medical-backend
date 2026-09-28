import { databaseConfig } from '../configurations/dbConfig';
import { defineConfig } from 'drizzle-kit';

const isProduction = process.env.NODE_ENV === 'production';
const isStaging = process.env.NODE_ENV === 'staging';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/main/**/models/*.model.ts', // provide the schema path for models here from features
  out: isProduction
    ? './src/drizzle/migrations/prod'
    : isStaging
      ? './src/drizzle/migrations/staging'
      : './src/drizzle/migrations/dev', // provide the migrations path
  dbCredentials: {
    ...databaseConfig, // provide the database config here from dbConfig.ts file without ssl
  },
  verbose: true,
  strict: true,
});
