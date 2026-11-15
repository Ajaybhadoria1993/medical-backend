import type { database } from '../../../configurations/dbConnection';

/** The database or an open transaction: findings are saved inside the prescription save. */
export type DbOrTx =
  typeof database | Parameters<Parameters<typeof database.transaction>[0]>[0];
