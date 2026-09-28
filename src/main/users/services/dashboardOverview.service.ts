import { and, eq, sql, gte, lte, desc, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import {
  PharmacyModel,
  PharmacyAssignModel,
} from '../../pharmacy/models/pharmacy.model';
import {
  UserLabAssignmentsModel,
  LabsModel,
  LabDepartmentsModel,
} from '../../lab/models/lab.model';
import { UserModel } from '../models/user.model';
import { pharmacyMedicineModel } from '../../pharmacies/models/pharmacyMedicine.model';
import { PharmacyStockMedicineModel } from '../../pharmacies/models/pharmacyStockMedicine.model';
import { PharmacyStockModel } from '../../pharmacies/models/pharmacyStock.model';
import { PharmacySupplierModel } from '../../pharmacies/models/pharmacySupplier.model';
import { PharmacySalesItemsModel } from '../../pharmacies/models/pharmacySalesItems.model';
import { PharmacySalesModel } from '../../pharmacies/models/pharmacySales.model';
import {
  PharmacySalesReturnItemsModel,
  PharmacySalesReturnModel,
} from '../../pharmacies/models/pharmacySalesReturn.model';
import { LabSamplesModel } from '../../lab/models/labSample.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';

export class ClinicDashboardOverviewService {
  static async getOverviewData(clinicId: string) {
    const now = new Date();

    // 1. Fetch pharmacy overview
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.clinicId, clinicId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    let pharmacyOverview = {
      totalStockItems: 0,
      lowStockItems: 0,
      stockValue: 0,
      expiringSoon: 0,
      stockStatus: [
        { label: 'Good Stock', value: 0, percentage: 0, color: '#10B981' },
        { label: 'Medium Stock', value: 0, percentage: 0, color: '#F59E0B' },
        { label: 'Low Stock', value: 0, percentage: 0, color: '#EF4444' },
        { label: 'Out of Stock', value: 0, percentage: 0, color: '#6B7280' },
      ],
      topCategories: [] as Array<{
        name: string;
        percentage: number;
        color: string;
      }>,
    };

    if (pharmacy) {
      const pharmacyId = pharmacy.id;

      // Subqueries to calculate sold and returned quantities per batch
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
        .where(eq(PharmacySalesModel.pharmacyId, pharmacyId))
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
        .where(eq(PharmacySalesReturnModel.pharmacyId, pharmacyId))
        .groupBy(PharmacySalesReturnItemsModel.stockMedicineId)
        .as('returns_sub');

      // Main query to get all active medicines and their aggregated stock info
      const inventoryData = await database
        .select({
          id: pharmacyMedicineModel.id,
          medicineName: pharmacyMedicineModel.medicineName,
          category: pharmacyMedicineModel.category,
          reorder: pharmacyMedicineModel.reorder,
          availableQuantity: sql<number>`COALESCE(SUM(GREATEST(
            COALESCE(${PharmacyStockMedicineModel.quantity}, 0) - COALESCE(${salesSub.soldQty}, 0) + COALESCE(${returnsSub.returnedQty}, 0), 0
          )), 0)`,
          inventoryValue: sql<number>`COALESCE(SUM(
            CASE 
              WHEN ${PharmacyStockMedicineModel.expiry} >= NOW() OR ${PharmacyStockMedicineModel.expiry} IS NULL 
              THEN GREATEST(COALESCE(${PharmacyStockMedicineModel.quantity}, 0) - COALESCE(${salesSub.soldQty}, 0) + COALESCE(${returnsSub.returnedQty}, 0), 0) * COALESCE(${PharmacyStockMedicineModel.cost}, 0)
              ELSE 0 
            END
          ), 0)`,
          expiringSoonCount: sql<number>`COUNT(DISTINCT ${PharmacyStockMedicineModel.id}) FILTER (
            WHERE ${PharmacyStockMedicineModel.expiry} >= NOW()
              AND ${PharmacyStockMedicineModel.expiry} <= NOW() + INTERVAL '30 days'
              AND GREATEST(
                COALESCE(${PharmacyStockMedicineModel.quantity}, 0) - COALESCE(${salesSub.soldQty}, 0) + COALESCE(${returnsSub.returnedQty}, 0), 0
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
            eq(pharmacyMedicineModel.status, 'active')
          )
        )
        .groupBy(
          pharmacyMedicineModel.id,
          pharmacyMedicineModel.medicineName,
          pharmacyMedicineModel.category,
          pharmacyMedicineModel.reorder
        );

      let goodCount = 0;
      let mediumCount = 0;
      let lowCount = 0;
      let emptyCount = 0;
      let totalStockItems = 0;
      let lowStockItems = 0;
      let expiringSoon = 0;
      let stockValue = 0;

      for (const item of inventoryData) {
        const available = Number(item.availableQuantity) || 0;
        const reorder = Number(item.reorder || 0);
        const invValue = Number(item.inventoryValue) || 0;
        const expSoon = Number(item.expiringSoonCount) || 0;

        stockValue += invValue;
        if (expSoon > 0) {
          expiringSoon++;
        }

        if (available === 0) {
          emptyCount++;
        } else {
          totalStockItems++; // present with qty more than 0
          if (available <= reorder) {
            lowCount++;
            lowStockItems++; // same calculation of show number of that medicines with low stock
          } else if (available <= reorder * 3) {
            mediumCount++;
          } else {
            goodCount++;
          }
        }
      }

      const totalStatusesCount =
        goodCount + mediumCount + lowCount + emptyCount;

      const stockStatus = [
        {
          label: 'Good Stock',
          value: goodCount,
          percentage:
            totalStatusesCount > 0
              ? Math.round((goodCount / totalStatusesCount) * 100)
              : 0,
          color: '#10B981',
        },
        {
          label: 'Medium Stock',
          value: mediumCount,
          percentage:
            totalStatusesCount > 0
              ? Math.round((mediumCount / totalStatusesCount) * 100)
              : 0,
          color: '#F59E0B',
        },
        {
          label: 'Low Stock',
          value: lowCount,
          percentage:
            totalStatusesCount > 0
              ? Math.round((lowCount / totalStatusesCount) * 100)
              : 0,
          color: '#EF4444',
        },
        {
          label: 'Out of Stock',
          value: emptyCount,
          percentage:
            totalStatusesCount > 0
              ? Math.round((emptyCount / totalStatusesCount) * 100)
              : 0,
          color: '#6B7280',
        },
      ];

      // Top categories based on quantity sold
      const categorySales = await database
        .select({
          category: pharmacyMedicineModel.category,
          totalSold: sql<number>`COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)`,
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
        .innerJoin(
          PharmacySalesModel,
          eq(PharmacySalesItemsModel.pharmacySalesId, PharmacySalesModel.id)
        )
        .where(eq(PharmacySalesModel.pharmacyId, pharmacyId))
        .groupBy(pharmacyMedicineModel.category);

      const categoriesMap = new Map<string, number>();
      let totalSalesQty = 0;

      for (const row of categorySales) {
        const cat = (row.category || 'Others').trim();
        const qty = Number(row.totalSold) || 0;
        if (qty > 0) {
          categoriesMap.set(cat, (categoriesMap.get(cat) || 0) + qty);
          totalSalesQty += qty;
        }
      }

      const sortedCategories = Array.from(categoriesMap.entries())
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty);

      let topCategories: Array<{
        name: string;
        percentage: number;
        color: string;
      }> = [];
      const colors = ['#3B82F6', '#10B981', '#06B6D4', '#F59E0B', '#6B7280'];

      if (totalSalesQty > 0) {
        if (sortedCategories.length <= 5) {
          topCategories = sortedCategories.map((c, i) => ({
            name: c.name,
            percentage: Math.round((c.qty / totalSalesQty) * 100),
            color: colors[i] || '#6B7280',
          }));
        } else {
          const top4 = sortedCategories.slice(0, 4);
          const rest = sortedCategories.slice(4);
          const restQty = rest.reduce((sum, c) => sum + c.qty, 0);

          topCategories = top4.map((c, i) => ({
            name: c.name,
            percentage: Math.round((c.qty / totalSalesQty) * 100),
            color: colors[i],
          }));

          const othersIndex = topCategories.findIndex(
            (c) => c.name.toLowerCase() === 'others'
          );
          const othersPercentage = Math.round((restQty / totalSalesQty) * 100);

          if (othersIndex !== -1) {
            topCategories[othersIndex].percentage += othersPercentage;
          } else {
            topCategories.push({
              name: 'Others',
              percentage: othersPercentage,
              color: '#6B7280',
            });
          }
        }
      }

      pharmacyOverview = {
        totalStockItems,
        lowStockItems,
        stockValue: Math.round(stockValue),
        expiringSoon,
        stockStatus,
        topCategories,
      };
    }

    // 2. Fetch Laboratory Overview
    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0
    );
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    );
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999
    );

    // Total monthly tests
    const [monthCountResult] = await database
      .select({ count: sql<number>`COUNT(*)` })
      .from(LabSamplesModel)
      .where(
        and(
          eq(LabSamplesModel.clinicId, clinicId),
          gte(LabSamplesModel.createdAt, startOfMonth),
          lte(LabSamplesModel.createdAt, endOfMonth)
        )
      );
    const totalMonthTests = Number(monthCountResult?.count) || 0;

    // Tests today
    const [todayCountResult] = await database
      .select({ count: sql<number>`COUNT(*)` })
      .from(LabSamplesModel)
      .where(
        and(
          eq(LabSamplesModel.clinicId, clinicId),
          gte(LabSamplesModel.createdAt, startOfToday),
          lte(LabSamplesModel.createdAt, endOfToday)
        )
      );
    const testsToday = Number(todayCountResult?.count) || 0;

    // Revenue from completed status tests
    const [revenueResult] = await database
      .select({
        total: sql<number>`COALESCE(SUM(${TestCatalogModel.price}), 0)`,
      })
      .from(LabSamplesModel)
      .innerJoin(
        TestCatalogModel,
        eq(LabSamplesModel.testId, TestCatalogModel.id)
      )
      .where(
        and(
          eq(LabSamplesModel.clinicId, clinicId),
          eq(LabSamplesModel.status, 'COMPLETED')
        )
      );
    const revenue = Number(revenueResult?.total) || 0;

    // Pending reports: NOT NOT_STARTED, COMPLETED, or REJECTED
    const [pendingCountResult] = await database
      .select({ count: sql<number>`COUNT(*)` })
      .from(LabSamplesModel)
      .where(
        and(
          eq(LabSamplesModel.clinicId, clinicId),
          sql`${LabSamplesModel.status} NOT IN ('NOT_STARTED', 'COMPLETED', 'REJECTED')`
        )
      );
    const pendingReports = Number(pendingCountResult?.count) || 0;

    // Top test frequency
    const topTestsResult = await database
      .select({
        name: TestCatalogModel.name,
        count: sql<number>`COUNT(*)`,
      })
      .from(LabSamplesModel)
      .innerJoin(
        TestCatalogModel,
        eq(LabSamplesModel.testId, TestCatalogModel.id)
      )
      .where(eq(LabSamplesModel.clinicId, clinicId))
      .groupBy(TestCatalogModel.name)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(5);

    const [totalTestsCountResult] = await database
      .select({ count: sql<number>`COUNT(*)` })
      .from(LabSamplesModel)
      .where(eq(LabSamplesModel.clinicId, clinicId));
    const totalTestsCount = Number(totalTestsCountResult?.count) || 0;

    const testColors = ['#3B82F6', '#10B981', '#06B6D4', '#F59E0B', '#6B7280'];
    const topTest = topTestsResult.map((t, i) => ({
      name: t.name,
      percentage:
        totalTestsCount > 0
          ? Math.round((Number(t.count) / totalTestsCount) * 100)
          : 0,
      color: testColors[i] || '#6B7280',
    }));

    // Status Overview counts
    const statusCountsResult = await database
      .select({
        status: LabSamplesModel.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(LabSamplesModel)
      .where(eq(LabSamplesModel.clinicId, clinicId))
      .groupBy(LabSamplesModel.status);

    let completedCount = 0;
    let rejectedCount = 0;
    let pendingCount = 0; // NOT_STARTED
    let inProgressCount = 0; // NOT NOT_STARTED, COMPLETED, or REJECTED

    for (const row of statusCountsResult) {
      const status = row.status;
      const count = Number(row.count) || 0;

      if (status === 'COMPLETED') {
        completedCount += count;
      } else if (status === 'REJECTED') {
        rejectedCount += count;
      } else if (status === 'NOT_STARTED') {
        pendingCount += count;
      } else {
        inProgressCount += count;
      }
    }

    const totalStatusCount =
      completedCount + rejectedCount + pendingCount + inProgressCount;

    const statusOverview = [
      {
        label: 'Completed',
        value: completedCount,
        percentage:
          totalStatusCount > 0
            ? Math.round((completedCount / totalStatusCount) * 100)
            : 0,
        color: '#10B981',
      },
      {
        label: 'Pending',
        value: pendingCount,
        percentage:
          totalStatusCount > 0
            ? Math.round((pendingCount / totalStatusCount) * 100)
            : 0,
        color: '#F59E0B',
      },
      {
        label: 'In Progress',
        value: inProgressCount,
        percentage:
          totalStatusCount > 0
            ? Math.round((inProgressCount / totalStatusCount) * 100)
            : 0,
        color: '#3B82F6',
      },
      {
        label: 'Rejected',
        value: rejectedCount,
        percentage:
          totalStatusCount > 0
            ? Math.round((rejectedCount / totalStatusCount) * 100)
            : 0,
        color: '#EF4444',
      },
    ];

    const laboratoryOverview = {
      totalMonthTests,
      testsToday,
      revenue,
      pendingReports,
      topTest,
      statusOverview,
    };

    return {
      pharmacyOverview,
      laboratoryOverview,
    };
  }

  static async getClinicDashboardActivities(clinicId: string) {
    // Helper function to format dates to relative human-readable strings
    const formatActivityTimestamp = (date: Date | null | undefined): string => {
      if (!date) return '';
      const d = new Date(date);
      const now = new Date();

      const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday =
        d.getDate() === yesterday.getDate() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getFullYear() === yesterday.getFullYear();

      const hours = d.getHours();
      const minutes = d.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes < 10 ? `0${minutes}` : minutes;
      const timeStr = `${displayHours}:${displayMinutes} ${ampm}`;

      if (isToday) {
        return `Today, ${timeStr}`;
      } else if (isYesterday) {
        return `Yesterday, ${timeStr}`;
      } else {
        const day = d.getDate();
        const months = [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ];
        return `${day} ${months[d.getMonth()]} ${d.getFullYear()}, ${timeStr}`;
      }
    };

    const formatDateToHuman = (date: Date | null | undefined): string => {
      if (!date) return '';
      const d = new Date(date);
      const day = d.getDate();
      const months = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
    };

    // 1. Fetch 5 Recent Lab Activities (Test Catalog additions / updates)
    const recentTestsResult = await database
      .select({
        id: TestCatalogModel.id,
        name: TestCatalogModel.name,
        status: TestCatalogModel.status,
        createdAt: TestCatalogModel.createdAt,
        updatedAt: TestCatalogModel.updatedAt,
      })
      .from(TestCatalogModel)
      .where(
        and(
          eq(TestCatalogModel.clinicId, clinicId),
          eq(TestCatalogModel.isDeleted, false)
        )
      )
      .orderBy(desc(TestCatalogModel.updatedAt))
      .limit(5);

    let recentLabActivities = recentTestsResult.map((item) => {
      const isUpdated =
        item.updatedAt &&
        item.createdAt &&
        Math.abs(item.updatedAt.getTime() - item.createdAt.getTime()) > 1000;

      const subtitle = isUpdated
        ? `${item.name || 'Lab Test'} updated`
        : `${item.name || 'Lab Test'} test added`;

      const statusStr = isUpdated ? 'Done' : 'Completed';

      const iconColor = isUpdated
        ? 'text-amber-500 bg-amber-50 border border-amber-100'
        : 'text-purple-500 bg-purple-50 border border-purple-100';

      return {
        id: item.id,
        title: item.name || 'Lab Test',
        subtitle,
        status: statusStr,
        timestamp: formatActivityTimestamp(item.updatedAt || item.createdAt),
        iconColor,
      };
    });

    if (recentLabActivities.length === 0) {
      // Fallback to lab samples if catalog is empty
      const recentLabsResult = await database
        .select({
          id: LabSamplesModel.id,
          status: LabSamplesModel.status,
          createdAt: LabSamplesModel.createdAt,
          testName: TestCatalogModel.name,
        })
        .from(LabSamplesModel)
        .innerJoin(
          TestCatalogModel,
          eq(LabSamplesModel.testId, TestCatalogModel.id)
        )
        .where(eq(LabSamplesModel.clinicId, clinicId))
        .orderBy(desc(LabSamplesModel.createdAt))
        .limit(5);

      recentLabActivities = recentLabsResult.map((item) => {
        const statusStr =
          item.status === 'COMPLETED'
            ? 'Completed'
            : item.status === 'NOT_STARTED'
              ? 'Pending'
              : item.status === 'REJECTED'
                ? 'Rejected'
                : 'In Progress';

        const iconColor =
          item.status === 'COMPLETED'
            ? 'text-purple-500 bg-purple-50 border border-purple-100'
            : item.status === 'NOT_STARTED'
              ? 'text-amber-500 bg-amber-50 border border-amber-100'
              : item.status === 'REJECTED'
                ? 'text-rose-500 bg-rose-50 border border-rose-100'
                : 'text-blue-500 bg-blue-50 border border-blue-100';

        return {
          id: item.id,
          title: item.testName || 'Lab Test',
          subtitle: `${item.testName || 'Lab Test'} test added`,
          status: statusStr,
          timestamp: formatActivityTimestamp(item.createdAt),
          iconColor,
        };
      });
    }

    // 2. Fetch 5 Recent Pharmacy Activities (medicine add, stock add, and sales)
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.clinicId, clinicId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    let recentPharmacyActivities: any[] = [];

    if (pharmacy) {
      const pharmacyId = pharmacy.id;

      // A. Query recent medicines added
      const recentMedicines = await database
        .select({
          id: pharmacyMedicineModel.id,
          medicineName: pharmacyMedicineModel.medicineName,
          createdAt: pharmacyMedicineModel.createdAt,
          medicineId: pharmacyMedicineModel.id,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            eq(pharmacyMedicineModel.status, 'active')
          )
        )
        .orderBy(desc(pharmacyMedicineModel.createdAt))
        .limit(5);

      // B. Query recent stock additions
      const recentStock = await database
        .select({
          id: PharmacyStockMedicineModel.id,
          medicineId: pharmacyMedicineModel.id,
          medicineName: pharmacyMedicineModel.medicineName,
          createdAt: PharmacyStockMedicineModel.createdAt,
        })
        .from(PharmacyStockMedicineModel)
        .innerJoin(
          PharmacyStockModel,
          eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
        )
        .innerJoin(
          pharmacyMedicineModel,
          eq(
            PharmacyStockMedicineModel.pharmacyMedicineId,
            pharmacyMedicineModel.id
          )
        )
        .where(eq(PharmacyStockModel.pharmacyId, pharmacyId))
        .orderBy(desc(PharmacyStockMedicineModel.createdAt))
        .limit(5);

      // C. Query recent sales
      const recentSales = await database
        .select({
          id: PharmacySalesItemsModel.id,
          medicineId: pharmacyMedicineModel.id,
          medicineName: pharmacyMedicineModel.medicineName,
          createdAt: PharmacySalesItemsModel.createdAt,
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
        .where(eq(PharmacySalesModel.pharmacyId, pharmacyId))
        .orderBy(desc(PharmacySalesItemsModel.createdAt))
        .limit(5);

      // Merge and sort combined list
      const combined = [
        ...recentMedicines.map((m) => ({
          ...m,
          type: 'medicine_add' as const,
        })),
        ...recentStock.map((s) => ({ ...s, type: 'stock_add' as const })),
        ...recentSales.map((sl) => ({ ...sl, type: 'sale' as const })),
      ]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 5);

      const medicineIds = [...new Set(combined.map((c) => c.medicineId))];
      const stockStatusMap = new Map<string, string>();

      if (medicineIds.length > 0) {
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
          .where(eq(PharmacySalesModel.pharmacyId, pharmacyId))
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
          .where(eq(PharmacySalesReturnModel.pharmacyId, pharmacyId))
          .groupBy(PharmacySalesReturnItemsModel.stockMedicineId)
          .as('returns_sub');

        const medStocks = await database
          .select({
            medicineId: pharmacyMedicineModel.id,
            reorder: pharmacyMedicineModel.reorder,
            availableQuantity: sql<number>`COALESCE(SUM(GREATEST(
              COALESCE(${PharmacyStockMedicineModel.quantity}, 0) - COALESCE(${salesSub.soldQty}, 0) + COALESCE(${returnsSub.returnedQty}, 0), 0
            )), 0)`,
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
            salesSub,
            eq(PharmacyStockMedicineModel.id, salesSub.batchId)
          )
          .leftJoin(
            returnsSub,
            eq(PharmacyStockMedicineModel.id, returnsSub.batchId)
          )
          .where(
            and(
              eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
              inArray(pharmacyMedicineModel.id, medicineIds)
            )
          )
          .groupBy(pharmacyMedicineModel.id, pharmacyMedicineModel.reorder);

        for (const ms of medStocks) {
          const qty = Number(ms.availableQuantity) || 0;
          const reorder = Number(ms.reorder || 0);
          let status = 'Out of Stock';
          if (qty > reorder) {
            status = 'In Stock';
          } else if (qty > 0) {
            status = 'Low Stock';
          }
          stockStatusMap.set(ms.medicineId, status);
        }
      }

      recentPharmacyActivities = combined.map((item) => {
        const statusStr = stockStatusMap.get(item.medicineId) || 'In Stock';
        let iconColor =
          'text-emerald-500 bg-emerald-50 border border-emerald-100';
        let subtitle = '';

        if (item.type === 'medicine_add') {
          subtitle = `New medicine added: ${item.medicineName}`;
          iconColor = 'text-purple-500 bg-purple-50 border border-purple-100';
        } else if (item.type === 'stock_add') {
          subtitle = `Stock updated for ${item.medicineName}`;
          iconColor = 'text-amber-500 bg-amber-50 border border-amber-100';
        } else {
          subtitle = `Stock updated (Sale) for ${item.medicineName}`;
          iconColor = 'text-blue-500 bg-blue-50 border border-blue-100';
        }

        return {
          id: item.id,
          title: item.medicineName || 'Medicine',
          subtitle,
          status: statusStr,
          timestamp: formatActivityTimestamp(item.createdAt),
          iconColor,
        };
      });
    }

    // 3. Fetch Pharma and Lab Active Users
    const pharmacyUsers = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        mobile: UserModel.mobile,
        createdAt: UserModel.createdAt,
      })
      .from(PharmacyAssignModel)
      .innerJoin(UserModel, eq(PharmacyAssignModel.userId, UserModel.id))
      .where(
        and(
          eq(PharmacyAssignModel.clinicId, clinicId),
          eq(UserModel.isArchive, false)
        )
      );

    const labUsers = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        mobile: UserModel.mobile,
        createdAt: UserModel.createdAt,
      })
      .from(UserLabAssignmentsModel)
      .innerJoin(UserModel, eq(UserLabAssignmentsModel.userId, UserModel.id))
      .where(
        and(
          eq(UserLabAssignmentsModel.clinicId, clinicId),
          eq(UserModel.isArchive, false)
        )
      );

    const userMap = new Map<string, any>();

    for (const u of pharmacyUsers) {
      if (u.id) {
        userMap.set(u.id, {
          id: u.id,
          name: u.name || '',
          email: u.email || '',
          mobile: u.mobile || '',
          createdAt: formatDateToHuman(u.createdAt),
          status: 'Pharmacist',
        });
      }
    }

    for (const u of labUsers) {
      if (u.id) {
        userMap.set(u.id, {
          id: u.id,
          name: u.name || '',
          email: u.email || '',
          mobile: u.mobile || '',
          createdAt: formatDateToHuman(u.createdAt),
          status: 'Lab Assistant',
        });
      }
    }

    const pharmaLabActiveUsers = Array.from(userMap.values());

    return {
      recentLabActivities,
      recentPharmacyActivities,
      pharmaLabActiveUsers,
    };
  }

  static async getClinicDashboardStats(clinicId: string) {
    // 1. Pharmacy total sales and suppliers
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.clinicId, clinicId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    let totalSales = 0;
    let totalSuppliers = 0;

    if (pharmacy) {
      const pharmacyId = pharmacy.id;

      const [salesCountResult] = await database
        .select({ count: sql<number>`COUNT(*)` })
        .from(PharmacySalesModel)
        .where(eq(PharmacySalesModel.pharmacyId, pharmacyId));
      totalSales = Number(salesCountResult?.count) || 0;

      const [supplierCountResult] = await database
        .select({ count: sql<number>`COUNT(*)` })
        .from(PharmacySupplierModel)
        .where(eq(PharmacySupplierModel.pharmacyId, pharmacyId));
      totalSuppliers = Number(supplierCountResult?.count) || 0;
    }

    // 2. Lab total departments and completed tests
    const labs = await database
      .select({ id: LabsModel.id })
      .from(LabsModel)
      .where(
        and(
          eq(LabsModel.clinicId, clinicId),
          sql`${LabsModel.deletedAt} IS NULL`
        )
      );

    const labIds = labs.map((l) => l.id);
    let totalDepartments = 0;

    if (labIds.length > 0) {
      const [deptCountResult] = await database
        .select({ count: sql<number>`COUNT(*)` })
        .from(LabDepartmentsModel)
        .where(inArray(LabDepartmentsModel.labId, labIds));
      totalDepartments = Number(deptCountResult?.count) || 0;
    }

    // Count completed tests
    const [completedTestsResult] = await database
      .select({ count: sql<number>`COUNT(*)` })
      .from(LabSamplesModel)
      .where(
        and(
          eq(LabSamplesModel.clinicId, clinicId),
          eq(LabSamplesModel.status, 'COMPLETED')
        )
      );
    const totalCompletedTests = Number(completedTestsResult?.count) || 0;

    return {
      totalSales,
      totalSuppliers,
      totalDepartments,
      totalCompletedTests,
    };
  }
}
