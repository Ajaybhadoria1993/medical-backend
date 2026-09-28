/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { pharmacyMedicineModel } from '../../pharmacies/models/pharmacyMedicine.model';
import { PharmacySalesModel } from '../../pharmacies/models/pharmacySales.model';
import { PharmacySalesItemsModel } from '../../pharmacies/models/pharmacySalesItems.model';
import { PharmacySalesReturnItemsModel } from '../../pharmacies/models/pharmacySalesReturn.model';
import { PharmacyStockModel } from '../../pharmacies/models/pharmacyStock.model';
import { PharmacyStockMedicineModel } from '../../pharmacies/models/pharmacyStockMedicine.model';
import { PharmacySupplierModel } from '../../pharmacies/models/pharmacySupplier.model';
import {
  ReportsMedicinesQueryDto,
  ReportsMedicinesTrendQueryDto,
} from '../schemas/reportsMedicines.schemas';
import {
  DateRange,
  buildComparisonRange,
  calcChange,
  generateSlots,
  mapValuesToSlots,
  padComparisonSlots,
  toPercentage,
} from '../utils/reportsPeriod.utils';
import {
  ReportsMedicinesData,
  MedicineMetricItem,
} from '../types/reportsMedicines.types';

const CACHE_TTL = 120;

const EXPIRY_WINDOW_DAYS = 30;

/**
 * A medicine is fast/slow moving relative to the rest of the catalogue in the
 * selected window rather than against a fixed unit threshold, which would mean
 * something different for a busy chain than for a single counter.
 */
const FAST_MOVING_PERCENTILE = 0.8;
const SLOW_MOVING_PERCENTILE = 0.2;

type AnyMedicinesQuery =
  ReportsMedicinesQueryDto | ReportsMedicinesTrendQueryDto;

/**
 * Stock is never decremented on sale — a batch's remaining quantity is derived
 * as purchased - sold + returned, clamped at zero. Same formula the pharmacy
 * dashboard uses (`pharmacies/services/dashboardAnalytics.service.ts`); the two
 * must not drift.
 */
const availableQty = sql`GREATEST(
  COALESCE(${PharmacyStockMedicineModel.quantity}, 0)
  - COALESCE(sold.qty, 0)
  + COALESCE(returned.qty, 0),
  0
)`;

const SOLD_PER_BATCH = sql`
  LEFT JOIN (
    SELECT ${PharmacySalesItemsModel.pharmacyStockMedicineId} AS batch_id,
           SUM(${PharmacySalesItemsModel.quantity}) AS qty
    FROM ${PharmacySalesItemsModel}
    GROUP BY ${PharmacySalesItemsModel.pharmacyStockMedicineId}
  ) sold ON sold.batch_id = ${PharmacyStockMedicineModel.id}
  LEFT JOIN (
    SELECT ${PharmacySalesReturnItemsModel.stockMedicineId} AS batch_id,
           SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS qty
    FROM ${PharmacySalesReturnItemsModel}
    GROUP BY ${PharmacySalesReturnItemsModel.stockMedicineId}
  ) returned ON returned.batch_id = ${PharmacyStockMedicineModel.id}
`;

/** Returned quantity per sales item, for netting sales off inside a date range. */
const RETURNED_PER_ITEM = sql`
  LEFT JOIN (
    SELECT ${PharmacySalesReturnItemsModel.salesItemId} AS sales_item_id,
           SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS qty
    FROM ${PharmacySalesReturnItemsModel}
    GROUP BY ${PharmacySalesReturnItemsModel.salesItemId}
  ) item_returns ON item_returns.sales_item_id = ${PharmacySalesItemsModel.id}
`;

const NET_UNITS = sql`(COALESCE(${PharmacySalesItemsModel.quantity}, 0) - COALESCE(item_returns.qty, 0))`;

