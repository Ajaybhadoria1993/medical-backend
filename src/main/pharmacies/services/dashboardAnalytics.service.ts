import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import {
  DashboardSummaryQuery,
  SalesOverviewQuery,
} from '../schemas/dashboard.schema';
import { PharmacySalesModel } from '../models/pharmacySales.model';
import { PharmacySalesItemsModel } from '../models/pharmacySalesItems.model';
import {
  PharmacySalesReturnItemsModel,
  PharmacySalesReturnModel,
} from '../models/pharmacySalesReturn.model';
import { PharmacyStockMedicineModel } from '../models/pharmacyStockMedicine.model';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import { PharmacyStockModel } from '../models/pharmacyStock.model';
import { PharmacySupplierModel } from '../models/pharmacySupplier.model';

type MonthPeriod = 'thisMonth' | 'lastMonth';

export class PharmacyDashboardAnalyticsService {
  private static number(value: unknown): number {
    return Number(value) || 0;
  }

  private static round(value: number, decimals = 2): number {
    return Number(value.toFixed(decimals));
  }

  private static change(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return this.round(((current - previous) / previous) * 100, 1);
  }

  private static toISOString(date: Date): string {
    return date.toISOString();
  }

  private static startOfDay(date: Date): Date {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  private static endOfDay(date: Date): Date {
    const value = new Date(date);
    value.setHours(23, 59, 59, 999);
    return value;
  }

  private static async verifyPharmacy(pharmacyId: string): Promise<void> {
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.id, pharmacyId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!pharmacy) throw new HttpError(404, 'Pharmacy not found');
  }

