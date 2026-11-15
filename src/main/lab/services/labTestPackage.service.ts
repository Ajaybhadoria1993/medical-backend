import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  SQL,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { FEATURE_KEYS, LimitationService } from '../../subscription';
import { LabsModel, UserLabAssignmentsModel } from '../models/lab.model';
import { LabTestCatalogModel } from '../../test/models/labTestCatalog.model';
import {
  LabTestPackageItemModel,
  LabTestPackageModel,
} from '../models/labTestPackage.model';
import {
  CreateLabTestPackageInput,
  GetLabTestPackagesQueryInput,
  UpdateLabTestPackageInput,
} from '../schemas/lab.schemas';

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

type LabPackageContext = {
  labId: string;
  userId: string;
  userRole: string;
};

type PackageRow = typeof LabTestPackageModel.$inferSelect;
type LabCatalogTestRow = typeof LabTestCatalogModel.$inferSelect;

export class LabTestPackageService {
  private static uniqueIds(ids: string[]) {
    return Array.from(new Set(ids));
  }

  private static getDiscount(totalTestPrice: number, packagePrice: number) {
    const discountPrice = Math.max(totalTestPrice - packagePrice, 0);
    const discountPercent =
      totalTestPrice > 0
        ? Math.round((discountPrice / totalTestPrice) * 10000) / 100
        : 0;

    return {
      discountPrice,
      discountPercent,
      // Kept as aliases because the requested response used this spelling.
      discoutPrice: discountPrice,
      discoutPercent: discountPercent,
    };
  }

  private static formatPackage(
    labPackage: PackageRow,
    tests: LabCatalogTestRow[]
  ) {
    const totalTestPrice = tests.reduce(
      (total, test) => total + Number(test.price ?? 0),
      0
    );

    return {
      ...labPackage,
      totalTestPrice,
      ...this.getDiscount(totalTestPrice, labPackage.packagePrice),
      tests,
    };
  }

  private static async verifyLabAccess(
    trx: DbTransaction,
    labId: string,
    context: LabPackageContext
  ) {
    const [lab] = await trx
      .select({ id: LabsModel.id, clinicId: LabsModel.clinicId })
      .from(LabsModel)
      .where(and(eq(LabsModel.id, labId), isNull(LabsModel.deletedAt)))
      .limit(1);

    if (!lab) {
      throw new HttpError(404, 'Lab not found');
    }

    const feature = await LimitationService.isFeatureEnabled(
      lab.clinicId,
      FEATURE_KEYS.LAB_INTEGRATION
    );

    if (!feature.allowed) {
      throw new HttpError(
        403,
        feature.message || 'Lab integration is not available for this clinic'
      );
    }

    if (context.userRole === 'Super_Admin') {
      return;
    }

    const [assignment] = await trx
      .select({ id: UserLabAssignmentsModel.id })
      .from(UserLabAssignmentsModel)
      .where(
        and(
          eq(UserLabAssignmentsModel.userId, context.userId),
          eq(UserLabAssignmentsModel.labId, labId)
        )
      )
      .limit(1);

    if (!assignment) {
      throw new HttpError(403, 'User is not assigned to this lab');
    }
  }

  private static async ensureUniquePackageCode(
    trx: DbTransaction,
    labId: string,
    packageCode: string,
    packageId?: string
  ) {
    const conditions = [
      eq(LabTestPackageModel.labId, labId),
      eq(LabTestPackageModel.packageCode, packageCode),
      isNull(LabTestPackageModel.deletedAt),
    ];

    if (packageId) {
      conditions.push(ne(LabTestPackageModel.id, packageId));
    }

    const [existing] = await trx
      .select({ id: LabTestPackageModel.id })
      .from(LabTestPackageModel)
      .where(and(...conditions))
      .limit(1);

    if (existing) {
      throw new HttpError(409, 'Package code already exists for this lab');
    }
  }

