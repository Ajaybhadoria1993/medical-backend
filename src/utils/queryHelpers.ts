/* eslint-disable @typescript-eslint/no-explicit-any */
import { asc, desc, and, or, sql, SQL } from 'drizzle-orm';

/* ======================================================
   PAGINATION - OFFSET BASED (STANDARD)
====================================================== */

export interface OffsetPaginationQuery {
  pageNumber?: number;
  pageSize?: number;
}

export interface PaginationResult {
  limit: number;
  offset: number;
  pageSize: number;
  pageNumber: number;
}

/**
 * Calculate offset-based pagination parameters
 * @param query - Query parameters containing pageNumber and pageSize
 * @param maxPageSize - Maximum allowed page size (default: 100)
 * @returns Pagination parameters with limit, offset, pageSize, and pageNumber
 */
export function getOffsetPagination(
  query: OffsetPaginationQuery & { page?: string },
  maxPageSize = 100
): PaginationResult {
  const pageSize = Math.min(
    Math.max(Number(query?.pageSize) || 10, 1),
    maxPageSize
  );

  const pageNumber = Math.max(Number(query?.page ?? query?.pageNumber) || 1, 1);

  return {
    limit: pageSize,
    offset: (pageNumber - 1) * pageSize,
    pageSize,
    pageNumber,
  };
}

/* ======================================================
   PAGINATION - BATCH WISE
====================================================== */

export interface BatchPaginationQuery {
  batchNumber?: number;
  batchSize?: number;
}

export interface BatchPaginationResult {
  limit: number;
  offset: number;
  batchSize: number;
  batchNumber: number;
  recordsPerBatch: number;
}

/**
 * Calculate batch-wise pagination (e.g., 100 records per batch)
 * @param query - Query parameters containing batchNumber and batchSize
 * @param recordsPerBatch - Number of records per batch (default: 100)
 * @returns Batch pagination parameters
 *
 * @example
 * // Batch 1: records 1-100
 * // Batch 2: records 101-200
 * getBatchPagination({ batchNumber: 1 }) // returns { offset: 0, limit: 100, ... }
 * getBatchPagination({ batchNumber: 2 }) // returns { offset: 100, limit: 100, ... }
 */
export function getBatchPagination(
  query: BatchPaginationQuery,
  recordsPerBatch: number = 100
): BatchPaginationResult {
  const batchSize = Math.max(Number(query?.batchSize) || recordsPerBatch, 1);
  const batchNumber = Math.max(Number(query?.batchNumber) || 1, 1);

  return {
    limit: batchSize,
    offset: (batchNumber - 1) * batchSize,
    batchSize,
    batchNumber,
    recordsPerBatch: batchSize,
  };
}

/* ======================================================
   PAGINATION - CURSOR BASED (REAL-TIME)
====================================================== */

export interface CursorPaginationQuery {
  cursor?: string | number | Date;
  pageSize?: number;
}

export interface CursorPaginationResult {
  limit: number;
  cursor: string | number | Date | null;
}

/**
 * Calculate cursor-based pagination for real-time data
 * @param query - Query parameters containing cursor and pageSize
 * @param maxPageSize - Maximum allowed page size (default: 100)
 * @returns Cursor pagination parameters
 */
export function getCursorPagination(
  query: CursorPaginationQuery,
  maxPageSize: number = 100
): CursorPaginationResult {
  const pageSize = Math.min(
    Math.max(Number(query?.pageSize) || 10, 1),
    maxPageSize
  );

  return {
    limit: pageSize,
    cursor: query?.cursor ?? null,
  };
}

/* ======================================================
   SORTING (SAFE & CONTROLLED)
====================================================== */

export type SortOrder = 'asc' | 'desc';

export interface SortingQuery {
  sortBy?: string;
  sortOrder?: SortOrder;
}

export interface MultiSortingQuery {
  sortFields?: Array<{ field: string; order: SortOrder }>;
}