  private static dateRange(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T23:59:59.999Z`);
    const duration = end.getTime() - start.getTime() + 1;
    const previousEnd = new Date(start.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - duration + 1);

    return {
      start,
      end,
      previousStart,
      previousEnd,
      startISO: this.toISOString(start),
      endISO: this.toISOString(end),
      previousStartISO: this.toISOString(previousStart),
      previousEndISO: this.toISOString(previousEnd),
    };
  }

  private static periodRange(period: 'week' | 'month' | 'year') {
    const now = new Date();
    const end = this.endOfDay(now);
    let start: Date;
    let previousStart: Date;
    let previousEnd: Date;

    if (period === 'week') {
      start = this.startOfDay(now);
      start.setDate(start.getDate() - 6);
      previousEnd = new Date(start.getTime() - 1);
      previousStart = this.startOfDay(previousEnd);
      previousStart.setDate(previousStart.getDate() - 6);
    } else if (period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousEnd = new Date(start.getTime() - 1);
    } else {
      start = new Date(now.getFullYear(), 0, 1);
      previousStart = new Date(now.getFullYear() - 1, 0, 1);
      previousEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    }

    return {
      start,
      end,
      previousStart,
      previousEnd,
      startISO: this.toISOString(start),
      endISO: this.toISOString(end),
      previousStartISO: this.toISOString(previousStart),
      previousEndISO: this.toISOString(previousEnd),
    };
  }

  private static monthRange(period: MonthPeriod) {
    const now = new Date();
    const offset = period === 'thisMonth' ? 0 : -1;
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end =
      period === 'thisMonth'
        ? this.endOfDay(now)
        : new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const previousStart = new Date(
      start.getFullYear(),
      start.getMonth() - 1,
      1
    );
    const previousEnd = new Date(start.getTime() - 1);

    return {
      start,
      end,
      previousStart,
      previousEnd,
      startISO: this.toISOString(start),
      endISO: this.toISOString(end),
      previousStartISO: this.toISOString(previousStart),
      previousEndISO: this.toISOString(previousEnd),
    };
  }

  private static async salesMetrics(
    pharmacyId: string,
    start: Date,
    end: Date
  ) {
    const startISO = this.toISOString(start);
    const endISO = this.toISOString(end);

    // Get sales data
    const [salesData] = await database
      .select({
        revenue: sql<number>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${startISO}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${endISO}::timestamp`}
          ), 0)
        `,
        orders: sql<number>`COUNT(${PharmacySalesModel.id})::int`,
        customers: sql<number>`COUNT(DISTINCT NULLIF(${PharmacySalesModel.patientMobile}, ''))::int`,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, sql`${startISO}::timestamp`),
          lte(PharmacySalesModel.createdAt, sql`${endISO}::timestamp`)
        )
      );

    // Get cost data
    const [costData] = await database
      .select({
        cost: sql<number>`
          COALESCE(
            SUM(
              (
                COALESCE(${PharmacySalesItemsModel.quantity}, 0)
                - COALESCE(return_sub.returned_quantity, 0)
              ) * COALESCE(${PharmacyStockMedicineModel.cost}, 0)
            ),
            0
          )
        `,
      })
      .from(PharmacySalesItemsModel)
      .leftJoin(
        sql`
          (
            SELECT
              ${PharmacySalesReturnItemsModel.salesItemId} AS sales_item_id,
              SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS returned_quantity
            FROM ${PharmacySalesReturnItemsModel}
            GROUP BY ${PharmacySalesReturnItemsModel.salesItemId}
          ) return_sub
        `,
        sql`return_sub.sales_item_id = ${PharmacySalesItemsModel.id}`
      )
      .innerJoin(
        PharmacySalesModel,
        eq(PharmacySalesItemsModel.pharmacySalesId, PharmacySalesModel.id)
      )
      .innerJoin(
        PharmacyStockMedicineModel,
        eq(
          PharmacySalesItemsModel.pharmacyStockMedicineId,
          PharmacyStockMedicineModel.id
        )
      )
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, sql`${startISO}::timestamp`),
          lte(PharmacySalesModel.createdAt, sql`${endISO}::timestamp`)
        )
      );

    const revenue = this.number(salesData?.revenue || 0);
    const cost = this.number(costData?.cost || 0);
    const orders = this.number(salesData?.orders || 0);
    const customers = this.number(salesData?.customers || 0);

    return {
      revenue,
      profit: revenue - cost,
      orders,
      customers,
      averageOrderValue: orders === 0 ? 0 : revenue / orders,
    };
  }

  private static async inventory(pharmacyId: string, asOf: Date) {
    const asOfISO = this.toISOString(asOf);
    const expiringEnd = new Date(asOf);
    expiringEnd.setDate(expiringEnd.getDate() + 30);
    const expiringEndISO = this.toISOString(expiringEnd);

    // Get total sales quantities per batch prior to asOf date
    const salesSub = database
      .select({
        batchId: PharmacySalesItemsModel.pharmacyStockMedicineId,
        soldQty:
          sql<number>`COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)`.as(
            'sold_qty'
          ),
      })
      .from(PharmacySalesItemsModel)
      .innerJoin(
        PharmacySalesModel,
        eq(PharmacySalesModel.id, PharmacySalesItemsModel.pharmacySalesId)
      )
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          lte(PharmacySalesModel.createdAt, sql`${asOfISO}::timestamp`)
        )
      )
      .groupBy(PharmacySalesItemsModel.pharmacyStockMedicineId)
      .as('sales_sub');

    const returnsSub = database
      .select({
        batchId: PharmacySalesReturnItemsModel.stockMedicineId,
        returnedQty:
          sql<number>`COALESCE(SUM(${PharmacySalesReturnItemsModel.returnedQuantity}), 0)`.as(
            'returned_qty'
          ),
      })
      .from(PharmacySalesReturnItemsModel)
      .innerJoin(
        PharmacySalesReturnModel,
        eq(
          PharmacySalesReturnModel.id,
          PharmacySalesReturnItemsModel.salesReturnId
        )
      )
      .where(
        and(
          eq(PharmacySalesReturnModel.pharmacyId, pharmacyId),
          lte(PharmacySalesReturnModel.createdAt, sql`${asOfISO}::timestamp`)
        )
      )
      .groupBy(PharmacySalesReturnItemsModel.stockMedicineId)
      .as('returns_sub');

    // Get inventory data with Drizzle
    const inventoryData = await database
      .select({
        id: pharmacyMedicineModel.id,
        medicineName: pharmacyMedicineModel.medicineName,
        reorder: pharmacyMedicineModel.reorder,
        packOf: pharmacyMedicineModel.packOf,
        availableQuantity: sql<number>`COALESCE(SUM(GREATEST(
          COALESCE(${PharmacyStockMedicineModel.quantity}, 0) - COALESCE(${salesSub.soldQty}, 0) + COALESCE(${returnsSub.returnedQty}, 0), 0
        )), 0)`,
        inventoryValue: sql<number>`COALESCE(SUM(
          GREATEST(
            COALESCE(${PharmacyStockMedicineModel.quantity}, 0) - COALESCE(${salesSub.soldQty}, 0) + COALESCE(${returnsSub.returnedQty}, 0), 0
          ) * COALESCE(${PharmacyStockMedicineModel.cost}, 0)
        ), 0)`,
        expiringBatches: sql<number>`COUNT(DISTINCT ${PharmacyStockMedicineModel.id}) FILTER (
          WHERE ${PharmacyStockMedicineModel.expiry} >= ${asOfISO}::timestamp
            AND ${PharmacyStockMedicineModel.expiry} <= ${expiringEndISO}::timestamp
            AND GREATEST(
              COALESCE(${PharmacyStockMedicineModel.quantity}, 0)
              - COALESCE(${salesSub.soldQty}, 0)
              + COALESCE(${returnsSub.returnedQty}, 0),
              0
            ) > 0
        )::int`,
      })
      .from(pharmacyMedicineModel)
      .leftJoin(
        PharmacyStockMedicineModel,
        eq(
          PharmacyStockMedicineModel.pharmacyMedicineId,
          pharmacyMedicineModel.id
        )
      )
      .leftJoin(
        PharmacyStockModel,
        eq(PharmacyStockModel.id, PharmacyStockMedicineModel.pharmacyStockId)
      )
      .leftJoin(salesSub, eq(PharmacyStockMedicineModel.id, salesSub.batchId))
      .leftJoin(
        returnsSub,
        eq(PharmacyStockMedicineModel.id, returnsSub.batchId)
      )
      .where(
        and(
          eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
          eq(pharmacyMedicineModel.status, 'active'),
          lte(pharmacyMedicineModel.createdAt, sql`${asOfISO}::timestamp`),
          sql`(${PharmacyStockModel.id} IS NULL OR ${PharmacyStockModel.purchaseDate} <= ${asOfISO}::timestamp)`
        )
      )
      .groupBy(
        pharmacyMedicineModel.id,
        pharmacyMedicineModel.medicineName,
        pharmacyMedicineModel.reorder,
        pharmacyMedicineModel.packOf
      );

    return inventoryData.map((row) => ({
      id: String(row.id),
      medicineName: String(row.medicineName),
      reorder: this.number(row.reorder),
      packOf: this.number(row.packOf),
      available: this.number(row.availableQuantity),
      value: this.number(row.inventoryValue),
      expiringBatches: this.number(row.expiringBatches),
    }));
  }

  static async getSummary(pharmacyId: string, query: DashboardSummaryQuery) {
    await this.verifyPharmacy(pharmacyId);

    // Get today's date and yesterday's date for comparison
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Get the start of the current period (today) and previous period (yesterday)
    const todayStart = this.startOfDay(today);
    const todayEnd = this.endOfDay(today);
    const yesterdayStart = this.startOfDay(yesterday);
    const yesterdayEnd = this.endOfDay(yesterday);

    // Get the range for the selected period
    const range = this.dateRange(query.startDate, query.endDate);

    // Get current month and last month for paid amount comparison
    const currentMonthStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );
    const currentMonthEnd = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    const lastMonthStart = new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      1
    );
    const lastMonthEnd = new Date(
      today.getFullYear(),
      today.getMonth(),
      0,
      23,
      59,
      59,
      999
    );

    const [
      todayMetrics,
      yesterdayMetrics,
      inventory,
      payableData,
      currentMonthPaidAmount,
      lastMonthPaidAmount,
    ] = await Promise.all([
      // Today's sales metrics
      this.salesMetrics(pharmacyId, todayStart, todayEnd),
      // Yesterday's sales metrics
      this.salesMetrics(pharmacyId, yesterdayStart, yesterdayEnd),
      // Current inventory
      this.inventory(pharmacyId, range.end),
      // Get payables data
      database
        .select({
          totalPayables: sql<number>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`,
          supplierCount: sql<number>`COUNT(DISTINCT ${PharmacyStockModel.pharmacySupplierId})::int`,
          supplierName: sql<string>`MIN(${PharmacySupplierModel.supplierName})`,
          pendingCount: sql<number>`COUNT(${PharmacyStockModel.id})::int`,
        })
        .from(PharmacyStockModel)
        .leftJoin(
          PharmacySupplierModel,
          eq(PharmacyStockModel.pharmacySupplierId, PharmacySupplierModel.id)
        )
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            lte(
              PharmacyStockModel.purchaseDate,
              sql`${range.endISO}::timestamp`
            ),
            sql`${PharmacyStockModel.pharmacyStockPaymentStatus} IN ('unpaid', 'partial')`
          )
        ),
      // Current month paid amount
      database
        .select({
          totalPaid: sql<number>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            gte(
              PharmacyStockModel.purchaseDate,
              sql`${currentMonthStart.toISOString()}::timestamp`
            ),
            lte(
              PharmacyStockModel.purchaseDate,
              sql`${currentMonthEnd.toISOString()}::timestamp`
            ),
            sql`${PharmacyStockModel.pharmacyStockPaymentStatus} = 'paid'`
          )
        ),
      // Last month paid amount
      database
        .select({
          totalPaid: sql<number>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            gte(
              PharmacyStockModel.purchaseDate,
              sql`${lastMonthStart.toISOString()}::timestamp`
            ),
            lte(
              PharmacyStockModel.purchaseDate,
              sql`${lastMonthEnd.toISOString()}::timestamp`
            ),
            sql`${PharmacyStockModel.pharmacyStockPaymentStatus} = 'paid'`
          )
        ),
    ]);

    // Calculate inventory metrics using the pre-calculated available stock
    const inventoryWithStatus = inventory.map((item) => {
      const reorder = Number(item.reorder || 0);
      let stockStatus: 'empty' | 'low' | 'medium' | 'good' = 'empty';

      if (item.available === 0) {
        stockStatus = 'empty';
      } else if (item.available <= reorder) {
        stockStatus = 'low';
      } else if (item.available <= reorder * 3) {
        stockStatus = 'medium';
      } else {
        stockStatus = 'good';
      }

      return {
        ...item,
        availableQuantity: item.available,
        stockStatus,
      };
    });

    // Now calculate metrics based on the stock status
    const lowStock = inventoryWithStatus.filter(
      (item) => item.stockStatus === 'low'
    );
    const outOfStock = inventoryWithStatus.filter(
      (item) => item.stockStatus === 'empty'
    );
    const inStock = inventoryWithStatus.filter(
      (item) => item.stockStatus === 'good' || item.stockStatus === 'medium'
    );

    // Calculate total medicines
    const totalMedicines = inventoryWithStatus.length;

    // Calculate deltas
    const profitDelta = this.change(
      todayMetrics.profit,
      yesterdayMetrics.profit
    );
    const salesDelta = this.change(
      todayMetrics.revenue,
      yesterdayMetrics.revenue
    );

    // Low stock delta - comparing with total medicines (non-low-stock items)
    const nonLowStockCount = totalMedicines - lowStock.length;
    const lowStockDelta = this.change(lowStock.length, nonLowStockCount);

    // Get paid amounts
    const currentMonthPaid = this.number(
      currentMonthPaidAmount[0]?.totalPaid || 0
    );
    const lastMonthPaid = this.number(lastMonthPaidAmount[0]?.totalPaid || 0);

    // Calculate paid amount delta
    const paidAmountDelta = this.change(currentMonthPaid, lastMonthPaid);

    const pendingCount = this.number(payableData[0]?.pendingCount || 0);
    const supplierCount = this.number(payableData[0]?.supplierCount || 0);
    const supplierName = String(payableData[0]?.supplierName || 'the supplier');
    const totalPayables = this.number(payableData[0]?.totalPayables || 0);

    const criticalAlerts: Array<{
      id: string;
      title: string;
      description: string;
      type: string;
    }> = [];

    if (lowStock.length > 0) {
      criticalAlerts.push({
        id: 'low-stock',
        title: `${lowStock.length} medicine${lowStock.length === 1 ? '' : 's'} are low in stock`,
        description: 'Place order to avoid stockout',
        type: 'warning',
      });
    }
    if (pendingCount > 0) {
      criticalAlerts.push({
        id: 'payment-pending',
        title: `${pendingCount} supplier payment${pendingCount === 1 ? '' : 's'} pending`,
        description:
          supplierCount === 1
            ? `Payment due for ${supplierName}`
            : `Payments due to ${supplierCount} suppliers`,
        type: 'danger',
      });
    }

    // Generate comparison labels
    const getDateLabel = (date: Date): string => {
      const todayDate = new Date();
      const yesterdayDate = new Date(todayDate);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);

      if (date.toDateString() === todayDate.toDateString()) {
        return 'today';
      } else if (date.toDateString() === yesterdayDate.toDateString()) {
        return 'yesterday';
      }
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    };

    const yesterdayLabel = getDateLabel(yesterdayStart);
    const lastMonthLabel = 'last month';

    return {
      statCards: {
        todayProfit: {
          value: this.round(todayMetrics.profit),
          delta: Math.abs(profitDelta),
          sparkUp: profitDelta >= 0,
          comparisonLabel: `vs ${yesterdayLabel}`,
        },
        totalSales: {
          value: this.round(todayMetrics.revenue),
          delta: Math.abs(salesDelta),
          sparkUp: salesDelta >= 0,
          comparisonLabel: `vs ${yesterdayLabel}`,
        },
        lowStockMedicines: {
          value: lowStock.length,
          delta: Math.abs(lowStockDelta),
          sparkUp: lowStockDelta < 0,
          comparisonLabel: `vs total medicines`,
        },
        paidToSuppliers: {
          value: this.round(currentMonthPaid),
          delta: Math.abs(paidAmountDelta),
          sparkUp: paidAmountDelta >= 0,
          comparisonLabel: `vs ${lastMonthLabel}`,
        },
      },
      inventoryHealth: {
        inStock: inStock.length,
        lowStock: lowStock.length,
        outOfStock: outOfStock.length,
      },
      criticalAlerts,
      paymentOverview: {
        totalReceivables: this.round(todayMetrics.revenue),
        receivablesFrom: `From ${todayMetrics.customers} customers`,
        totalPayables: this.round(totalPayables),
        payablesTo: `To ${supplierCount} suppliers`,
      },
      smartInsights: [
        {
          id: 'sales-change',
          text: `Today's sales ${salesDelta >= 0 ? 'increased' : 'decreased'} by ${Math.abs(salesDelta)}%`,
          detail: `Compared with ${yesterdayLabel}`,
          type: salesDelta >= 0 ? 'success' : 'warning',
        },
        {
          id: 'profit-change',
          text: `Today's profit ${profitDelta >= 0 ? 'increased' : 'decreased'} by ${Math.abs(profitDelta)}%`,
          detail: `Compared with ${yesterdayLabel}`,
          type: profitDelta >= 0 ? 'success' : 'warning',
        },
        {
          id: 'stock-warning',
          text: `${lowStock.length} medicine${lowStock.length === 1 ? '' : 's'} may run out`,
          detail: `${outOfStock.length} currently out of stock${outOfStock.length > 0 ? ', ' + (lowStockDelta >= 0 ? 'more' : 'fewer') + ' than total medicines' : ''}`,
          type:
            lowStock.length > 0 || outOfStock.length > 0
              ? 'warning'
              : 'success',
        },
        {
          id: 'paid-to-suppliers',
          text: `Paid to suppliers ${paidAmountDelta >= 0 ? 'increased' : 'decreased'} by ${Math.abs(paidAmountDelta)}%`,
          detail: `Compared with ${lastMonthLabel}`,
          type: paidAmountDelta >= 0 ? 'success' : 'warning',
        },
      ],
    };
  }

  static async getSalesOverview(pharmacyId: string, query: SalesOverviewQuery) {
    await this.verifyPharmacy(pharmacyId);
    const range = this.periodRange(query.period);

    const [current, previous, chartData] = await Promise.all([
      this.salesMetrics(pharmacyId, range.start, range.end),
      this.salesMetrics(pharmacyId, range.previousStart, range.previousEnd),
      // Get chart data
      database
        .select({
          createdAt: PharmacySalesModel.createdAt,
          revenue: PharmacySalesModel.totalAmount,
          cost: sql<number>`COALESCE(SUM(${PharmacySalesItemsModel.quantity} * COALESCE(${PharmacyStockMedicineModel.cost}, 0)), 0)`,
        })
        .from(PharmacySalesModel)
        .leftJoin(
          PharmacySalesItemsModel,
          eq(PharmacySalesItemsModel.pharmacySalesId, PharmacySalesModel.id)
        )
        .leftJoin(
          PharmacyStockMedicineModel,
          eq(
            PharmacySalesItemsModel.pharmacyStockMedicineId,
            PharmacyStockMedicineModel.id
          )
        )
        .where(
          and(
            eq(PharmacySalesModel.pharmacyId, pharmacyId),
            gte(
              PharmacySalesModel.createdAt,
              sql`${range.startISO}::timestamp`
            ),
            lte(PharmacySalesModel.createdAt, sql`${range.endISO}::timestamp`)
          )
        )
        .groupBy(
          PharmacySalesModel.id,
          PharmacySalesModel.createdAt,
          PharmacySalesModel.totalAmount
        )
        .orderBy(PharmacySalesModel.createdAt),
    ]);

    const currentMetrics = {
      revenue: current.revenue,
      profit: current.profit,
      orders: current.orders,
    };
    const previousMetrics = {
      revenue: previous.revenue,
      profit: previous.profit,
      orders: previous.orders,
    };

    const chart = new Map<string, number>();

    chartData.forEach((row) => {
      const date = new Date(String(row.createdAt));
      const label =
        query.period === 'week'
          ? date.toLocaleDateString('en-US', { weekday: 'short' })
          : query.period === 'month'
            ? date.toLocaleDateString('en-US', {
                day: '2-digit',
                month: 'short',
              })
            : date.toLocaleDateString('en-US', { month: 'short' });
      const revenue = this.number(row.revenue || 0);
      const value =
        query.metric === 'revenue'
          ? revenue
          : query.metric === 'profit'
            ? revenue - this.number(row.cost)
            : 1;
      chart.set(label, (chart.get(label) || 0) + value);
    });

    const currency = (value: number) =>
      `₹${this.round(value).toLocaleString('en-IN')}`;

    return {
      totalValue: this.round(currentMetrics[query.metric]),
      delta: Math.abs(
        this.change(currentMetrics[query.metric], previousMetrics[query.metric])
      ),
      deltaLabel: `vs last ${query.period}`,
      chartData: Array.from(chart, ([label, value]) => ({
        label,
        value: this.round(value),
      })),
      bottomStats: [
        {
          label: 'Revenue',
          value: currency(current.revenue),
          delta: this.change(current.revenue, previous.revenue),
        },
        {
          label: 'Profit',
          value: currency(current.profit),
          delta: this.change(current.profit, previous.profit),
        },
        {
          label: 'Orders',
          value: String(current.orders),
          delta: this.change(current.orders, previous.orders),
        },
        {
          label: 'Avg. Order Value',
          value: currency(current.averageOrderValue),
          delta: this.change(
            current.averageOrderValue,
            previous.averageOrderValue
          ),
        },
      ],
    };
  }

  static async getCategoryRevenue(pharmacyId: string, period: MonthPeriod) {
    await this.verifyPharmacy(pharmacyId);
    const range = this.monthRange(period);

    const categoryData = await database
      .select({
        category: sql<string>`COALESCE(${pharmacyMedicineModel.category}, 'Uncategorized')`,
        revenue: sql<number>`COALESCE(SUM(${PharmacySalesItemsModel.total}), 0)`,
      })
      .from(PharmacySalesItemsModel)
      .innerJoin(
        PharmacySalesModel,
        eq(PharmacySalesItemsModel.pharmacySalesId, PharmacySalesModel.id)
      )
      .innerJoin(
        PharmacyStockMedicineModel,
        eq(
          PharmacySalesItemsModel.pharmacyStockMedicineId,
          PharmacyStockMedicineModel.id
        )
      )
      .innerJoin(
        pharmacyMedicineModel,
        eq(
          PharmacyStockMedicineModel.pharmacyMedicineId,
          pharmacyMedicineModel.id
        )
      )
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, sql`${range.startISO}::timestamp`),
          lte(PharmacySalesModel.createdAt, sql`${range.endISO}::timestamp`)
        )
      )
      .groupBy(
        sql`COALESCE(${pharmacyMedicineModel.category}, 'Uncategorized')`
      )
      .orderBy(sql`COALESCE(SUM(${PharmacySalesItemsModel.total}), 0) DESC`);

    const totalRevenue = categoryData.reduce(
      (total, row) => total + this.number(row.revenue),
      0
    );

    const generateRandomColor = (index: number) => {
      const goldenRatio = 0.618033988749895;
      const hue = (index * goldenRatio * 360) % 360;
      const saturation = 70 + Math.floor(Math.random() * 20); // 70-90%
      const lightness = 45 + Math.floor(Math.random() * 20); // 45-65%
      return `hsl(${Math.floor(hue)}, ${saturation}%, ${lightness}%)`;
    };

    return {
      totalRevenue: this.round(totalRevenue),
      categories: categoryData.map((row, index) => {
        const value = this.number(row.revenue);
        return {
          name: String(row.category),
          value: this.round(value),
          percentage:
            totalRevenue === 0
              ? 0
              : this.round((value / totalRevenue) * 100, 1),
          color: generateRandomColor(index),
        };
      }),
    };
  }

  static async getTopPerformers(pharmacyId: string, period: MonthPeriod) {
    await this.verifyPharmacy(pharmacyId);
    const range = this.monthRange(period);

    const performerQuery = (startISO: string, endISO: string) =>
      database
        .select({
          medicineId: pharmacyMedicineModel.id,
          medicineName: pharmacyMedicineModel.medicineName,
          brandName: sql<string>`COALESCE(${pharmacyMedicineModel.brandName}, 'Unknown')`,
          units: sql<number>`COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)`,
          salesValue: sql<number>`COALESCE(SUM(${PharmacySalesItemsModel.total}), 0)`,
          profitPerUnit: sql<number>`CASE
            WHEN COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0) = 0 THEN 0
            ELSE COALESCE(SUM(
              ${PharmacySalesItemsModel.total} - (${PharmacySalesItemsModel.quantity} * COALESCE(${PharmacyStockMedicineModel.cost}, 0))
            ), 0) / SUM(${PharmacySalesItemsModel.quantity})
          END`,
        })
        .from(PharmacySalesItemsModel)
        .innerJoin(
          PharmacySalesModel,
          eq(PharmacySalesItemsModel.pharmacySalesId, PharmacySalesModel.id)
        )
        .innerJoin(
          PharmacyStockMedicineModel,
          eq(
            PharmacySalesItemsModel.pharmacyStockMedicineId,
            PharmacyStockMedicineModel.id
          )
        )
        .innerJoin(
          pharmacyMedicineModel,
          eq(
            PharmacyStockMedicineModel.pharmacyMedicineId,
            pharmacyMedicineModel.id
          )
        )
        .where(
          and(
            eq(PharmacySalesModel.pharmacyId, pharmacyId),
            gte(PharmacySalesModel.createdAt, sql`${startISO}::timestamp`),
            lte(PharmacySalesModel.createdAt, sql`${endISO}::timestamp`)
          )
        )
        .groupBy(
          pharmacyMedicineModel.id,
          pharmacyMedicineModel.medicineName,
          pharmacyMedicineModel.brandName
        );

    const [current, previous] = await Promise.all([
      performerQuery(range.startISO, range.endISO),
      performerQuery(range.previousStartISO, range.previousEndISO),
    ]);

    const topMedicine = [...current].sort(
      (a, b) => this.number(b.units) - this.number(a.units)
    )[0];
    const topMargin = [...current].sort(
      (a, b) => this.number(b.profitPerUnit) - this.number(a.profitPerUnit)
    )[0];

    const brandTotals = new Map<string, number>();
    const previousBrandTotals = new Map<string, number>();

    current.forEach((row) => {
      const brand = String(row.brandName);
      brandTotals.set(
        brand,
        (brandTotals.get(brand) || 0) + this.number(row.salesValue)
      );
    });
    previous.forEach((row) => {
      const brand = String(row.brandName);
      previousBrandTotals.set(
        brand,
        (previousBrandTotals.get(brand) || 0) + this.number(row.salesValue)
      );
    });

    const topBrand = [...brandTotals].sort((a, b) => b[1] - a[1])[0];

    const previousMedicine = previous.find(
      (row) => String(row.medicineId) === String(topMedicine?.medicineId)
    );
    const previousMargin = previous.find(
      (row) => String(row.medicineId) === String(topMargin?.medicineId)
    );

    return {
      performers: [
        {
          type: 'topSellingMedicine',
          label: 'Top Selling Medicine',
          name: topMedicine ? String(topMedicine.medicineName) : 'No sales',
          value: String(this.number(topMedicine?.units)),
          subValue: 'Units Sold',
          delta: this.change(
            this.number(topMedicine?.units),
            this.number(previousMedicine?.units)
          ),
        },
        {
          type: 'topBrand',
          label: 'Top Brand',
          name: topBrand?.[0] || 'No sales',
          value: `₹${this.round(topBrand?.[1] || 0).toLocaleString('en-IN')}`,
          subValue: 'Sales Value',
          delta: this.change(
            topBrand?.[1] || 0,
            previousBrandTotals.get(topBrand?.[0] || '') || 0
          ),
        },
        {
          type: 'topProfitMargin',
          label: 'Top Profit Margin',
          name: topMargin ? String(topMargin.medicineName) : 'No sales',
          value: `₹${this.round(this.number(topMargin?.profitPerUnit)).toLocaleString('en-IN')}`,
          subValue: 'Profit / Unit',
          delta: this.change(
            this.number(topMargin?.profitPerUnit),
            this.number(previousMargin?.profitPerUnit)
          ),
        },
      ],
    };
  }

  static async getAiStockPrediction(pharmacyId: string) {
    await this.verifyPharmacy(pharmacyId);

    // Use a simpler approach with raw SQL for this complex query
    const result = await database.execute(sql`
      WITH inventory AS (
        SELECT 
          pm.id AS medicine_id,
          pm.medicine_name,
          pm.reorder,
          pm.pack_of,
          COALESCE(
            (SELECT COALESCE(SUM(GREATEST(
              COALESCE(psm.quantity, 0) - COALESCE(
                (SELECT COALESCE(SUM(psi.quantity), 0)
                 FROM pharmacy_sales_items psi
                 INNER JOIN pharmacy_sales ps2 ON ps2.id = psi.pharmacy_sales_id
                 WHERE psi.pharmacy_stock_medicine_id = psm.id
                   AND ps2.pharmacy_id = ${pharmacyId}
                ), 0
              ), 0
            )), 0)
             FROM pharmacy_stock_medicine psm
             WHERE psm.pharmacy_medicine_id = pm.id
            ), 0
          ) AS current_stock
        FROM pharmacy_medicines pm
        WHERE pm.pharmacy_id = ${pharmacyId}
          AND pm.status = 'active'
      ),
      usage AS (
        SELECT 
          psm.pharmacy_medicine_id,
          COALESCE(SUM(psi.quantity), 0) / 30.0 AS daily_average_usage
        FROM pharmacy_sales_items psi
        INNER JOIN pharmacy_sales ps ON ps.id = psi.pharmacy_sales_id
        INNER JOIN pharmacy_stock_medicine psm ON psm.id = psi.pharmacy_stock_medicine_id
        WHERE ps.pharmacy_id = ${pharmacyId}
          AND ps.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        GROUP BY psm.pharmacy_medicine_id
      )
      SELECT 
        i.medicine_name,
        i.current_stock,
        i.reorder,
        i.pack_of,
        COALESCE(u.daily_average_usage, 0) AS daily_average_usage
      FROM inventory i
      INNER JOIN usage u ON u.pharmacy_medicine_id = i.medicine_id
      WHERE u.daily_average_usage > 0
      ORDER BY 
        i.current_stock / NULLIF(u.daily_average_usage, 0),
        i.current_stock
      LIMIT 1
    `);

    const row = result[0];
    if (!row) {
      return {
        medicineName: '',
        runoutDays: 0,
        currentStock: 0,
        dailyAverageUsage: 0,
        suggestedOrder: 0,
      };
    }

    const currentStock = this.number(row.current_stock);
    const dailyAverageUsage = this.number(row.daily_average_usage);
    const reorder = this.number(row.reorder);
    const packOf = this.number(row.pack_of) || 1;
    const targetStock = Math.max(reorder * 2, dailyAverageUsage * 30);
    const required = Math.max(targetStock - currentStock, 0);

    return {
      medicineName: String(row.medicine_name),
      runoutDays: Math.max(
        0,
        Math.floor(currentStock / (dailyAverageUsage || 1))
      ),
      currentStock: this.round(currentStock),
      dailyAverageUsage: this.round(dailyAverageUsage, 1),
      suggestedOrder: Math.ceil(required / packOf) * packOf,
    };
  }
}