  private static async ensureUniquePackageName(
    trx: DbTransaction,
    labId: string,
    packageName: string,
    packageId?: string
  ) {
    const conditions = [
      eq(LabTestPackageModel.labId, labId),
      ilike(LabTestPackageModel.packageName, packageName),
      isNull(LabTestPackageModel.deletedAt),
    ];

    if (packageId) {
      conditions.push(ne(LabTestPackageModel.id, packageId));
    }

    const [existing] = await trx
      .select({ id: LabTestPackageModel.id })
      .from(LabTestPackageModel)
      .where(and(...conditions))
      .limit(1);

    if (existing) {
      throw new HttpError(409, 'Package name already exists for this lab');
    }
  }

  private static async getValidPackageTests(
    trx: DbTransaction,
    labId: string,
    labTestIds: string[]
  ) {
    const uniqueLabTestIds = this.uniqueIds(labTestIds);
    if (uniqueLabTestIds.length !== labTestIds.length) {
      throw new HttpError(400, 'Duplicate lab tests are not allowed');
    }

    const tests = await trx
      .select()
      .from(LabTestCatalogModel)
      .where(
        and(
          inArray(LabTestCatalogModel.id, uniqueLabTestIds),
          eq(LabTestCatalogModel.labId, labId),
          eq(LabTestCatalogModel.status, 'active'),
          isNull(LabTestCatalogModel.deletedAt)
        )
      );

    if (tests.length !== uniqueLabTestIds.length) {
      const foundIds = tests.map((test) => test.id);
      const missingIds = uniqueLabTestIds.filter(
        (testId) => !foundIds.includes(testId)
      );
      throw new HttpError(
        404,
        `Lab tests not found or inactive: ${missingIds.join(', ')}`
      );
    }

    const testsWithoutPrice = tests.filter(
      (test) => test.price === null || Number(test.price) <= 0
    );

    if (testsWithoutPrice.length > 0) {
      throw new HttpError(
        400,
        `Price is required for lab tests: ${testsWithoutPrice
          .map((test) => test.name)
          .join(', ')}`
      );
    }

    return tests;
  }

  private static ensurePackagePriceAllowed(
    packagePrice: number,
    tests: LabCatalogTestRow[]
  ) {
    const totalTestPrice = tests.reduce(
      (total, test) => total + Number(test.price ?? 0),
      0
    );

    if (packagePrice > totalTestPrice) {
      throw new HttpError(
        400,
        'Package price cannot exceed total price of included tests'
      );
    }
  }

  private static async getPackageTestIds(
    trx: DbTransaction,
    packageId: string
  ) {
    const items = await trx
      .select({ labTestId: LabTestPackageItemModel.labTestId })
      .from(LabTestPackageItemModel)
      .where(eq(LabTestPackageItemModel.packageId, packageId))
      .orderBy(asc(LabTestPackageItemModel.createdAt));

    return items.map((item) => item.labTestId);
  }

  private static async replacePackageItems(
    trx: DbTransaction,
    packageId: string,
    labTestIds: string[],
    now = new Date()
  ) {
    await trx
      .delete(LabTestPackageItemModel)
      .where(eq(LabTestPackageItemModel.packageId, packageId));

    if (labTestIds.length === 0) {
      return;
    }

    await trx.insert(LabTestPackageItemModel).values(
      labTestIds.map((labTestId) => ({
        packageId,
        labTestId,
        createdAt: now,
        updatedAt: now,
      }))
    );
  }

  private static async getFormattedPackages(
    trx: DbTransaction,
    packages: PackageRow[]
  ) {
    if (packages.length === 0) return [];

    const packageIds = packages.map((labPackage) => labPackage.id);
    const itemRows = await trx
      .select({
        packageId: LabTestPackageItemModel.packageId,
        test: LabTestCatalogModel,
      })
      .from(LabTestPackageItemModel)
      .innerJoin(
        LabTestCatalogModel,
        eq(LabTestPackageItemModel.labTestId, LabTestCatalogModel.id)
      )
      .where(
        and(
          inArray(LabTestPackageItemModel.packageId, packageIds),
          isNull(LabTestCatalogModel.deletedAt)
        )
      )
      .orderBy(
        asc(LabTestPackageItemModel.createdAt),
        asc(LabTestCatalogModel.name)
      );

    const testsByPackageId = new Map<string, LabCatalogTestRow[]>();
    for (const item of itemRows) {
      const tests = testsByPackageId.get(item.packageId) ?? [];
      tests.push(item.test);
      testsByPackageId.set(item.packageId, tests);
    }

    return packages.map((labPackage) =>
      this.formatPackage(labPackage, testsByPackageId.get(labPackage.id) ?? [])
    );
  }

