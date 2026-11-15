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
  toPercentage,
} from '../utils/reportsPeriod.utils';
import {
  generateDateSlots,
  mapDataToSlots,
  padSlots,
  rangeDays,
  resolveTruncUnit,
  slotMeta,
} from '../utils/reportsTrend.utils';
import { getISTDateString } from '../../../utils/istDateTime';
import {
  ReportsMedicinesData,
  MedicineMetricItem,
} from '../types/reportsMedicines.types';

const CACHE_TTL = 120; // 2 min

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

/** Line value actually charged, net of returns: discounted, GST excluded (the `total` column). */
const NET_AMOUNT = sql`(COALESCE(${PharmacySalesItemsModel.total}, 0) * ${NET_UNITS} / NULLIF(${PharmacySalesItemsModel.quantity}, 0))`;

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
      filterOptions,
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
      this.getFilterOptions(clinicId),
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
      filterOptions,
      insights: this.buildInsights(
        topSellingMedicines,
        inventory,
        currentSales
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
        COALESCE(SUM(${NET_AMOUNT}), 0) as revenue,
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
    // Shared trend buckets: real-date labels, both periods' dates for the tooltip, zero padding.
    const days = rangeDays(primary);
    const truncUnit = resolveTruncUnit(period, days);
    const primarySlots = generateDateSlots(
      primary.start,
      primary.end,
      truncUnit,
      days
    );
    const comparisonSlots = padSlots(
      primarySlots,
      generateDateSlots(comparison.start, comparison.end, truncUnit, days)
    );

    const scope = pharmacyScope(clinicId, query);
    const valueExpr =
      type === 'units' ? sql`SUM(${NET_UNITS})` : sql`SUM(${NET_AMOUNT})`;

    const rangeRows = (range: DateRange) =>
      database.execute(sql`
      SELECT
        date_trunc(${sql.raw(`'${truncUnit}'`)}, ${PharmacySalesModel.createdAt}) as dt,
        COALESCE(${valueExpr}, 0) as cnt
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

    const round = (values: number[]) => values.map((v) => Math.round(v));
    return {
      ...slotMeta(primarySlots, comparisonSlots, primary, comparison),
      currentPeriod: round(mapDataToSlots(curRows, primarySlots, truncUnit)),
      previousPeriod: round(
        mapDataToSlots(prevRows, comparisonSlots, truncUnit)
      ),
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
        COALESCE(SUM(${NET_AMOUNT}), 0) as value
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
        COALESCE(NULLIF(TRIM(${pharmacyMedicineModel.form}), ''), 'Not Recorded') as label,
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

  /** Also feeds the Overview tab's Medicine Sales table. */
  static async getTopSellingMedicines(
    clinicId: string,
    primary: DateRange,
    query: ReportsMedicinesQueryDto
  ) {
    const rows: any[] = await database.execute(sql`
      SELECT
        ${pharmacyMedicineModel.medicineName} as medicine_name,
        COALESCE(SUM(${NET_UNITS}), 0) as units,
        COALESCE(SUM(${NET_AMOUNT}), 0) as amount
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
        -- Net of returns and limited to the clinic's pharmacies, like Units Sold.
        COALESCE((
          SELECT SUM(psi.quantity - COALESCE((
            SELECT SUM(rri.returned_quantity) FROM ${PharmacySalesReturnItemsModel} rri WHERE rri.sales_item_id = psi.id
          ), 0))
          FROM ${PharmacySalesItemsModel} psi
          INNER JOIN ${PharmacySalesModel} ps ON ps.id = psi.pharmacy_sales_id
          INNER JOIN ${PharmacyStockMedicineModel} psm ON psm.id = psi.pharmacy_stock_medicine_id
          WHERE psm.pharmacy_medicine_id = ${pharmacyMedicineModel.id}
            AND ps.pharmacy_id IN ${scope}
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
    // A medicine is fast or slow, never both (with one medicine the two thresholds are equal).
    const slowMoving = medicines.filter(
      (m) => m.sold > 0 && m.sold <= slowThreshold && m.sold < fastThreshold
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
        (${PharmacyStockMedicineModel.expiry}::date - ${getISTDateString()}::date) as days_left,
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

  /** Filter options from the catalogue and suppliers, so they don't vanish in a quiet period. */
  private static async getFilterOptions(clinicId: string) {
    const scope = pharmacyScope(clinicId, {} as ReportsMedicinesQueryDto);
    const [categories, suppliers]: any[][] = await Promise.all([
      database.execute(sql`
        SELECT DISTINCT TRIM(${pharmacyMedicineModel.category}) as label
        FROM ${pharmacyMedicineModel}
        WHERE ${pharmacyMedicineModel.pharmacyId} IN ${scope}
          AND NULLIF(TRIM(${pharmacyMedicineModel.category}), '') IS NOT NULL
        ORDER BY 1
      `) as Promise<any[]>,
      database.execute(sql`
        SELECT ${PharmacySupplierModel.id} as id, ${PharmacySupplierModel.supplierName} as name
        FROM ${PharmacySupplierModel}
        WHERE ${PharmacySupplierModel.pharmacyId} IN ${scope}
        ORDER BY 2
      `) as Promise<any[]>,
    ]);
    return {
      categories: categories.map((r) => ({
        label: String(r.label),
        value: String(r.label),
      })),
      suppliers: suppliers.map((r) => ({
        label: String(r.name),
        value: String(r.id),
      })),
    };
  }

  /** Each insight carries its numbers; the sales change lives on the cards, not here. */
  private static buildInsights(
    topSelling: Array<{
      medicineName: string;
      unitsSold: number;
      salesAmount: number;
    }>,
    inventory: {
      totalMedicines: number;
      lowStockMedicines: unknown[];
      expiringCount: number;
      summary: { deadStock: { count: number } };
    },
    current: { revenue: number; units: number }
  ): string[] {
    const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
    const insights: string[] = [];
    const [top] = topSelling;
    if (top && current.units > 0) {
      insights.push(
        `${top.medicineName} sold the most: ${top.unitsSold} of ${current.units} units, ${inr(top.salesAmount)} of ${inr(current.revenue)} net sales.`
      );
    }
    if (inventory.lowStockMedicines.length > 0) {
      insights.push(
        `${inventory.lowStockMedicines.length} of ${inventory.totalMedicines} medicines are at or below their reorder level today.`
      );
    }
    if (inventory.expiringCount > 0) {
      const batches =
        inventory.expiringCount === 1
          ? '1 stock batch expires'
          : `${inventory.expiringCount} stock batches expire`;
      insights.push(`${batches} in the next ${EXPIRY_WINDOW_DAYS} days.`);
    }
    if (inventory.summary.deadStock.count > 0) {
      insights.push(
        `${inventory.summary.deadStock.count} of ${inventory.totalMedicines} medicines in stock had no sales in the selected dates.`
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
