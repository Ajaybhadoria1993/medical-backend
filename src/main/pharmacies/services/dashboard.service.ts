import { and, eq, sql, gte, lte, desc } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import { PharmacyStockMedicineModel } from '../models/pharmacyStockMedicine.model';
import { PharmacySalesItemsModel } from '../models/pharmacySalesItems.model';
import { PharmacySalesModel } from '../models/pharmacySales.model';
import {
  PharmacySalesReturnItemsModel,
  PharmacySalesReturnModel,
} from '../models/pharmacySalesReturn.model';
import { PrescriptionQueueModel } from '../../pharmacy/models/prescriptionQueue.model';
import { PharmacyStockModel } from '../models/pharmacyStock.model';
import { PharmacySupplierModel } from '../models/pharmacySupplier.model';
import { HsnTaxMasterModel } from '../../pharmacy/models/inventoryMasters.model';

export class PharmacyDashboardService {
  /**
   * Get dashboard statistics - Total medicines, low stock, prescriptions by status, sales
   */
  private static getLast7Days(): { date: Date; dayName: string }[] {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      days.push({ date, dayName });
    }
    return days;
  }

  // Helper function to get start of day
  private static getStartOfDay(date: Date): Date {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  // Helper function to get end of day
  private static getEndOfDay(date: Date): Date {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end;
  }

  static async getDashboardStats(pharmacyId: string) {
    // Verify pharmacy exists
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

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    // ==================== CARD 1: Total Medicines ====================
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    const previousMonthStarts = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1
    );
    const previousMonthEnds = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
      999
    );

    const [
      totalMedicinesResult,
      currentMonthMedicinesResult,
      previousMonthMedicinesResult,
    ] = await Promise.all([
      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.id})`,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            eq(pharmacyMedicineModel.status, 'active')
          )
        ),

      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.id})`,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            eq(pharmacyMedicineModel.status, 'active'),
            gte(pharmacyMedicineModel.createdAt, currentMonthStart),
            lte(pharmacyMedicineModel.createdAt, currentMonthEnd)
          )
        ),

      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.id})`,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            eq(pharmacyMedicineModel.status, 'active'),
            gte(pharmacyMedicineModel.createdAt, previousMonthStarts),
            lte(pharmacyMedicineModel.createdAt, previousMonthEnds)
          )
        ),
    ]);

    const totalMedicines = Number(totalMedicinesResult[0]?.count) || 0;
    const currentMonthMedicines =
      Number(currentMonthMedicinesResult[0]?.count) || 0;
    const previousMonthMedicines =
      Number(previousMonthMedicinesResult[0]?.count) || 0;

    const medicinesPercentageChange =
      previousMonthMedicines === 0
        ? currentMonthMedicines > 0
          ? 100
          : 0
        : ((currentMonthMedicines - previousMonthMedicines) /
            previousMonthMedicines) *
          100;

    // ==================== CARD 2: Low Stock Medicines ====================
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const lowStockResult = await database
      .select({
        medicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
      })
      .from(PharmacyStockMedicineModel)
      .innerJoin(
        PharmacyStockModel,
        eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
      )
      .where(
        and(
          eq(PharmacyStockModel.pharmacyId, pharmacyId),
          sql`${PharmacyStockMedicineModel.quantity} <= 50`
        )
      );

    const lowStockMedicines = new Set(lowStockResult.map((r) => r.medicineId))
      .size;

    const previousMonthLowStockResult = await database
      .select({
        medicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
      })
      .from(PharmacyStockMedicineModel)
      .innerJoin(
        PharmacyStockModel,
        eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
      )
      .where(
        and(
          eq(PharmacyStockModel.pharmacyId, pharmacyId),
          sql`${PharmacyStockMedicineModel.quantity} <= 50`,
          lte(PharmacyStockModel.createdAt, thirtyDaysAgo)
        )
      );

    const previousMonthLowStock = new Set(
      previousMonthLowStockResult.map((r) => r.medicineId)
    ).size;
    const lowStockPercentageChange =
      previousMonthLowStock === 0
        ? 0
        : ((lowStockMedicines - previousMonthLowStock) /
            previousMonthLowStock) *
          100;

    // ==================== CARD 3: Today's Sales ====================
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todaysSalesResult = await database
      .select({
        totalAmount: sql<string>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${todayStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${todayEnd.toISOString()}::timestamp`}
          ), 0)
        `,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, todayStart),
          lte(PharmacySalesModel.createdAt, todayEnd)
        )
      );

    const todaysSales = Number(todaysSalesResult[0]?.totalAmount) || 0;

    // Yesterday's sales for comparison
    const yesterdayStart = new Date();
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date();
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
    yesterdayEnd.setHours(23, 59, 59, 999);

    const yesterdaysSalesResult = await database
      .select({
        totalAmount: sql<string>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${yesterdayStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${yesterdayEnd.toISOString()}::timestamp`}
          ), 0)
        `,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, yesterdayStart),
          lte(PharmacySalesModel.createdAt, yesterdayEnd)
        )
      );

    const yesterdaysSales = Number(yesterdaysSalesResult[0]?.totalAmount) || 0;
    const salesPercentageChange =
      yesterdaysSales === 0
        ? todaysSales > 0
          ? 100
          : 0
        : ((todaysSales - yesterdaysSales) / yesterdaysSales) * 100;

    // ==================== CARD 4: Monthly Revenue ====================
    const currentDate = new Date();
    const monthStart = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1
    );
    const monthEnd = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    const monthlyRevenueResult = await database
      .select({
        totalAmount: sql<string>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${monthStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${monthEnd.toISOString()}::timestamp`}
          ), 0)
        `,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, monthStart),
          lte(PharmacySalesModel.createdAt, monthEnd)
        )
      );

    const monthlyRevenue = Number(monthlyRevenueResult[0]?.totalAmount) || 0;

    const previousMonthStart = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() - 1,
      1
    );
    const previousMonthEnd = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      0,
      23,
      59,
      59,
      999
    );

    const previousMonthRevenueResult = await database
      .select({
        totalAmount: sql<string>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${previousMonthStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${previousMonthEnd.toISOString()}::timestamp`}
          ), 0)
        `,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, previousMonthStart),
          lte(PharmacySalesModel.createdAt, previousMonthEnd)
        )
      );

    const previousMonthRevenue =
      Number(previousMonthRevenueResult[0]?.totalAmount) || 0;
    const revenuePercentageChange =
      previousMonthRevenue === 0
        ? monthlyRevenue > 0
          ? 100
          : 0
        : ((monthlyRevenue - previousMonthRevenue) / previousMonthRevenue) *
          100;

    // ==================== PRESCRIPTIONS ====================
    const prescriptionsResult = await database
      .select({
        status: PrescriptionQueueModel.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(PrescriptionQueueModel)
      .innerJoin(
        PharmacyModel,
        eq(PrescriptionQueueModel.clinicId, PharmacyModel.clinicId)
      )
      .where(eq(PharmacyModel.id, pharmacyId))
      .groupBy(PrescriptionQueueModel.status);

    const prescriptionsByStatus = {
      pending: 0,
      onHold: 0,
      completed: 0,
      rejected: 0,
    };

    prescriptionsResult.forEach((result) => {
      const count = Number(result.count);
      if (result.status === 'PENDING') {
        prescriptionsByStatus.pending = count;
      } else if (result.status === 'ON_HOLD') {
        prescriptionsByStatus.onHold = count;
      } else if (result.status === 'COMPLETED') {
        prescriptionsByStatus.completed = count;
      } else if (result.status === 'REJECTED') {
        prescriptionsByStatus.rejected = count;
      }
    });

    const totalPrescriptions =
      prescriptionsByStatus.pending +
      prescriptionsByStatus.onHold +
      prescriptionsByStatus.completed +
      prescriptionsByStatus.rejected;

    // ==================== RADAR DATA: Category Distribution ====================
    const stockByCategoryResult = await database
      .select({
        category: pharmacyMedicineModel.category,
        count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.id})`,
      })
      .from(pharmacyMedicineModel)
      .where(
        and(
          eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
          eq(pharmacyMedicineModel.status, 'active')
        )
      )
      .groupBy(pharmacyMedicineModel.category)
      .orderBy(sql`count DESC`)
      .limit(6);

    const radarData = stockByCategoryResult.map((item) => ({
      category: item.category || 'Uncategorized',
      value: Number(item.count),
    }));

    // ==================== BAR DATA: Last 7 days purchase amounts (paid) ====================
    const last7Days = this.getLast7Days();

    const startOfRange = this.getStartOfDay(last7Days[0].date);
    const endOfRange = this.getEndOfDay(last7Days[last7Days.length - 1].date);

    const last7DaysStockResult = await database
      .select({
        dayDate: sql<string>`DATE(${PharmacyStockModel.purchaseDate})`,
        totalAmount: sql<string>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`,
      })
      .from(PharmacyStockModel)
      .where(
        and(
          eq(PharmacyStockModel.pharmacyId, pharmacyId),
          eq(PharmacyStockModel.pharmacyStockPaymentStatus, 'paid'),
          gte(PharmacyStockModel.purchaseDate, startOfRange),
          lte(PharmacyStockModel.purchaseDate, endOfRange)
        )
      )
      .groupBy(sql`DATE(${PharmacyStockModel.purchaseDate})`);

    const stockMap = new Map(
      last7DaysStockResult.map((r) => {
        const key =
          (r.dayDate as unknown) instanceof Date
            ? (r.dayDate as unknown as Date).toISOString().slice(0, 10)
            : String(r.dayDate).slice(0, 10);
        return [key, Number(r.totalAmount)];
      })
    );

    const barData = last7Days.map((day) => {
      const key = day.date.toISOString().slice(0, 10);
      return {
        day: day.dayName,
        value: stockMap.get(key) || 0,
      };
    });

    // ==================== NEW CARD 1: Total Profit (Today's Sales - Cost) ====================
    todayStart.setHours(0, 0, 0, 0);
    todayEnd.setHours(23, 59, 59, 999);

    // Get today's sales and cost
    const todayProfitResult = await database
      .select({
        totalSales: sql<string>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${todayStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${todayEnd.toISOString()}::timestamp`}
          ), 0)
        `,
        totalCost: sql<string>`
          COALESCE(SUM(${PharmacySalesItemsModel.total}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnItemsModel.refundAmount})
            FROM ${PharmacySalesReturnItemsModel}
            INNER JOIN ${PharmacySalesReturnModel}
              ON ${PharmacySalesReturnModel.id} = ${PharmacySalesReturnItemsModel.salesReturnId}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${todayStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${todayEnd.toISOString()}::timestamp`}
          ), 0)
        `,
      })
      .from(PharmacySalesModel)
      .leftJoin(
        PharmacySalesItemsModel,
        eq(PharmacySalesModel.id, PharmacySalesItemsModel.pharmacySalesId)
      )
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, todayStart),
          lte(PharmacySalesModel.createdAt, todayEnd)
        )
      );

    const todaySales = Number(todayProfitResult[0]?.totalSales) || 0;
    const todayCost = Number(todayProfitResult[0]?.totalCost) || 0;
    const todayProfit = todaySales - todayCost;

    // Get yesterday's profit for comparison
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
    yesterdayEnd.setHours(23, 59, 59, 999);

    const yesterdayProfitResult = await database
      .select({
        totalSales: sql<string>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${yesterdayStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${yesterdayEnd.toISOString()}::timestamp`}
          ), 0)
        `,
        totalCost: sql<string>`
          COALESCE(SUM(${PharmacySalesItemsModel.total}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnItemsModel.refundAmount})
            FROM ${PharmacySalesReturnItemsModel}
            INNER JOIN ${PharmacySalesReturnModel}
              ON ${PharmacySalesReturnModel.id} = ${PharmacySalesReturnItemsModel.salesReturnId}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${yesterdayStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${yesterdayEnd.toISOString()}::timestamp`}
          ), 0)
        `,
      })
      .from(PharmacySalesModel)
      .leftJoin(
        PharmacySalesItemsModel,
        eq(PharmacySalesModel.id, PharmacySalesItemsModel.pharmacySalesId)
      )
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, yesterdayStart),
          lte(PharmacySalesModel.createdAt, yesterdayEnd)
        )
      );

    const yesterdaySales = Number(yesterdayProfitResult[0]?.totalSales) || 0;
    const yesterdayCost = Number(yesterdayProfitResult[0]?.totalCost) || 0;
    const yesterdayProfit = yesterdaySales - yesterdayCost;

    const profitPercentageChange =
      yesterdayProfit === 0
        ? todayProfit > 0
          ? 100
          : 0
        : ((todayProfit - yesterdayProfit) / yesterdayProfit) * 100;

    // ==================== NEW CARD 2: Average Sales Amount ====================
    // Get today's average sales amount
    const todayAvgSalesResult = await database
      .select({
        totalSales: sql<string>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${todayStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${todayEnd.toISOString()}::timestamp`}
          ), 0)
        `,
        totalOrders: sql<number>`COUNT(*)`,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, todayStart),
          lte(PharmacySalesModel.createdAt, todayEnd)
        )
      );

    const todayTotalSales = Number(todayAvgSalesResult[0]?.totalSales) || 0;
    const todayTotalOrders = Number(todayAvgSalesResult[0]?.totalOrders) || 0;
    const todayAvgSalesAmount =
      todayTotalOrders === 0 ? 0 : todayTotalSales / todayTotalOrders;

    // Get yesterday's average sales amount
    const yesterdayAvgSalesResult = await database
      .select({
        totalSales: sql<string>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${yesterdayStart.toISOString()}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} <= ${sql`${yesterdayEnd.toISOString()}::timestamp`}
          ), 0)
        `,
        totalOrders: sql<number>`COUNT(*)`,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, yesterdayStart),
          lte(PharmacySalesModel.createdAt, yesterdayEnd)
        )
      );

    const yesterdayTotalSales =
      Number(yesterdayAvgSalesResult[0]?.totalSales) || 0;
    const yesterdayTotalOrders =
      Number(yesterdayAvgSalesResult[0]?.totalOrders) || 0;
    const yesterdayAvgSalesAmount =
      yesterdayTotalOrders === 0
        ? 0
        : yesterdayTotalSales / yesterdayTotalOrders;

    const avgSalesPercentageChange =
      yesterdayAvgSalesAmount === 0
        ? todayAvgSalesAmount > 0
          ? 100
          : 0
        : ((todayAvgSalesAmount - yesterdayAvgSalesAmount) /
            yesterdayAvgSalesAmount) *
          100;

    // Sparkline for profit (last 7 days)
    const salesCostSub = database
      .select({
        salesId: PharmacySalesItemsModel.pharmacySalesId,
        totalCost: sql<number>`
            COALESCE(SUM(${PharmacySalesItemsModel.total}), 0)
            - COALESCE(SUM(return_sub.refund_amount), 0)
          `.as('total_cost'),
      })
      .from(PharmacySalesItemsModel)
      .leftJoin(
        sql`
          (
            SELECT
              ${PharmacySalesReturnItemsModel.salesItemId} AS sales_item_id,
              SUM(${PharmacySalesReturnItemsModel.refundAmount}) AS refund_amount
            FROM ${PharmacySalesReturnItemsModel}
            GROUP BY ${PharmacySalesReturnItemsModel.salesItemId}
          ) return_sub
        `,
        sql`return_sub.sales_item_id = ${PharmacySalesItemsModel.id}`
      )
      .groupBy(PharmacySalesItemsModel.pharmacySalesId)
      .as('sales_cost_sub');

    const dailySalesAndProfitResult = await database
      .select({
        dayDate: sql<string>`DATE(${PharmacySalesModel.createdAt})`,
        totalSales: sql<string>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE(SUM(return_amount_sub.total_return_amount), 0)
        `,
        totalOrders: sql<number>`COUNT(DISTINCT ${PharmacySalesModel.id})`,
        totalCost: sql<string>`COALESCE(SUM(${salesCostSub.totalCost}), 0)`,
      })
      .from(PharmacySalesModel)
      .leftJoin(salesCostSub, eq(PharmacySalesModel.id, salesCostSub.salesId))
      .leftJoin(
        sql`
          (
            SELECT
              ${PharmacySalesReturnModel.saleId} AS sale_id,
              SUM(${PharmacySalesReturnModel.totalReturnAmount}) AS total_return_amount
            FROM ${PharmacySalesReturnModel}
            GROUP BY ${PharmacySalesReturnModel.saleId}
          ) return_amount_sub
        `,
        sql`return_amount_sub.sale_id = ${PharmacySalesModel.id}`
      )
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, startOfRange),
          lte(PharmacySalesModel.createdAt, endOfRange)
        )
      )
      .groupBy(sql`DATE(${PharmacySalesModel.createdAt})`);

    const salesProfitMap = new Map(
      dailySalesAndProfitResult.map((r) => {
        const key =
          (r.dayDate as unknown) instanceof Date
            ? (r.dayDate as unknown as Date).toISOString().slice(0, 10)
            : String(r.dayDate).slice(0, 10);
        return [
          key,
          {
            totalSales: Number(r.totalSales) || 0,
            totalCost: Number(r.totalCost) || 0,
            totalOrders: Number(r.totalOrders) || 0,
          },
        ];
      })
    );

    const profitSparkline = [];
    const avgSalesSparkline = [];

    for (const day of last7Days) {
      const key = day.date.toISOString().slice(0, 10);
      const data = salesProfitMap.get(key) || {
        totalSales: 0,
        totalCost: 0,
        totalOrders: 0,
      };
      const dailyProfit = data.totalSales - data.totalCost;
      profitSparkline.push(dailyProfit);

      const dailyAvgAmount =
        data.totalOrders === 0 ? 0 : data.totalSales / data.totalOrders;
      avgSalesSparkline.push(Math.round(dailyAvgAmount));
    }

    // ==================== TOP SELLING BRAND PER DAY (Last 7 days) ====================
    const dailyBrandsResult = await database
      .select({
        dayDate: sql<string>`DATE(${PharmacySalesModel.createdAt})`,
        brandName: pharmacyMedicineModel.brandName,
        totalQuantity: sql<number>`
          SUM(${PharmacySalesItemsModel.quantity})
          - COALESCE(SUM(return_qty_sub.returned_quantity), 0)
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
          ) return_qty_sub
        `,
        sql`return_qty_sub.sales_item_id = ${PharmacySalesItemsModel.id}`
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
          gte(PharmacySalesModel.createdAt, startOfRange),
          lte(PharmacySalesModel.createdAt, endOfRange)
        )
      )
      .groupBy(
        sql`DATE(${PharmacySalesModel.createdAt})`,
        pharmacyMedicineModel.brandName
      )
      .orderBy(
        sql`DATE(${PharmacySalesModel.createdAt})`,
        sql`SUM(${PharmacySalesItemsModel.quantity}) - COALESCE(SUM(return_qty_sub.returned_quantity), 0) DESC`
      );

    const brandMap = new Map<
      string,
      { brandName: string; totalQuantity: number }
    >();
    for (const row of dailyBrandsResult) {
      const key =
        (row.dayDate as unknown) instanceof Date
          ? (row.dayDate as unknown as Date).toISOString().slice(0, 10)
          : String(row.dayDate).slice(0, 10);
      if (!brandMap.has(key)) {
        brandMap.set(key, {
          brandName: row.brandName || 'Brand Not Found',
          totalQuantity: Number(row.totalQuantity) || 0,
        });
      }
    }

    const topBrandPerDay = last7Days.map((day) => {
      const key = day.date.toISOString().slice(0, 10);
      const data = brandMap.get(key) || {
        brandName: 'Brand Not Found',
        totalQuantity: 0,
      };
      return {
        day: day.dayName,
        topBrand: data.brandName,
        quantity: data.totalQuantity,
      };
    });

    // ==================== DASHBOARD RADIALS: Unique medicines grouped by HSN ====================
    const medicinesByHsn = await database
      .select({
        hsnCode: HsnTaxMasterModel.hsnCode,
        description: HsnTaxMasterModel.description,
        gstPercentage: HsnTaxMasterModel.gstPercentage,
        medicineCount: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.id})`,
      })
      .from(pharmacyMedicineModel)
      .innerJoin(
        HsnTaxMasterModel,
        eq(pharmacyMedicineModel.hsnId, HsnTaxMasterModel.id)
      )
      .where(
        and(
          eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
          eq(pharmacyMedicineModel.status, 'active')
        )
      )
      .groupBy(
        HsnTaxMasterModel.hsnCode,
        HsnTaxMasterModel.description,
        HsnTaxMasterModel.gstPercentage
      )
      .orderBy(sql`COUNT(DISTINCT ${pharmacyMedicineModel.id}) DESC`)
      .limit(4);

    // Calculate total unique medicines count across all HSN codes
    const totalMedicinesCountResult = await database
      .select({
        totalCount: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.id})`,
      })
      .from(pharmacyMedicineModel)
      .where(
        and(
          eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
          eq(pharmacyMedicineModel.status, 'active')
        )
      );

    const totalMedicinesCount =
      Number(totalMedicinesCountResult[0]?.totalCount) || 0;

    // Calculate sum of medicines from top 4 HSN codes
    const top4MedicinesSum = medicinesByHsn.reduce(
      (sum, item) => sum + Number(item.medicineCount),
      0
    );

    // Calculate percentage covered by top 4 HSN codes
    const totalPercentageCovered =
      totalMedicinesCount === 0
        ? 0
        : Math.round((top4MedicinesSum / totalMedicinesCount) * 100);

    const dashboardRadials = {
      topHsnCodes: medicinesByHsn.map((item, index) => {
        const colors = ['#69ffcd', '#2ad199', '#12996c', '#046142'];
        return {
          hsnCode: item.hsnCode,
          description: item.description,
          gstPercentage: Number(item.gstPercentage),
          value: Number(item.medicineCount),
          fill: colors[index % colors.length],
        };
      }),
      totalPercentageCovered: totalPercentageCovered,
    };

    return {
      // 4 Cards
      cards: {
        totalMedicines: {
          value: totalMedicines,
          percentageChange: Number(medicinesPercentageChange.toFixed(1)),
          trend: medicinesPercentageChange >= 0 ? 'increase' : 'decrease',
        },
        lowStockMedicines: {
          value: lowStockMedicines,
          percentageChange: Number(
            Math.abs(lowStockPercentageChange).toFixed(1)
          ),
          trend: lowStockPercentageChange >= 0 ? 'increase' : 'decrease',
        },
        todaysSales: {
          value: todaysSales,
          percentageChange: Number(Math.abs(salesPercentageChange).toFixed(1)),
          trend: salesPercentageChange >= 0 ? 'increase' : 'decrease',
        },
        monthlyRevenue: {
          value: monthlyRevenue,
          percentageChange: Number(
            Math.abs(revenuePercentageChange).toFixed(1)
          ),
          trend: revenuePercentageChange >= 0 ? 'increase' : 'decrease',
        },
      },

      // Prescriptions
      prescriptions: {
        totalPrescriptions: totalPrescriptions,
        pending: prescriptionsByStatus.pending,
        onHold: prescriptionsByStatus.onHold,
        completed: prescriptionsByStatus.completed,
        rejected: prescriptionsByStatus.rejected,
      },

      // Radar Data - Category Distribution
      radarData: radarData,

      // Two cards with profit and average sales
      dashboardMetrics: {
        totalProfit: {
          subtext: "Today's profit (Sales - Cost)",
          value: todayProfit,
          percentageChange: Number(profitPercentageChange.toFixed(1)),
          trend: profitPercentageChange >= 0 ? 'increase' : 'decrease',
          sparkline: profitSparkline,
        },
        averageSalesAmount: {
          subtext: 'Value per order today',
          value: Math.round(todayAvgSalesAmount),
          percentageChange: Number(
            Math.abs(avgSalesPercentageChange).toFixed(1)
          ),
          trend: avgSalesPercentageChange >= 0 ? 'increase' : 'decrease',
          sparkline: avgSalesSparkline,
        },
      },

      // Top Selling Brand Per Day
      topBrandPerDay: topBrandPerDay,

      // Bar Data - Last 7 days purchase amounts (paid)
      barData: barData,

      // Radial Data - Top 4 medicines by quantity with HSN
      dashboardRadials: dashboardRadials,
    };
  }

  /**
   * Get sales data for chart (week, month, or year)
   */
  static async getSalesChartData(
    pharmacyId: string,
    period: 'week' | 'month' | 'year'
  ) {
    // Verify pharmacy exists
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

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    const currentDate = new Date();
    let startDate: Date;
    let endDate = new Date(currentDate);
    endDate.setHours(23, 59, 59, 999);

    if (period === 'week') {
      startDate = new Date(currentDate);
      const day = currentDate.getDay();
      const diff = currentDate.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
      startDate.setDate(diff);
      startDate.setHours(0, 0, 0, 0);

      return this.getWeeklySalesData(pharmacyId, startDate, endDate);
    } else if (period === 'month') {
      startDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      startDate.setHours(0, 0, 0, 0);

      return this.getMonthlySalesData(pharmacyId, startDate, endDate);
    } else if (period === 'year') {
      startDate = new Date(currentDate.getFullYear(), 0, 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(currentDate.getFullYear(), 11, 31, 23, 59, 59, 999);

      return this.getYearlySalesData(pharmacyId, startDate, endDate);
    }

    throw new HttpError(400, 'Invalid period. Use week, month, or year');
  }

  /**
   * Get weekly sales data
   */
  private static async getWeeklySalesData(
    pharmacyId: string,
    startDate: Date,
    endDate: Date
  ) {
    const sales = await database
      .select({
        date: PharmacySalesModel.createdAt,
        totalAmount: PharmacySalesModel.totalAmount,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, startDate),
          lte(PharmacySalesModel.createdAt, endDate)
        )
      );

    // Group by day
    const daysMap = new Map<number, number>();
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Initialize all days with 0
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dayIndex = date.getDay();
      const dayKey = dayIndex === 0 ? 6 : dayIndex - 1; // Convert Sunday 0 to 6
      daysMap.set(dayKey, 0);
    }

    // Aggregate sales
    sales.forEach((sale) => {
      const saleDate = new Date(sale.date);
      const dayIndex = saleDate.getDay();
      const dayKey = dayIndex === 0 ? 6 : dayIndex - 1;
      const currentAmount = daysMap.get(dayKey) || 0;
      daysMap.set(dayKey, currentAmount + Number(sale.totalAmount));
    });

    // Format response
    const result = [];
    const today = new Date();
    const currentDay = today.getDay();
    const daysToShow = currentDay === 0 ? 7 : currentDay;

    for (let i = 0; i < daysToShow; i++) {
      result.push({
        day: days[i],
        sales: parseInt((daysMap.get(i) || 0).toFixed(0)),
      });
    }

    return result;
  }

  /**
   * Get monthly sales data
   */
  private static async getMonthlySalesData(
    pharmacyId: string,
    startDate: Date,
    endDate: Date
  ) {
    const sales = await database
      .select({
        date: PharmacySalesModel.createdAt,
        totalAmount: PharmacySalesModel.totalAmount,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, startDate),
          lte(PharmacySalesModel.createdAt, endDate)
        )
      );

    // Group by date
    const datesMap = new Map<string, number>();

    // Initialize all dates in month with 0
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = `${currentDate.getDate()}-${this.getMonthAbbr(currentDate)}`;
      datesMap.set(dateStr, 0);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Aggregate sales
    sales.forEach((sale) => {
      const saleDate = new Date(sale.date);
      const dateStr = `${saleDate.getDate()}-${this.getMonthAbbr(saleDate)}`;
      const currentAmount = datesMap.get(dateStr) || 0;
      datesMap.set(dateStr, currentAmount + Number(sale.totalAmount));
    });

    // Format response
    const result = Array.from(datesMap.entries()).map(([date, amount]) => ({
      date,
      sales: parseInt(amount.toFixed(0)),
    }));

    return result;
  }

  /**
   * Get yearly sales data
   */
  private static async getYearlySalesData(
    pharmacyId: string,
    startDate: Date,
    endDate: Date
  ) {
    const sales = await database
      .select({
        date: PharmacySalesModel.createdAt,
        totalAmount: PharmacySalesModel.totalAmount,
      })
      .from(PharmacySalesModel)
      .where(
        and(
          eq(PharmacySalesModel.pharmacyId, pharmacyId),
          gte(PharmacySalesModel.createdAt, startDate),
          lte(PharmacySalesModel.createdAt, endDate)
        )
      );

    // Group by month
    const monthsMap = new Map<number, number>();
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    // Initialize all months with 0
    for (let i = 0; i < 12; i++) {
      monthsMap.set(i, 0);
    }

    // Aggregate sales
    sales.forEach((sale) => {
      const saleDate = new Date(sale.date);
      const monthIndex = saleDate.getMonth();
      const currentAmount = monthsMap.get(monthIndex) || 0;
      monthsMap.set(monthIndex, currentAmount + Number(sale.totalAmount));
    });

    // Format response
    const result = [];
    const currentMonth = new Date().getMonth();

    for (let i = 0; i <= currentMonth; i++) {
      result.push({
        month: monthNames[i],
        sales: parseInt((monthsMap.get(i) || 0).toFixed(0)),
      });
    }

    return result;
  }

  /**
   * Get top selling medicines (limit 5)
   */
  static async getTopSellingMedicines(pharmacyId: string) {
    // Verify pharmacy exists
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

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    const result = await database
      .select({
        medicineName: pharmacyMedicineModel.medicineName,
        totalSales: sql<string>`SUM(${PharmacySalesItemsModel.total})`,
        quantitySold: sql<number>`SUM(${PharmacySalesItemsModel.quantity})`,
      })
      .from(PharmacySalesItemsModel)
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
      .where(eq(pharmacyMedicineModel.pharmacyId, pharmacyId))
      .groupBy(pharmacyMedicineModel.id, pharmacyMedicineModel.medicineName)
      .orderBy(desc(sql<number>`SUM(${PharmacySalesItemsModel.total})`))
      .limit(5);

    return result.map((medicine) => ({
      medicineName: medicine.medicineName,
      totalSalesAmount: parseFloat(
        (Number(medicine.totalSales) || 0).toFixed(2)
      ),
      quantitySold: Number(medicine.quantitySold) || 0,
    }));
  }

  /**
   * Get top suppliers (limit 5)
   */
  static async getTopSuppliers(pharmacyId: string) {
    // Verify pharmacy exists
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

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    const result = await database
      .select({
        supplierName: PharmacySupplierModel.supplierName,
        phone: PharmacySupplierModel.phone,
        totalAmount: sql<string>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`,
      })
      .from(PharmacySupplierModel)
      .leftJoin(
        PharmacyStockModel,
        and(
          eq(PharmacyStockModel.pharmacySupplierId, PharmacySupplierModel.id),
          eq(PharmacyStockModel.pharmacyId, pharmacyId)
        )
      )
      .where(eq(PharmacySupplierModel.pharmacyId, pharmacyId))
      .groupBy(
        PharmacySupplierModel.id,
        PharmacySupplierModel.supplierName,
        PharmacySupplierModel.phone
      )
      .orderBy(
        desc(sql<number>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`)
      )
      .limit(5);

    return result.map((supplier) => ({
      supplierName: supplier.supplierName,
      supplierNumber: supplier.phone,
      totalPurchaseAmount: parseFloat(
        (Number(supplier.totalAmount) || 0).toFixed(2)
      ),
    }));
  }

  /**
   * Helper function to get month abbreviation
   */
  private static getMonthAbbr(date: Date): string {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return months[date.getMonth()];
  }
}