  static async createPackage(
    payload: CreateLabTestPackageInput,
    context: LabPackageContext
  ) {
    return await database.transaction(async (trx) => {
      await this.verifyLabAccess(trx, context.labId, context);
      await this.ensureUniquePackageCode(
        trx,
        context.labId,
        payload.packageCode
      );
      await this.ensureUniquePackageName(
        trx,
        context.labId,
        payload.packageName
      );

      const tests = await this.getValidPackageTests(
        trx,
        context.labId,
        payload.labTest
      );
      this.ensurePackagePriceAllowed(payload.packagePrice, tests);

      const now = new Date();
      const [labPackage] = await trx
        .insert(LabTestPackageModel)
        .values({
          labId: context.labId,
          packageName: payload.packageName,
          packageCode: payload.packageCode,
          packageDescription: payload.packageDescription,
          packagePrice: payload.packagePrice,
          status: payload.status,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await this.replacePackageItems(trx, labPackage.id, payload.labTest, now);

      return this.formatPackage(labPackage, tests);
    });
  }

  static async updatePackage(
    packageId: string,
    payload: UpdateLabTestPackageInput,
    context: LabPackageContext
  ) {
    return await database.transaction(async (trx) => {
      const [existingPackage] = await trx
        .select()
        .from(LabTestPackageModel)
        .where(
          and(
            eq(LabTestPackageModel.id, packageId),
            isNull(LabTestPackageModel.deletedAt)
          )
        )
        .limit(1);

      if (!existingPackage) {
        throw new HttpError(404, 'Lab test package not found');
      }

      if (context.labId !== existingPackage.labId) {
        throw new HttpError(403, 'Package does not belong to this lab');
      }

      await this.verifyLabAccess(trx, existingPackage.labId, context);

      const isSoftDeleteOnly =
        payload.deletedAt instanceof Date &&
        Object.keys(payload).every((key) => key === 'deletedAt');

      if (isSoftDeleteOnly) {
        const now = new Date();
        const [deletedPackage] = await trx
          .update(LabTestPackageModel)
          .set({
            deletedAt: payload.deletedAt,
            updatedAt: now,
          })
          .where(eq(LabTestPackageModel.id, packageId))
          .returning();

        const tests = await trx
          .select({ test: LabTestCatalogModel })
          .from(LabTestPackageItemModel)
          .innerJoin(
            LabTestCatalogModel,
            eq(LabTestPackageItemModel.labTestId, LabTestCatalogModel.id)
          )
          .where(eq(LabTestPackageItemModel.packageId, packageId))
          .orderBy(asc(LabTestPackageItemModel.createdAt));

        return this.formatPackage(
          deletedPackage,
          tests.map((row) => row.test)
        );
      }

      if (payload.packageCode) {
        await this.ensureUniquePackageCode(
          trx,
          existingPackage.labId,
          payload.packageCode,
          packageId
        );
      }

      if (payload.packageName) {
        await this.ensureUniquePackageName(
          trx,
          existingPackage.labId,
          payload.packageName,
          packageId
        );
      }

      const labTestIds =
        payload.labTest ?? (await this.getPackageTestIds(trx, packageId));
      const tests = await this.getValidPackageTests(
        trx,
        existingPackage.labId,
        labTestIds
      );
      const packagePrice = payload.packagePrice ?? existingPackage.packagePrice;
      this.ensurePackagePriceAllowed(packagePrice, tests);

      const now = new Date();
      const [updatedPackage] = await trx
        .update(LabTestPackageModel)
        .set({
          ...(payload.packageName ? { packageName: payload.packageName } : {}),
          ...(payload.packageCode ? { packageCode: payload.packageCode } : {}),
          ...(payload.packageDescription
            ? { packageDescription: payload.packageDescription }
            : {}),
          ...(payload.packagePrice !== undefined
            ? { packagePrice: payload.packagePrice }
            : {}),
          ...(payload.status ? { status: payload.status } : {}),
          ...(payload.deletedAt !== undefined
            ? { deletedAt: payload.deletedAt }
            : {}),
          updatedAt: now,
        })
        .where(eq(LabTestPackageModel.id, packageId))
        .returning();

      if (payload.labTest) {
        await this.replacePackageItems(trx, packageId, payload.labTest, now);
      }

      return this.formatPackage(updatedPackage, tests);
    });
  }

  static async getPackages(
    context: LabPackageContext,
    query: GetLabTestPackagesQueryInput = {
      page: 1,
      limit: 10,
    }
  ) {
    return await database.transaction(async (trx) => {
      await this.verifyLabAccess(trx, context.labId, context);

      const page = Math.max(Number(query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
      const offset = (page - 1) * limit;
      const conditions: SQL[] = [
        eq(LabTestPackageModel.labId, context.labId),
        isNull(LabTestPackageModel.deletedAt),
      ];

      if (query.status) {
        conditions.push(eq(LabTestPackageModel.status, query.status));
      }

      if (query.search) {
        const pattern = `%${query.search}%`;
        const searchCondition = or(
          ilike(LabTestPackageModel.packageName, pattern),
          ilike(LabTestPackageModel.packageCode, pattern),
          ilike(LabTestPackageModel.packageDescription, pattern)
        );

        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      const whereCondition = and(...conditions);
      const labScopeCondition = and(
        eq(LabTestPackageModel.labId, context.labId),
        isNull(LabTestPackageModel.deletedAt)
      );
      const [{ total }] = await trx
        .select({ total: count() })
        .from(LabTestPackageModel)
        .where(whereCondition);

      const [packageStats] = await trx
        .select({
          totalPackages: count(),
        })
        .from(LabTestPackageModel)
        .where(labScopeCondition);

      const [activePackageStats] = await trx
        .select({
          activePackages: count(),
        })
        .from(LabTestPackageModel)
        .where(
          and(labScopeCondition, eq(LabTestPackageModel.status, 'Active'))
        );

      const [inactivePackageStats] = await trx
        .select({
          inactivePackages: count(),
        })
        .from(LabTestPackageModel)
        .where(
          and(labScopeCondition, eq(LabTestPackageModel.status, 'Inactive'))
        );

      const [packageTestStats] = await trx
        .select({
          testsInPackages: count(),
        })
        .from(LabTestPackageItemModel)
        .innerJoin(
          LabTestPackageModel,
          eq(LabTestPackageItemModel.packageId, LabTestPackageModel.id)
        )
        .where(labScopeCondition);

      const packages = await trx
        .select()
        .from(LabTestPackageModel)
        .where(whereCondition)
        .orderBy(asc(LabTestPackageModel.packageName))
        .limit(limit)
        .offset(offset);

      const totalRecords = Number(total ?? 0);
      const totalPages = Math.ceil(totalRecords / limit);

      return {
        packages: await this.getFormattedPackages(trx, packages),
        pagination: {
          page,
          limit,
          total: totalRecords,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        statsCounts: {
          totalPackages: Number(packageStats?.totalPackages ?? 0),
          activePackages: Number(activePackageStats?.activePackages ?? 0),
          inactivePackages: Number(inactivePackageStats?.inactivePackages ?? 0),
          testsInPackages: Number(packageTestStats?.testsInPackages ?? 0),
        },
      };
    });
  }

  static async getPackageById(packageId: string, context: LabPackageContext) {
    return await database.transaction(async (trx) => {
      const [labPackage] = await trx
        .select()
        .from(LabTestPackageModel)
        .where(
          and(
            eq(LabTestPackageModel.id, packageId),
            isNull(LabTestPackageModel.deletedAt)
          )
        )
        .limit(1);

      if (!labPackage) {
        throw new HttpError(404, 'Lab test package not found');
      }

      await this.verifyLabAccess(trx, labPackage.labId, context);

      if (context.labId !== labPackage.labId) {
        throw new HttpError(403, 'Package does not belong to this lab');
      }

      const [formattedPackage] = await this.getFormattedPackages(trx, [
        labPackage,
      ]);

      return formattedPackage;
    });
  }
}
