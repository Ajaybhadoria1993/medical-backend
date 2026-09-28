/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { ReportsCustomRunDto } from '../schemas/reportsCustom.schemas';
import {
  CUSTOM_BASE_FROM,
  CUSTOM_DATA_SOURCES,
  CUSTOM_DIMENSIONS,
  CUSTOM_METRICS,
} from '../utils/reportsCustom.catalog';
import {
  CustomColumn,
  CustomReportResult,
  CustomReportRow,
  CustomReportSchema,
} from '../types/reportsCustom.types';

const MAX_GROUPS = 5000;

/**
 * Aggregate output columns are named `m_<metricId>`; dimensions `g0` / `g1`.
 *
 * The alias is quoted in SQL because Postgres folds unquoted identifiers to
 * lower case — `AS m_totalAppointments` comes back as `m_totalappointments`,
 * and every metric then reads as 0 on the client while the dimension columns
 * (already lower case) look fine.
 */
const metricAlias = (id: string) => `m_${id}`;
const quotedMetricAlias = (id: string) => `"${metricAlias(id)}"`;

function buildWhere(clinicId: string, query: ReportsCustomRunDto): SQL {
  const f = query.filters;
  const parts: SQL[] = [
    sql`a.clinic_id = ${clinicId}`,
    sql`a.appointment_date BETWEEN ${f.startDate + ' 00:00:00'} AND ${f.endDate + ' 23:59:59'}`,
  ];

  if (f.doctorId) parts.push(sql`a.doctor_id = ${f.doctorId}`);
  if (f.patientId) parts.push(sql`a.patient_id = ${f.patientId}`);
  if (f.service) parts.push(sql`cs.service_name = ${f.service}`);
  if (f.appointmentType)
    parts.push(sql`a.appointment_type = ${f.appointmentType}`);
  if (f.appointmentStatus?.length) {
    parts.push(
      sql`a.appointment_status::text IN (${sql.join(
        f.appointmentStatus.map((s) => sql`${s}`),
        sql`, `
      )})`
    );
  }
  if (f.paymentMode) parts.push(sql`p.payment_mode = ${f.paymentMode}`);
  if (f.paymentStatus === 'collected') {
    parts.push(sql`LOWER(p.payment_status) IN ('paid', 'already paid')`);
  } else if (f.paymentStatus === 'pending') {
    parts.push(sql`LOWER(p.payment_status) IN ('pending', 'credit')`);
  } else if (f.paymentStatus === 'refunded') {
    parts.push(sql`LOWER(p.payment_status) = 'refunded'`);
  }

  return sql.join(parts, sql` AND `);
}

export class ReportsCustomService {
  /** Catalogue the builder UI renders itself from. */
  static getSchema(): CustomReportSchema {
    return { dataSources: CUSTOM_DATA_SOURCES };
  }