/**
 * Build sorting clause for a single column
 * @param allowedColumns - Map of allowed column names to columns
 * @param sortBy - Column name to sort by
 * @param sortOrder - Sort direction ('asc' or 'desc')
 * @returns Array of SQL sorting clauses
 *
 * @example
 * const allowedColumns = {
 *   name: UserModel.name,
 *   createdAt: UserModel.createdAt
 * };
 * getSorting(allowedColumns, 'name', 'asc');
 */
export function getSorting<T extends Record<string, any>>(
  allowedColumns: T,
  sortBy?: keyof T,
  sortOrder: SortOrder = 'desc'
): SQL[] {
  if (!sortBy) return [];

  const column = allowedColumns[sortBy];
  if (!column) return [];

  return [sortOrder === 'asc' ? asc(column) : desc(column)];
}

/**
 * Build sorting clause for multiple columns
 * @param allowedColumns - Map of allowed column names to columns
 * @param sortFields - Array of fields with their sort orders
 * @returns Array of SQL sorting clauses
 *
 * @example
 * const allowedColumns = {
 *   name: UserModel.name,
 *   createdAt: UserModel.createdAt
 * };
 * getMultiSorting(allowedColumns, [
 *   { field: 'name', order: 'asc' },
 *   { field: 'createdAt', order: 'desc' }
 * ]);
 */
export function getMultiSorting<T extends Record<string, any>>(
  allowedColumns: T,
  sortFields?: Array<{ field: keyof T; order: SortOrder }>
): SQL[] {
  if (!sortFields || sortFields.length === 0) return [];

  const sortClauses: SQL[] = [];

  for (const { field, order } of sortFields) {
    const column = allowedColumns[field];
    if (column) {
      sortClauses.push(order === 'asc' ? asc(column) : desc(column));
    }
  }

  return sortClauses;
}

/* ======================================================
   SEARCH (MULTI-TERM, MULTI-FIELD, SAFE)
====================================================== */

export interface SearchQuery {
  search?: string;
  searchBy?: string; // For special search modes
}

/**
 * Escape special characters in LIKE patterns
 * @param str - String to escape
 * @returns Escaped string safe for LIKE queries
 */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/**
 * Build search condition across multiple columns
 * @param search - Search term(s)
 * @param columns - Array of columns to search in
 * @param maxTerms - Maximum number of search terms to process (default: 5)
 * @returns SQL condition for searching
 *
 * @example
 * buildSearchCondition('john doe', [
 *   UserModel.name,
 *   UserModel.email,
 *   UserModel.mobile
 * ]);
 * // Searches for records where (name OR email OR mobile) contains 'john'
 * // AND (name OR email OR mobile) contains 'doe'
 */
