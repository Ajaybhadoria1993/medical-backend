import { databaseConfig } from '../configurations/dbConfig';
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/main/**/models/*.model.ts',
  out: './src/drizzle/_prod_real',
  dbCredentials: { ...databaseConfig },
});