function pharmacyScope(clinicId: string, query: AnyMedicinesQuery): SQL {
  if (query.pharmacyId) {
    return sql`(SELECT ${PharmacyModel.id} FROM ${PharmacyModel}
      WHERE ${PharmacyModel.id} = ${query.pharmacyId}
        AND ${PharmacyModel.clinicId} = ${clinicId}
        AND ${PharmacyModel.isDeleted} = false)`;
  }
  return sql`(SELECT ${PharmacyModel.id} FROM ${PharmacyModel}
    WHERE ${PharmacyModel.clinicId} = ${clinicId}
      AND ${PharmacyModel.isDeleted} = false)`;
}

function categoryFilter(query: AnyMedicinesQuery): SQL {
  return query.category
    ? sql`AND ${pharmacyMedicineModel.category} = ${query.category}`
    : sql``;
}

function supplierFilter(query: AnyMedicinesQuery): SQL {
  return query.supplierId
    ? sql`AND ${PharmacyStockModel.pharmacySupplierId} = ${query.supplierId}`
    : sql``;
}

function buildCacheKey(
  clinicId: string,
  query: ReportsMedicinesQueryDto
): string {
  return [
    'reports:medicines',
    clinicId,
    query.startDate,
    query.endDate,
    query.compareStartDate || 'auto',
    query.compareEndDate || 'auto',
    query.category || 'all',
    query.supplierId || 'all',
    query.pharmacyId || 'all',
  ].join(':');
}

function buildTrendCacheKey(
  clinicId: string,
  query: ReportsMedicinesTrendQueryDto
): string {
  return [
    'reports:medicines:trend',
    clinicId,
    query.type,
    query.period,
    query.startDate,
    query.endDate,
    query.category || 'all',
    query.supplierId || 'all',
    query.pharmacyId || 'all',
  ].join(':');
}

function metric(current: number, previous: number): MedicineMetricItem {
  const { change, changeType } = calcChange(current, previous);
  return { value: Math.round(current), change, changeType };
}

/** Point-in-time counts (stock levels) have no comparison window to move against. */
function snapshotMetric(value: number): MedicineMetricItem {
  return { value: Math.round(value), change: 0, changeType: 'neutral' };
}

function percentileThreshold(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(percentile * (sorted.length - 1)))
  );
  return sorted[index];
}