export function buildSearchCondition(
  search: string | undefined,
  columns: any[],
  maxTerms: number = 5
): SQL | undefined {
  if (!search || !search.trim()) return;

  const terms = search.trim().split(/\s+/).slice(0, maxTerms);

  const conditions = terms.map((term) => {
    const escaped = escapeLike(term);
    const pattern = `%${escaped.toLowerCase()}%`;

    return or(
      ...columns.map((col) => sql`lower(${col}::text) LIKE ${pattern}`)
    );
  });

  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

/**
 * Build search condition with exact match option
 * @param search - Search term
 * @param columns - Array of columns to search in
 * @param exactMatch - If true, uses = instead of LIKE
 * @returns SQL condition for searching
 */
export function buildSearchConditionExact(
  search: string | undefined,
  columns: any[],
  exactMatch: boolean = false
): SQL | undefined {
  if (!search || !search.trim()) return;

  if (exactMatch) {
    return or(...columns.map((col) => sql`${col} = ${search}`));
  }

  return buildSearchCondition(search, columns);
}

/* ======================================================
   TOTAL COUNT (WITH JOIN SUPPORT)
====================================================== */

export interface JoinConfig {
  table: any;
  on: SQL;
  type?: 'left' | 'inner' | 'right';
}

/**
 * Get total count of records matching conditions
 * @param trx - Database transaction or connection
 * @param table - Main table to count from
 * @param whereCondition - WHERE clause conditions
 * @param joins - Optional array of join configurations
 * @param distinctOn - Optional column for DISTINCT counting
 * @returns Total count of matching records
 *
 * @example
 * await getTotalCount(
 *   trx,
 *   UserModel,
 *   eq(UserModel.userType, 'Patient'),
 *   [{ table: AppointmentModel, on: eq(UserModel.id, AppointmentModel.patientId) }],
 *   UserModel.id
 * );
 */
export async function getTotalCount(
  trx: any,
  table: any,
  whereCondition: SQL | undefined,
  joins: JoinConfig[] = [],
  distinctOn?: SQL
): Promise<number> {
  let query = trx
    .select({
      count: distinctOn ? sql`COUNT(DISTINCT ${distinctOn})` : sql`COUNT(*)`,
    })
    .from(table);

  for (const join of joins) {
    const joinType = join.type || 'left';
    if (joinType === 'left') {
      query = query.leftJoin(join.table, join.on);
    } else if (joinType === 'inner') {
      query = query.innerJoin(join.table, join.on);
    } else if (joinType === 'right') {
      query = query.rightJoin(join.table, join.on);
    }
  }

  if (whereCondition) {
    query = query.where(whereCondition);
  }

  const result = await query;
  return Number(result?.[0]?.count ?? 0);
}

/* ======================================================
   HELPER: COMBINE WHERE CONDITIONS SAFELY
====================================================== */

/**
 * Safely combine multiple WHERE conditions with AND
 * @param conditions - Array of SQL conditions (undefined values are filtered out)
 * @returns Combined SQL condition or undefined if no valid conditions
 *
 * @example
 * buildWhere([
 *   eq(UserModel.userType, 'Patient'),
 *   query.search ? buildSearchCondition(query.search, [...]) : undefined,
 *   query.status ? eq(UserModel.status, query.status) : undefined
 * ]);
 */
export function buildWhere(conditions: (SQL | undefined)[]): SQL | undefined {
  const valid = conditions.filter(Boolean) as SQL[];
  return valid.length ? and(...valid) : undefined;
}

/* ======================================================
   PAGINATION METADATA BUILDER
====================================================== */

export interface PaginationMeta {
  totalRecords: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface BatchPaginationMeta extends PaginationMeta {
  batchNumber: number;
  totalBatches: number;
  recordsPerBatch: number;
}

/**
 * Build pagination metadata for API responses
 * @param totalRecords - Total number of records
 * @param pageNumber - Current page number
 * @param pageSize - Records per page
 * @returns Pagination metadata object
 */
export function buildPaginationMeta(
  totalRecords: number,
  pageNumber: number,
  pageSize: number
): PaginationMeta {
  const totalPages =
    totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize);

  return {
    totalRecords,
    totalPages,
    currentPage: pageNumber,
    pageSize,
    hasNextPage: pageNumber < totalPages,
    hasPreviousPage: pageNumber > 1,
  };
}

/**
 * Build batch pagination metadata for API responses
 * @param totalRecords - Total number of records
 * @param batchNumber - Current batch number
 * @param batchSize - Records per batch
 * @returns Batch pagination metadata object
 */
export function buildBatchPaginationMeta(
  totalRecords: number,
  batchNumber: number,
  batchSize: number
): BatchPaginationMeta {
  const totalBatches =
    totalRecords === 0 ? 0 : Math.ceil(totalRecords / batchSize);
  const totalPages = totalBatches;

  return {
    totalRecords,
    totalPages,
    totalBatches,
    currentPage: batchNumber,
    pageSize: batchSize,
    batchNumber,
    recordsPerBatch: batchSize,
    hasNextPage: batchNumber < totalBatches,
    hasPreviousPage: batchNumber > 1,
  };
}

/* ======================================================
   UNIFIED QUERY BUILDER
====================================================== */

export interface UnifiedQueryParams
  extends OffsetPaginationQuery,
    SortingQuery,
    SearchQuery {
  // Combines all query parameters
}

export interface UnifiedQueryResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface UnifiedBatchQueryParams
  extends BatchPaginationQuery,
    SortingQuery,
    SearchQuery {
  // Combines all query parameters for batch pagination
}

export interface UnifiedBatchQueryResult<T> {
  data: T[];
  pagination: BatchPaginationMeta;
}
