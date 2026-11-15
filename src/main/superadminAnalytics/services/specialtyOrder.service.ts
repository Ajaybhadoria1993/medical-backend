import { asc } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import logger from '../../../utils/logger';
import {
  CacheKeys,
  getOrSetCache,
  invalidateCache,
} from '../../../utils/cache.util';
import { SPECIALTY_CATALOG_RESPONSE } from '../../../utils/doctorSpecialtyConfig';
import { SpecialtyOrderModel } from '../models/specialtyOrder.model';
import { applySpecialtyOrder } from '../utils/specialtyOrder.utils';

const ORDER_TTL_SECONDS = 24 * 60 * 60;

/** Super Admin's display order for the main specialities, applied to the served catalog. */
export class SpecialtyOrderService {
  /** Replaces the whole saved order in one transaction. */
  static async save(order: readonly string[]) {
    await database.transaction(async (tx) => {
      await tx.delete(SpecialtyOrderModel);
      await tx
        .insert(SpecialtyOrderModel)
        .values(
          order.map((mainSpecialty, position) => ({ mainSpecialty, position }))
        );
    });
    await invalidateCache(CacheKeys.specialtyDisplayOrder());
  }

  /** Saved names in display order; empty on failure so callers fall back to catalog order. */
  static async savedOrder(): Promise<string[]> {
    // The loader throws on a DB error, so a failure is never cached as an empty order.
    try {
      return await getOrSetCache(
        CacheKeys.specialtyDisplayOrder(),
        ORDER_TTL_SECONDS,
        async () => {
          const rows = await database
            .select({ name: SpecialtyOrderModel.mainSpecialty })
            .from(SpecialtyOrderModel)
            .orderBy(asc(SpecialtyOrderModel.position));
          return rows.map((r) => r.name);
        }
      );
    } catch (error) {
      logger.error('Specialty order read failed; serving catalog order', {
        error,
      });
      return [];
    }
  }

  /** Catalog in saved order; never throws, so every picker keeps working. */
  static async orderedCatalog() {
    return applySpecialtyOrder(
      SPECIALTY_CATALOG_RESPONSE,
      await this.savedOrder()
    );
  }
}