export class ReportsMedicinesService {
  static async getMedicineReports(
    clinicId: string,
    query: ReportsMedicinesQueryDto
  ): Promise<ReportsMedicinesData> {
    const cacheKey = buildCacheKey(clinicId, query);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('[ReportsMedicines] Cache HIT');
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsMedicines] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);

    const [
      currentSales,
      previousSales,
      salesTrend,
      salesByCategory,
      salesByFormulation,
      topSellingMedicines,
      inventory,
      expiringSoon,
      topSuppliers,
    ] = await Promise.all([
      this.getSalesTotals(clinicId, primary, query),
      this.getSalesTotals(clinicId, comparison, query),
      this.getSalesTrend(clinicId, primary, comparison, query, 'auto', 'sales'),
      this.getSalesByCategory(clinicId, primary, query),
      this.getSalesByFormulation(clinicId, primary, query),
      this.getTopSellingMedicines(clinicId, primary, query),
      this.getInventory(clinicId, primary, query),
      this.getExpiringSoon(clinicId, query),
      this.getTopSuppliers(clinicId, primary, query),
    ]);

    const result: ReportsMedicinesData = {
      metrics: {
        totalMedicines: snapshotMetric(inventory.totalMedicines),
        unitsSold: metric(currentSales.units, previousSales.units),
        salesAmount: metric(currentSales.revenue, previousSales.revenue),
        grossProfit: metric(currentSales.profit, previousSales.profit),
        lowStockItems: snapshotMetric(inventory.lowStockMedicines.length),
        expiringItems: snapshotMetric(inventory.expiringCount),
      },
      salesTrend,
      salesByCategory,
      salesByFormulation,
      topSellingMedicines,
      lowStockMedicines: inventory.lowStockMedicines.slice(0, 5),
      expiringSoon,
      topSuppliers,
      inventorySummary: inventory.summary,
      insights: this.buildInsights(
        topSellingMedicines,
        inventory,
        currentSales,
        previousSales
      ),
    };

    try {
      await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    } catch (err) {
      logger.warn('[ReportsMedicines] Redis write error', err);
    }

    return result;
  }

  static async getMedicineTrendData(
    clinicId: string,
    query: ReportsMedicinesTrendQueryDto
  ) {
    const cacheKey = buildTrendCacheKey(clinicId, query);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('[ReportsMedicines] Trend Cache HIT');
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[ReportsMedicines] Redis read error', err);
    }

    const { primary, comparison } = buildComparisonRange(query);
    const result = await this.getSalesTrend(
      clinicId,
      primary,
      comparison,
      query,
      query.period,
      query.type
    );

    try {
      await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    } catch (err) {
      logger.warn('[ReportsMedicines] Redis write error', err);
    }

    return result;
  }

  /**
   * Revenue, units and profit are all netted against sales returns, and cost
   * comes from the batch the item was actually sold from — so profit reflects
   * the purchase price of that batch, not a current average.
   */
  private static async getSalesTotals(
    clinicId: string,
    range: DateRange,
    query: ReportsMedicinesQueryDto
  ) {
    const scope = pharmacyScope(clinicId, query);

    const rows: any[] = await database.execute(sql`
      SELECT
        COALESCE(SUM(${NET_UNITS} * COALESCE(${PharmacyStockMedicineModel.mrp}, 0)), 0) as revenue,
        COALESCE(SUM(${NET_UNITS}), 0) as units,
        COALESCE(SUM(${NET_UNITS} * COALESCE(${PharmacyStockMedicineModel.cost}, 0)), 0) as cost
      FROM ${PharmacySalesItemsModel}
      INNER JOIN ${PharmacySalesModel} ON ${PharmacySalesModel.id} = ${PharmacySalesItemsModel.pharmacySalesId}
      INNER JOIN ${PharmacyStockMedicineModel} ON ${PharmacyStockMedicineModel.id} = ${PharmacySalesItemsModel.pharmacyStockMedicineId}
      INNER JOIN ${pharmacyMedicineModel} ON ${pharmacyMedicineModel.id} = ${PharmacyStockMedicineModel.pharmacyMedicineId}
      LEFT JOIN ${PharmacyStockModel} ON ${PharmacyStockModel.id} = ${PharmacyStockMedicineModel.pharmacyStockId}
      ${RETURNED_PER_ITEM}
      WHERE ${PharmacySalesModel.pharmacyId} IN ${scope}
        AND ${PharmacySalesModel.createdAt} BETWEEN ${range.start} AND ${range.end}
        ${categoryFilter(query)} ${supplierFilter(query)}
    `);

    const row = rows[0] || {};
    const revenue = Number(row.revenue || 0);
    const cost = Number(row.cost || 0);

    return {
      revenue,
      units: Number(row.units || 0),
      profit: revenue - cost,
    };
  }

  private static async getSalesTrend(
    clinicId: string,
    primary: DateRange,
    comparison: DateRange,
    query: AnyMedicinesQuery,
    period: string,
    type: 'sales' | 'units'
  ) {
    const durationDays = Math.ceil(
      (new Date(primary.end).getTime() - new Date(primary.start).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const truncUnit =
      period === 'monthly' || (period === 'auto' && durationDays > 30)
        ? 'week'
        : 'day';

    const primarySlots = generateSlots(primary.start, primary.end, period);
    const comparisonSlots = padComparisonSlots(
      primarySlots,
      generateSlots(comparison.start, comparison.end, period)
    );

    const scope = pharmacyScope(clinicId, query);
    const valueExpr =
      type === 'units'
        ? sql`SUM(${NET_UNITS})`
        : sql`SUM(${NET_UNITS} * COALESCE(${PharmacyStockMedicineModel.mrp}, 0))`;

    const rangeRows = (range: DateRange) =>
      database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${PharmacySalesModel.createdAt}) as dt,
        COALESCE(${valueExpr}, 0) as value
      FROM ${PharmacySalesItemsModel}
      INNER JOIN ${PharmacySalesModel} ON ${PharmacySalesModel.id} = ${PharmacySalesItemsModel.pharmacySalesId}
      INNER JOIN ${PharmacyStockMedicineModel} ON ${PharmacyStockMedicineModel.id} = ${PharmacySalesItemsModel.pharmacyStockMedicineId}
      INNER JOIN ${pharmacyMedicineModel} ON ${pharmacyMedicineModel.id} = ${PharmacyStockMedicineModel.pharmacyMedicineId}
      LEFT JOIN ${PharmacyStockModel} ON ${PharmacyStockModel.id} = ${PharmacyStockMedicineModel.pharmacyStockId}
      ${RETURNED_PER_ITEM}
      WHERE ${PharmacySalesModel.pharmacyId} IN ${scope}
        AND ${PharmacySalesModel.createdAt} BETWEEN ${range.start} AND ${range.end}
        ${categoryFilter(query)} ${supplierFilter(query)}
      GROUP BY dt
      ORDER BY dt
    `);

    const [curRows, prevRows] = (await Promise.all([
      rangeRows(primary),
      rangeRows(comparison),
    ])) as any[][];

    return {
      labels: primarySlots.map((s) => s.label),
      currentPeriod: mapValuesToSlots(curRows, primarySlots, truncUnit),
      previousPeriod: mapValuesToSlots(prevRows, comparisonSlots, truncUnit),
    };
  }

  private static async getSalesByCategory(
    clinicId: string,
    primary: DateRange,
    query: ReportsMedicinesQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        COALESCE(NULLIF(${pharmacyMedicineModel.category}, ''), 'Uncategorised') as label,
        COALESCE(SUM(${NET_UNITS} * COALESCE(${PharmacyStockMedicineModel.mrp}, 0)), 0) as value
      FROM ${PharmacySalesItemsModel}
      INNER JOIN ${PharmacySalesModel} ON ${PharmacySalesModel.id} = ${PharmacySalesItemsModel.pharmacySalesId}
      INNER JOIN ${PharmacyStockMedicineModel} ON ${PharmacyStockMedicineModel.id} = ${PharmacySalesItemsModel.pharmacyStockMedicineId}
      INNER JOIN ${pharmacyMedicineModel} ON ${pharmacyMedicineModel.id} = ${PharmacyStockMedicineModel.pharmacyMedicineId}
      LEFT JOIN ${PharmacyStockModel} ON ${PharmacyStockModel.id} = ${PharmacyStockMedicineModel.pharmacyStockId}
      ${RETURNED_PER_ITEM}
      WHERE ${PharmacySalesModel.pharmacyId} IN ${pharmacyScope(clinicId, query)}
        AND ${PharmacySalesModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
        ${categoryFilter(query)} ${supplierFilter(query)}
      GROUP BY label
      ORDER BY value DESC
    `);

    return this.toDistribution(rows, 5);
  }

  private static async getSalesByFormulation(
    clinicId: string,
    primary: DateRange,
    query: ReportsMedicinesQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        COALESCE(NULLIF(${pharmacyMedicineModel.form}, ''), 'Other') as label,
        COALESCE(SUM(${NET_UNITS}), 0) as value
      FROM ${PharmacySalesItemsModel}
      INNER JOIN ${PharmacySalesModel} ON ${PharmacySalesModel.id} = ${PharmacySalesItemsModel.pharmacySalesId}
      INNER JOIN ${PharmacyStockMedicineModel} ON ${PharmacyStockMedicineModel.id} = ${PharmacySalesItemsModel.pharmacyStockMedicineId}
      INNER JOIN ${pharmacyMedicineModel} ON ${pharmacyMedicineModel.id} = ${PharmacyStockMedicineModel.pharmacyMedicineId}
      LEFT JOIN ${PharmacyStockModel} ON ${PharmacyStockModel.id} = ${PharmacyStockMedicineModel.pharmacyStockId}
      ${RETURNED_PER_ITEM}
      WHERE ${PharmacySalesModel.pharmacyId} IN ${pharmacyScope(clinicId, query)}
        AND ${PharmacySalesModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
        ${categoryFilter(query)} ${supplierFilter(query)}
      GROUP BY label
      ORDER BY value DESC
    `);

    return this.toDistribution(rows, 5);
  }

  private static async getTopSellingMedicines(
    clinicId: string,
    primary: DateRange,
    query: ReportsMedicinesQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        ${pharmacyMedicineModel.medicineName} as medicine_name,
        COALESCE(SUM(${NET_UNITS}), 0) as units,
        COALESCE(SUM(${NET_UNITS} * COALESCE(${PharmacyStockMedicineModel.mrp}, 0)), 0) as amount
      FROM ${PharmacySalesItemsModel}
      INNER JOIN ${PharmacySalesModel} ON ${PharmacySalesModel.id} = ${PharmacySalesItemsModel.pharmacySalesId}
      INNER JOIN ${PharmacyStockMedicineModel} ON ${PharmacyStockMedicineModel.id} = ${PharmacySalesItemsModel.pharmacyStockMedicineId}
      INNER JOIN ${pharmacyMedicineModel} ON ${pharmacyMedicineModel.id} = ${PharmacyStockMedicineModel.pharmacyMedicineId}
      LEFT JOIN ${PharmacyStockModel} ON ${PharmacyStockModel.id} = ${PharmacyStockMedicineModel.pharmacyStockId}
      ${RETURNED_PER_ITEM}
      WHERE ${PharmacySalesModel.pharmacyId} IN ${pharmacyScope(clinicId, query)}
        AND ${PharmacySalesModel.createdAt} BETWEEN ${primary.start} AND ${primary.end}
        ${categoryFilter(query)} ${supplierFilter(query)}
      GROUP BY medicine_name
      HAVING SUM(${NET_UNITS}) > 0
      ORDER BY units DESC
      LIMIT 5
    `);

    return rows.map((r) => ({
      medicineName: String(r.medicine_name),
      unitsSold: Number(r.units || 0),
      salesAmount: Math.round(Number(r.amount || 0)),
    }));
  }

  /**
   * One pass over the catalogue: current stock per medicine, its value, units
   * sold in the window, and the expiring-batch count. Everything the inventory
   * summary, the low-stock table and three of the metric cards need.
   */
  private static async getInventory(
    clinicId: string,
    primary: DateRange,
    query: ReportsMedicinesQueryDto
  ) {
    const scope = pharmacyScope(clinicId, query);

    const rows: any[] = await database.execute(sql`
      SELECT
        ${pharmacyMedicineModel.id} as medicine_id,
        ${pharmacyMedicineModel.medicineName} as medicine_name,
        COALESCE(${pharmacyMedicineModel.reorder}, 0) as reorder_level,
        COALESCE(SUM(${availableQty}), 0) as available,
        COALESCE(SUM(${availableQty} * COALESCE(${PharmacyStockMedicineModel.cost}, 0)), 0) as stock_value,
        COUNT(DISTINCT ${PharmacyStockMedicineModel.id}) FILTER (
          WHERE ${PharmacyStockMedicineModel.expiry} >= NOW()
            AND ${PharmacyStockMedicineModel.expiry} <= NOW() + INTERVAL '${sql.raw(String(EXPIRY_WINDOW_DAYS))} days'
            AND ${availableQty} > 0
        ) as expiring_batches,
        COALESCE((
          SELECT SUM(psi.quantity)
          FROM ${PharmacySalesItemsModel} psi
          INNER JOIN ${PharmacySalesModel} ps ON ps.id = psi.pharmacy_sales_id
          INNER JOIN ${PharmacyStockMedicineModel} psm ON psm.id = psi.pharmacy_stock_medicine_id
          WHERE psm.pharmacy_medicine_id = ${pharmacyMedicineModel.id}
            AND ps.created_at BETWEEN ${primary.start} AND ${primary.end}
        ), 0) as sold_in_range
      FROM ${pharmacyMedicineModel}
      LEFT JOIN ${PharmacyStockMedicineModel} ON ${PharmacyStockMedicineModel.pharmacyMedicineId} = ${pharmacyMedicineModel.id}
      LEFT JOIN ${PharmacyStockModel} ON ${PharmacyStockModel.id} = ${PharmacyStockMedicineModel.pharmacyStockId}
      ${SOLD_PER_BATCH}
      WHERE ${pharmacyMedicineModel.pharmacyId} IN ${scope}
        AND ${pharmacyMedicineModel.status} = 'active'
        ${categoryFilter(query)} ${supplierFilter(query)}
      GROUP BY ${pharmacyMedicineModel.id}, ${pharmacyMedicineModel.medicineName}, ${pharmacyMedicineModel.reorder}
    `);

    const medicines = rows.map((r) => ({
      name: String(r.medicine_name),
      reorder: Number(r.reorder_level || 0),
      available: Number(r.available || 0),
      value: Number(r.stock_value || 0),
      expiringBatches: Number(r.expiring_batches || 0),
      sold: Number(r.sold_in_range || 0),
    }));

    const lowStockMedicines = medicines
      .filter((m) => m.reorder > 0 && m.available <= m.reorder)
      .sort((a, b) => a.available - b.available)
      .map((m) => ({
        medicineName: m.name,
        currentStock: m.available,
        reorderLevel: m.reorder,
      }));

    const soldValues = medicines.map((m) => m.sold);
    const fastThreshold = percentileThreshold(
      soldValues,
      FAST_MOVING_PERCENTILE
    );
    const slowThreshold = percentileThreshold(
      soldValues,
      SLOW_MOVING_PERCENTILE
    );

    const total = medicines.length;
    const deadStock = medicines.filter(
      (m) => m.sold === 0 && m.available > 0
    ).length;
    const fastMoving = medicines.filter(
      (m) => m.sold > 0 && m.sold >= fastThreshold
    ).length;
    const slowMoving = medicines.filter(
      (m) => m.sold > 0 && m.sold <= slowThreshold
    ).length;

    return {
      totalMedicines: total,
      lowStockMedicines,
      expiringCount: medicines.reduce((sum, m) => sum + m.expiringBatches, 0),
      summary: {
        totalStockValue: Math.round(
          medicines.reduce((sum, m) => sum + m.value, 0)
        ),
        totalStockUnits: medicines.reduce((sum, m) => sum + m.available, 0),
        fastMoving: {
          count: fastMoving,
          percentage: toPercentage(fastMoving, total),
        },
        slowMoving: {
          count: slowMoving,
          percentage: toPercentage(slowMoving, total),
        },
        deadStock: {
          count: deadStock,
          percentage: toPercentage(deadStock, total),
        },
      },
    };
  }

  private static async getExpiringSoon(
    clinicId: string,
    query: ReportsMedicinesQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        ${pharmacyMedicineModel.medicineName} as medicine_name,
        COALESCE(${PharmacyStockMedicineModel.batch}, '—') as batch,
        ${PharmacyStockMedicineModel.expiry} as expiry,
        DATE_PART('day', ${PharmacyStockMedicineModel.expiry} - NOW())::int as days_left,
        ${availableQty} as available
      FROM ${PharmacyStockMedicineModel}
      INNER JOIN ${pharmacyMedicineModel} ON ${pharmacyMedicineModel.id} = ${PharmacyStockMedicineModel.pharmacyMedicineId}
      LEFT JOIN ${PharmacyStockModel} ON ${PharmacyStockModel.id} = ${PharmacyStockMedicineModel.pharmacyStockId}
      ${SOLD_PER_BATCH}
      WHERE ${pharmacyMedicineModel.pharmacyId} IN ${pharmacyScope(clinicId, query)}
        AND ${PharmacyStockMedicineModel.expiry} >= NOW()
        AND ${PharmacyStockMedicineModel.expiry} <= NOW() + INTERVAL '${sql.raw(String(EXPIRY_WINDOW_DAYS))} days'
        AND ${availableQty} > 0
        ${categoryFilter(query)} ${supplierFilter(query)}
      ORDER BY ${PharmacyStockMedicineModel.expiry} ASC
      LIMIT 5
    `);

    return rows.map((r) => ({
      medicineName: String(r.medicine_name),
      batch: String(r.batch),
      expiryDate: r.expiry ? new Date(r.expiry).toISOString() : '',
      daysLeft: Number(r.days_left || 0),
      quantity: Number(r.available || 0),
    }));
  }

  private static async getTopSuppliers(
    clinicId: string,
    primary: DateRange,
    query: ReportsMedicinesQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        ${PharmacyStockModel.pharmacySupplierId} as supplier_id,
        COALESCE(${PharmacySupplierModel.supplierName}, 'Unassigned') as label,
        COALESCE(SUM(CAST(COALESCE(${PharmacyStockModel.totalAmount}, '0') AS NUMERIC)), 0) as value
      FROM ${PharmacyStockModel}
      LEFT JOIN ${PharmacySupplierModel} ON ${PharmacySupplierModel.id} = ${PharmacyStockModel.pharmacySupplierId}
      WHERE ${PharmacyStockModel.pharmacyId} IN ${pharmacyScope(clinicId, query)}
        AND ${PharmacyStockModel.purchaseDate} BETWEEN ${primary.start} AND ${primary.end}
        ${supplierFilter(query)}
      GROUP BY supplier_id, label
      ORDER BY value DESC
      LIMIT 5
    `);

    const total = rows.reduce((sum, r) => sum + Number(r.value), 0);

    return rows.map((r) => ({
      supplierId: r.supplier_id || '',
      supplierName: String(r.label),
      purchaseAmount: Math.round(Number(r.value || 0)),
      percentage: toPercentage(Number(r.value || 0), total),
    }));
  }

  private static buildInsights(
    topSelling: Array<{ medicineName: string }>,
    inventory: {
      lowStockMedicines: unknown[];
      expiringCount: number;
      summary: { deadStock: { count: number } };
    },
    current: { revenue: number },
    previous: { revenue: number }
  ): string[] {
    const insights: string[] = [];

    if (topSelling[0]) {
      insights.push(
        `${topSelling[0].medicineName} is the top selling medicine this period.`
      );
    }
    if (inventory.lowStockMedicines.length > 0) {
      insights.push(
        `${inventory.lowStockMedicines.length} medicines are at or below reorder level.`
      );
    }
    if (inventory.expiringCount > 0) {
      insights.push(
        `${inventory.expiringCount} batches expire within the next ${EXPIRY_WINDOW_DAYS} days.`
      );
    }
    if (current.revenue > 0 || previous.revenue > 0) {
      const { change, changeType } = calcChange(
        current.revenue,
        previous.revenue
      );
      const direction =
        changeType === 'decrease'
          ? 'decreased'
          : changeType === 'increase'
            ? 'increased'
            : 'held steady';
      insights.push(
        `Medicine sales ${direction} by ${change}% versus the comparison period.`
      );
    }
    if (inventory.summary.deadStock.count > 0) {
      insights.push(
        `${inventory.summary.deadStock.count} medicines had no sales in this period.`
      );
    }

    return insights;
  }

  private static toDistribution(rows: any[], limit: number) {
    const total = rows.reduce((sum, r) => sum + Number(r.value), 0);
    const top = rows.slice(0, limit).map((r) => ({
      label: String(r.label),
      value: Math.round(Number(r.value)),
      percentage: toPercentage(Number(r.value), total),
    }));

    const restTotal = rows
      .slice(limit)
      .reduce((sum, r) => sum + Number(r.value), 0);

    if (restTotal > 0) {
      top.push({
        label: 'Others',
        value: Math.round(restTotal),
        percentage: toPercentage(restTotal, total),
      });
    }

    return top;
  }
}
