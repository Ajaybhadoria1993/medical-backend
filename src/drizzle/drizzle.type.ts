import { PgTransaction } from 'drizzle-orm/pg-core';
import { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import { ExtractTablesWithRelations } from 'drizzle-orm';

export type SchemaType = {
  public: {
    users: {
      id: string;
    };
  };
};

export type PgTransactionType = PgTransaction<
  PostgresJsQueryResultHKT,
  SchemaType,
  ExtractTablesWithRelations<SchemaType>
>;