  static async runReport(
    clinicId: string,
    query: ReportsCustomRunDto
  ): Promise<CustomReportResult> {
    const source = CUSTOM_DATA_SOURCES.find((s) => s.id === query.dataSource);
    if (!source) throw new HttpError(400, 'Unknown data source');

    const allowedMetrics = new Set(source.metrics.map((m) => m.id));
    const invalidMetric = query.metrics.find((m) => !allowedMetrics.has(m));
    if (invalidMetric) {
      throw new HttpError(
        400,
        `Metric "${invalidMetric}" is not available for the ${source.label} data source`
      );
    }

    const allowedDimensions = new Set(source.dimensions.map((d) => d.id));
    for (const dimension of [query.groupBy, query.thenBy]) {
      if (dimension && !allowedDimensions.has(dimension)) {
        throw new HttpError(
          400,
          `Grouping "${dimension}" is not available for the ${source.label} data source`
        );
      }
    }

    const groupDimensions = [query.groupBy, query.thenBy].filter(
      (d): d is string => Boolean(d)
    );
    const where = buildWhere(clinicId, query);

    const selectDimensions = groupDimensions
      .map((id, index) => `${CUSTOM_DIMENSIONS[id].expression} AS g${index}`)
      .join(', ');
    const groupByClause = groupDimensions
      .map((id) => CUSTOM_DIMENSIONS[id].expression)
      .join(', ');
    const selectMetrics = query.metrics
      .map(
        (id) => `${CUSTOM_METRICS[id].expression} AS ${quotedMetricAlias(id)}`
      )
      .join(', ');

    // Zero rows are only meaningful when the user asked for them: a doctor with
    // no appointments in the window is noise in most reports.
    const primaryMetric = query.metrics[0];
    const having = query.includeZeroValues
      ? sql``
      : sql`HAVING ${sql.raw(CUSTOM_METRICS[primaryMetric].expression)} <> 0`;

    const orderBy = this.buildOrderBy(query, groupDimensions);

    const rows: any[] = await database.execute(sql`
      SELECT ${sql.raw(selectDimensions)}, ${sql.raw(selectMetrics)}
      ${sql.raw(CUSTOM_BASE_FROM)}
      WHERE ${where}
      GROUP BY ${sql.raw(groupByClause)}
      ${having}
      ORDER BY ${sql.raw(orderBy)}
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
    `);

    const countRows: any[] = await database.execute(sql`
      SELECT COUNT(*)::int as total FROM (
        SELECT ${sql.raw(groupByClause)}
        ${sql.raw(CUSTOM_BASE_FROM)}
        WHERE ${where}
        GROUP BY ${sql.raw(groupByClause)}
        ${having}
        LIMIT ${MAX_GROUPS}
      ) grouped
    `);

    const totalsRows: any[] = await database.execute(sql`
      SELECT ${sql.raw(selectMetrics)}
      ${sql.raw(CUSTOM_BASE_FROM)}
      WHERE ${where}
    `);

    const totalRows = Number(countRows[0]?.total || 0);

    return {
      columns: this.buildColumns(groupDimensions, query.metrics),
      rows: rows.map((row) => this.mapRow(row, groupDimensions, query.metrics)),
      totals: this.mapTotals(totalsRows[0] || {}, query.metrics),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalRows,
        totalPages: Math.max(1, Math.ceil(totalRows / query.pageSize)),
      },
      appliedDefinition: {
        dataSource: query.dataSource,
        metrics: query.metrics,
        groupBy: query.groupBy,
        thenBy: query.thenBy,
        sortBy: query.sortBy || query.metrics[0],
        sortDirection: query.sortDirection,
      },
    };
  }

  /**
   * Sorting accepts either a metric or the grouping dimension. Anything else
   * falls back to the first metric rather than erroring — a stale sort key from
   * a saved definition shouldn't fail the whole report.
   */
  private static buildOrderBy(
    query: ReportsCustomRunDto,
    groupDimensions: string[]
  ): string {
    const direction = query.sortDirection === 'asc' ? 'ASC' : 'DESC';
    const requested = query.sortBy;

    if (requested && requested in CUSTOM_METRICS) {
      return `${CUSTOM_METRICS[requested].expression} ${direction} NULLS LAST`;
    }

    if (requested && groupDimensions.includes(requested)) {
      const dimension = CUSTOM_DIMENSIONS[requested];
      return `${dimension.sortExpression || dimension.expression} ${direction}`;
    }

    const fallback = CUSTOM_METRICS[query.metrics[0]];
    return `${fallback.expression} ${direction} NULLS LAST`;
  }

  private static buildColumns(
    groupDimensions: string[],
    metrics: string[]
  ): CustomColumn[] {
    const dimensionColumns: CustomColumn[] = groupDimensions.map(
      (id, index) => ({
        key: `g${index}`,
        label: CUSTOM_DIMENSIONS[id].label,
        type: 'text',
        align: 'left',
      })
    );

    const metricColumns: CustomColumn[] = metrics.map((id) => ({
      key: metricAlias(id),
      label: CUSTOM_METRICS[id].label,
      type: CUSTOM_METRICS[id].type,
      align: 'right',
    }));

    return [...dimensionColumns, ...metricColumns];
  }

  private static mapRow(
    row: any,
    groupDimensions: string[],
    metrics: string[]
  ): CustomReportRow {
    const mapped: CustomReportRow = {};
    groupDimensions.forEach((_, index) => {
      mapped[`g${index}`] = String(row[`g${index}`] ?? '—');
    });
    metrics.forEach((id) => {
      mapped[metricAlias(id)] = Number(row[metricAlias(id)] ?? 0);
    });
    return mapped;
  }

  private static mapTotals(row: any, metrics: string[]): CustomReportRow {
    const totals: CustomReportRow = {};
    metrics.forEach((id) => {
      totals[metricAlias(id)] = Number(row[metricAlias(id)] ?? 0);
    });
    return totals;
  }
}
