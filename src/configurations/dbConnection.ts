import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { databaseConfig } from './dbConfig';
import { envConfig } from '../utils/envConfig';
import logger from '../utils/logger';

// for query purposes
const queryClient = postgres(databaseConfig);

// New Medicine Database Client
export const medicineQueryClient = postgres(envConfig.MEDICINE_DB_URL, {
  ssl: 'require',
  max: 10,
  idle_timeout: 10,
  connect_timeout: 10,
});

export async function pgDbConnection() {
  try {
    await queryClient`SELECT 1 + 1 AS result`;
    logger.info('Database connection successful');
  } catch (err) {
    logger.error('Database connection failed:', err);
    process.exit(1); // Optionally exit the process if the connection fails
  }
}

export async function medicineDbConnection() {
  try {
    await medicineQueryClient`SELECT 1 + 1 AS result`;
    logger.info('Medicine Database connection successful');
  } catch (err) {
    logger.error('Medicine Database connection failed:', err);
  }
}

export const database = drizzle(queryClient);
export const medicineDatabase = drizzle(medicineQueryClient);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function executeRawQuery(query: string, params: any[]) {
  try {
    const result = await queryClient.unsafe(query, params);
    return result;
  } catch (err) {
    logger.error('Error executing raw query:', err);
    throw err;
  }
}
