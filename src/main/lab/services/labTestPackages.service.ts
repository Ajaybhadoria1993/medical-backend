import { and, asc, count, eq, ilike, isNull, or, SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { LabUpdatedTestPackageModel } from '../models/labUpdated.model';
import {
  CreateLabTestPackageInput,
  GetLabTestPackagesQueryInput,
  UpdateLabTestPackageInput,
} from '../schemas/labTestPackages.schemas';
import {
  formatPackage,
  getValidTests,
  LabCatalogContext,
  pageMeta,
  pagination,
  replacePackageItems,
  verifyLabAccess,
} from './labCatalog.service';

export class LabTestPackagesService {
  static async createPackage(
    payload: CreateLabTestPackageInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      await getValidTests(trx, context.labId, payload.labTestIds);

      const now = new Date();
      const [labPackage] = await trx
        .insert(LabUpdatedTestPackageModel)
        .values({
          labId: context.labId,
          packageName: payload.packageName,
          packageCode: payload.packageCode,
          packagePrice: payload.packagePrice,
          status: payload.status,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await replacePackageItems(trx, labPackage.id, payload.labTestIds, now);

      return await formatPackage(trx, labPackage.id);
    });
  }

  static async getPackages(
    context: LabCatalogContext,
    query: GetLabTestPackagesQueryInput
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const { page, limit, offset } = pagination(query);
      const conditions: SQL[] = [
        eq(LabUpdatedTestPackageModel.labId, context.labId),
        isNull(LabUpdatedTestPackageModel.deletedAt),
      ];

      if (query.status) {
        conditions.push(eq(LabUpdatedTestPackageModel.status, query.status));
      }
      if (query.search) {
        conditions.push(
          or(
            ilike(LabUpdatedTestPackageModel.packageName, `%${query.search}%`),
            ilike(LabUpdatedTestPackageModel.packageCode, `%${query.search}%`)
          ) as SQL
        );
      }

      const where = and(...conditions);
      const [{ total }] = await trx
        .select({ total: count() })
        .from(LabUpdatedTestPackageModel)
        .where(where);

      const packages = await trx
        .select()
        .from(LabUpdatedTestPackageModel)
        .where(where)
        .orderBy(asc(LabUpdatedTestPackageModel.packageName))
        .limit(limit)
        .offset(offset);

      return {
        packages: await Promise.all(
          packages.map((labPackage) => formatPackage(trx, labPackage.id))
        ),
        pagination: pageMeta(Number(total ?? 0), page, limit),
      };
    });
  }

  static async getPackageById(packageId: string, context: LabCatalogContext) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const labPackage = await formatPackage(trx, packageId);
      if (labPackage.labId !== context.labId) {
        throw new HttpError(403, 'Package does not belong to this lab');
      }
      return labPackage;
    });
  }

  static async updatePackage(
    packageId: string,
    payload: UpdateLabTestPackageInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const existingPackage = await formatPackage(trx, packageId);
      if (existingPackage.labId !== context.labId) {
        throw new HttpError(403, 'Package does not belong to this lab');
      }

      if (payload.labTestIds) {
        await getValidTests(trx, context.labId, payload.labTestIds);
      }

      await trx
        .update(LabUpdatedTestPackageModel)
        .set({
          ...(payload.packageName ? { packageName: payload.packageName } : {}),
          ...(payload.packageCode ? { packageCode: payload.packageCode } : {}),
          ...(payload.packagePrice !== undefined
            ? { packagePrice: payload.packagePrice }
            : {}),
          ...(payload.status ? { status: payload.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(LabUpdatedTestPackageModel.id, packageId));

      if (payload.labTestIds) {
        await replacePackageItems(trx, packageId, payload.labTestIds);
      }

      return await formatPackage(trx, existingPackage.id);
    });
  }
}
