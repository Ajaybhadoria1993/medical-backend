import { databaseConfig } from '../configurations/dbConfig';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import logger from '../utils/logger';

/**
 * This file contains congiguration for migrate database with drizzle.
 * It takes migrations from ./src/drizzle/migrations and runs them on database
 */

// create migration client for migrating the migrations
const migrationClient = postgres({
  ...databaseConfig,
  max: 1,
});

/**
 * Run migrations
 */
async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  const isStaging = process.env.NODE_ENV === 'staging';
  const migrationsFolder = isProduction
    ? './src/drizzle/migrations/prod'
    : isStaging
      ? './src/drizzle/migrations/staging'
      : './src/drizzle/migrations/dev';

  try {
    await migrate(drizzle(migrationClient), {
      migrationsFolder,
    });
    await migrationClient.end();
  } catch (error) {
    logger.error('Error running migrations', error);
    process.exit(1);
  }
}
main();
