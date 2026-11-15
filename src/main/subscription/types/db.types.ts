import type { database } from '../../../configurations/dbConnection';

/** A Drizzle transaction, as handed to `database.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

/** The database or an open transaction: lets one query run inside or outside a transaction. */
export type Db = typeof database | Tx;
