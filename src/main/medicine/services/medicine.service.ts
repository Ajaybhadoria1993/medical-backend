/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, sql, desc, asc, ilike, or, SQL, ne } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { MedicineModel } from '../models/medicine.model';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
import { pagination } from '../../../utils/utils';
import { normaliseMedicineForm } from '../schemas/medine.schemas';

export type CreateMedicinePayload = {
  name: string;
  genericName?: string;
  manufacturer?: string;
  composition?: string;
  form?: string;
  strength?: string;
  category?: string;
  requiresPrescription?: boolean;
  createdByUserId?: string; // Doctor ID
};

export type UpdateMedicinePayload = Partial<CreateMedicinePayload> & {
  isActive?: boolean;
};

export type SearchMedicineQuery = {
  q?: string;
  category?: string;
  requiresPrescription?: boolean;
  isActive?: boolean;
  pageNumber?: number;
  pageSize?: number;
  userId?: string;
};

export class MedicineService {
  /**
   * Invalidate all medicine-related caches after mutations
   */
  private static async invalidateMedicineCache(medicineId?: string) {
    const pipeline = redisClient.pipeline();

    if (medicineId) {
      pipeline.del(`medicine:${medicineId}`);
    }

    // Invalidate list caches
    pipeline.del('medicines:list:generics');
    pipeline.del('medicines:list:brands');
    pipeline.del('medicines:list:manufacturers');
    pipeline.del('medicines:list:categories');

    await pipeline.exec();

    // Invalidate search caches (pattern-based)
    const searchKeys = await redisClient.keys('medicines:search:*');
    if (searchKeys.length > 0) {
      await redisClient.del(...searchKeys);
    }
  }

  /**
   * Create a new medicine or reactivate a previously soft-deleted one.
   * - Case-insensitive duplicate check on (name + form)
   * - If a soft-deleted medicine with same name+form exists for this user, reactivate it
   * - Throws 409 if an active duplicate exists
   */
  static async createMedicine(payload: CreateMedicinePayload) {
    // Last line of defence: every caller (single create, CSV import, seed)
    // funnels through here, so the rule lives here rather than in each one.
    const name = (payload.name || '').trim();
    const formValue = normaliseMedicineForm(payload.form);

    if (!name) throw new HttpError(400, 'Medicine name is required');
    if (!formValue) throw new HttpError(400, 'Medicine form is required');

    // Normalised values win from here on: a padded name or a differently
    // cased form must not slip past the duplicate check below and create a
    // second row for a medicine that already exists.
    payload = { ...payload, name, form: formValue };

    return await database.transaction(async (tx) => {
      // 1. Check if a soft-deleted medicine exists for this user (reactivate scenario)
      if (payload.createdByUserId) {
        const [inactive] = await tx
          .select()
          .from(MedicineModel)
          .where(
            and(
              sql`LOWER(${MedicineModel.name}) = LOWER(${payload.name})`,
              sql`LOWER(COALESCE(${MedicineModel.form}, '')) = LOWER(${formValue})`,
              eq(MedicineModel.isActive, false),
              eq(MedicineModel.createdByUserId, payload.createdByUserId)
            )
          )
          .limit(1);

        if (inactive) {
          // Reactivate with updated fields
          const [reactivated] = await tx
            .update(MedicineModel)
            .set({
              ...payload,
              isActive: true,
              requiresPrescription: payload.requiresPrescription ?? false,
              updatedAt: sql`NOW()`,
            })
            .where(eq(MedicineModel.id, inactive.id))
            .returning();

          await this.invalidateMedicineCache(inactive.id);
          return reactivated;
        }
      }

      // 2. Check for active duplicates (case-insensitive)
      const conditions: (SQL<unknown> | undefined)[] = [
        sql`LOWER(${MedicineModel.name}) = LOWER(${payload.name})`,
        sql`LOWER(COALESCE(${MedicineModel.form}, '')) = LOWER(${formValue})`,
        eq(MedicineModel.isActive, true),
      ];

      if (payload.createdByUserId) {
        conditions.push(
          or(
            sql`${MedicineModel.createdByUserId} IS NULL`,
            eq(MedicineModel.createdByUserId, payload.createdByUserId)
          )
        );
      } else {
        conditions.push(sql`${MedicineModel.createdByUserId} IS NULL`);
      }

      const [existing] = await tx
        .select()
        .from(MedicineModel)
        .where(and(...conditions))
        .limit(1);

      if (existing) {
        throw new HttpError(
          409,
          'Medicine with same name and form already exists'
        );
      }

      // 3. Create new medicine
      const [created] = await tx
        .insert(MedicineModel)
        .values({
          ...payload,
          requiresPrescription: payload.requiresPrescription ?? false,
          isActive: true,
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning();

      await this.invalidateMedicineCache();
      return created;
    });
  }

  /**
   * Upload medicines from CSV
   * Format: name, generic name, form, category, strength, manufacturer
   * Handles quoted fields and provides detailed status report.
   */
  static async uploadMedicines(fileBuffer: Buffer, userId: string) {
    const uploaded: any[] = [];
    const duplicates: any[] = [];
    const failed: any[] = [];

    try {
      const content = fileBuffer.toString('utf-8');
      // Split by newline, handle CR LF
      const lines = content
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);

      if (lines.length < 2) {
        throw new HttpError(400, 'Empty CSV file');
      }

      // Helper to split CSV line respecting quotes
      const parseLine = (line: string) => {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        // Remove surrounding quotes if present
        return result.map((val) => val.replace(/^"|"$/g, ''));
      };

      const headerLine = lines[0].toLowerCase();
      const header = parseLine(headerLine).map((h) => h.toLowerCase());

      // Validate Header
      // Name and form are both mandatory: a medicine without a form cannot be
      // prescribed, so a file missing either column is rejected outright
      // rather than importing rows that would fail one at a time.
      const hasForm = header.includes('form') || header.includes('formation');

      if (!header.includes('name') || !hasForm) {
        const missing = [
          !header.includes('name') && 'name',
          !hasForm && 'form',
        ].filter(Boolean);

        throw new HttpError(
          400,
          `CSV must contain ${missing.join(' and ')} column${missing.length > 1 ? 's' : ''}`
        );
      }

      // Iterate rows
      for (let i = 1; i < lines.length; i++) {
        const lineStr = lines[i];
        try {
          const values = parseLine(lineStr);

          // Basic length check (permissive)
          if (values.length === 0) continue;

          const row: Record<string, string> = {};
          header.forEach((h, index) => {
            row[h] = values[index] || '';
          });

          const rowName = (row['name'] || '').trim();
          const rowForm = (row['form'] || row['formation'] || '').trim();

          if (!rowName || !rowForm) {
            const missing = [!rowName && 'Name', !rowForm && 'Form'].filter(
              Boolean
            );

            failed.push({
              row: i + 1,
              message: `Missing ${missing.join(' and ')}`,
              data: row,
            });
            continue;
          }

          const payload: CreateMedicinePayload = {
            name: rowName.toUpperCase(),
            genericName: row['genericname'] || row['generic name'],
            form: rowForm,
            category: row['category'] || row['catergory'],
            strength: row['strength'] || row['gtrength'],
            manufacturer: row['manufacturer'],
            createdByUserId: userId,
          };

          // Check Duplicate (Global or User specific) - case-insensitive
          // Active duplicates are skipped; inactive ones will be reactivated by createMedicine
          const existing = await database
            .select({ id: MedicineModel.id, name: MedicineModel.name })
            .from(MedicineModel)
            .where(
              and(
                sql`LOWER(${MedicineModel.name}) = LOWER(${payload.name})`,
                eq(MedicineModel.isActive, true),
                or(
                  sql`${MedicineModel.createdByUserId} IS NULL`,
                  eq(MedicineModel.createdByUserId, userId)
                )
              )
            )
            .limit(1);

          if (existing.length > 0) {
            duplicates.push({
              row: i + 1,
              name: payload.name,
              message: 'Already exists (active)',
            });
            continue;
          }

          // Create
          const med = await this.createMedicine(payload);
          uploaded.push({ ...med, row: i + 1 });
        } catch (err: any) {
          failed.push({
            row: i + 1,
            data: lineStr,
            message: err.message || 'Unknown error',
          });
        }
      }

      return {
        message: 'Upload processed',
        count: uploaded.length,
        summary: {
          uploaded: uploaded.length,
          duplicates: duplicates.length,
          failed: failed.length,
        },
        uploaded,
        duplicates,
        failed,
      };
    } catch (error) {
      console.error('CSV Upload Error', error);
      throw new HttpError(400, 'Invalid CSV format or processing error');
    }
  }

  /**
   * Get medicine by ID with Caching
   */
  static async getMedicineById(medicineId: string) {
    const cacheKey = `medicine:${medicineId}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const [medicine] = await database
      .select()
      .from(MedicineModel)
      .where(
        and(eq(MedicineModel.id, medicineId), eq(MedicineModel.isActive, true))
      )
      .limit(1);

    if (!medicine) {
      throw new HttpError(404, 'Medicine not found');
    }

    // Cache for 1 hour
    await redisClient.setex(cacheKey, 3600, JSON.stringify(medicine));

    return medicine;
  }

  /**
   * Search medicines with filters and pagination
   */
  static async searchMedicines(query: SearchMedicineQuery) {
    // Deterministic cache key (sorted keys)
    const sortedQuery = Object.keys(query)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = (query as any)[key];
          return acc;
        },
        {} as Record<string, any>
      );
    const cacheKey = `medicines:search:${JSON.stringify(sortedQuery)}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const pageSize = Math.max(Number(query.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
    const { limit, offset } = pagination(pageNumber, pageSize);

    // Build where conditions
    const conditions: any[] = [];

    if (query.q) {
      // Case-insensitive search using ilike
      conditions.push(
        or(
          ilike(MedicineModel.name, `%${query.q}%`),
          ilike(MedicineModel.genericName, `%${query.q}%`),
          ilike(MedicineModel.manufacturer, `%${query.q}%`)
        )
      );
    }

    if (query.category) {
      conditions.push(eq(MedicineModel.category, query.category));
    }

    if (query.requiresPrescription !== undefined) {
      conditions.push(
        eq(MedicineModel.requiresPrescription, query.requiresPrescription)
      );
    }

    if (query.isActive !== undefined) {
      conditions.push(eq(MedicineModel.isActive, query.isActive));
    }
    // No default filter — show all (active + disabled) when isActive is not specified

    // Scope by User + Global
    if (query.userId) {
      conditions.push(
        or(
          sql`${MedicineModel.createdByUserId} IS NULL`,
          eq(MedicineModel.createdByUserId, query.userId)
        )
      );
    } else {
      // If no userId provided, assuming public search shows Global.
      conditions.push(sql`${MedicineModel.createdByUserId} IS NULL`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalRows = await database
      .select({ count: sql`COUNT(${MedicineModel.id})` })
      .from(MedicineModel)
      .where(whereClause);

    const totalCount = Number(totalRows[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Get paginated results with proper fields projection
    const medicines = await database
      .select({
        id: MedicineModel.id,
        name: MedicineModel.name,
        genericName: MedicineModel.genericName,
        manufacturer: MedicineModel.manufacturer,
        composition: MedicineModel.composition,
        form: MedicineModel.form,
        strength: MedicineModel.strength,
        category: MedicineModel.category,
        requiresPrescription: MedicineModel.requiresPrescription,
        isActive: MedicineModel.isActive,
      })
      .from(MedicineModel)
      .where(whereClause)
      .orderBy(desc(MedicineModel.createdAt))
      .limit(limit)
      .offset(offset);

    const result = {
      medicines,
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };

    // Cache search results for 60 seconds (short TTL for freshness after mutations)
    await redisClient.setex(cacheKey, 60, JSON.stringify(result));

    return result;
  }

  /**
   * Update medicine information
   * Only allow if created by this user
   */

  static async updateMedicine(
    medicineId: string,
    userId: string,
    payload: UpdateMedicinePayload
  ) {
    return await database.transaction(async (tx) => {
      const [existingMedicine] = await tx
        .select()
        .from(MedicineModel)
        .where(
          and(
            eq(MedicineModel.id, medicineId),
            eq(MedicineModel.isActive, true)
          )
        )
        .limit(1);

      if (!existingMedicine) {
        throw new HttpError(404, 'Medicine not found');
      }

      if (existingMedicine.createdByUserId !== userId) {
        throw new HttpError(
          403,
          'Access denied: You can only update your own medicines'
        );
      }

      // Case-insensitive duplicate check when name is being changed
      if (
        payload.name &&
        payload.name.toLowerCase() !== existingMedicine.name.toLowerCase()
      ) {
        const [duplicate] = await tx
          .select()
          .from(MedicineModel)
          .where(
            and(
              sql`LOWER(${MedicineModel.name}) = LOWER(${payload.name})`,
              eq(MedicineModel.isActive, true),
              ne(MedicineModel.id, medicineId),
              or(
                sql`${MedicineModel.createdByUserId} IS NULL`,
                eq(MedicineModel.createdByUserId, userId)
              )
            )
          )
          .limit(1);

        if (duplicate) {
          throw new HttpError(409, 'Medicine with this name already exists');
        }
      }

      const [updated] = await tx
        .update(MedicineModel)
        .set({
          ...payload,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(MedicineModel.id, medicineId),
            eq(MedicineModel.isActive, true),
            eq(MedicineModel.createdByUserId, userId)
          )
        )
        .returning();

      if (!updated) {
        throw new HttpError(404, 'Medicine not found or access denied');
      }

      await this.invalidateMedicineCache(medicineId);

      return updated;
    });
  }

  /**
   * Soft delete medicine (set isActive to false)
   * Only allow if created by this user.
   * Medicine can be reactivated later if user creates same name+form again.
   */
  static async softDeleteMedicine(medicineId: string, userId: string) {
    return await database.transaction(async (tx) => {
      const [deleted] = await tx
        .update(MedicineModel)
        .set({
          isActive: false,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(MedicineModel.id, medicineId),
            eq(MedicineModel.isActive, true),
            eq(MedicineModel.createdByUserId, userId)
          )
        )
        .returning({ id: MedicineModel.id, name: MedicineModel.name });

      if (!deleted) {
        throw new HttpError(404, 'Medicine not found or access denied');
      }

      // Invalidate all related caches
      await this.invalidateMedicineCache(medicineId);

      return deleted;
    });
  }

  /**
   * Toggle medicine active status (enable/disable)
   * Allows users to disable medicines without deleting them
   */
  static async toggleMedicineStatus(
    medicineId: string,
    userId: string,
    isActive: boolean
  ) {
    return await database.transaction(async (tx) => {
      const [medicine] = await tx
        .select()
        .from(MedicineModel)
        .where(
          and(
            eq(MedicineModel.id, medicineId),
            eq(MedicineModel.createdByUserId, userId)
          )
        )
        .limit(1);

      if (!medicine) {
        throw new HttpError(404, 'Medicine not found or access denied');
      }

      if (medicine.isActive === isActive) {
        return medicine; // No change needed
      }

      // If reactivating, check for active duplicates
      if (isActive) {
        const [duplicate] = await tx
          .select()
          .from(MedicineModel)
          .where(
            and(
              sql`LOWER(${MedicineModel.name}) = LOWER(${medicine.name})`,
              sql`LOWER(COALESCE(${MedicineModel.form}, '')) = LOWER(${medicine.form || ''})`,
              eq(MedicineModel.isActive, true),
              ne(MedicineModel.id, medicineId),
              or(
                sql`${MedicineModel.createdByUserId} IS NULL`,
                eq(MedicineModel.createdByUserId, userId)
              )
            )
          )
          .limit(1);

        if (duplicate) {
          throw new HttpError(
            409,
            'Cannot reactivate: an active medicine with same name and form already exists'
          );
        }
      }

      const [updated] = await tx
        .update(MedicineModel)
        .set({
          isActive,
          updatedAt: sql`NOW()`,
        })
        .where(eq(MedicineModel.id, medicineId))
        .returning();

      await this.invalidateMedicineCache(medicineId);

      return updated;
    });
  }

  /**
   * Get all medicines with pagination (Default 500)
   * Includes both user-specific and global medicines
   * @param isActive - undefined = all, true = active only, false = disabled only
   */
  static async getAllMedicines({
    page,
    pageSize,
    userId,
    q,
    category,
    requiresPrescription,
    isFavorite,
    isActive,
  }: {
    page: number;
    pageSize: number;
    userId?: string;
    q?: string;
    category?: string;
    requiresPrescription?: boolean;
    isFavorite?: boolean;
    isActive?: boolean;
  }) {
    const { limit, offset } = pagination(page, pageSize);

    const conditions: any[] = [];

    const text = q?.trim();
    // Escaped so a typed % or _ is literal, not a wildcard matching every row.
    const term = text?.replace(/[\\%_]/g, '\\$&');

    // No typo matching: "AZITHRAL 250" matched AZITHRAL 500 MG, and Enter adds row 0.
    const textMatch = term
      ? or(
          ilike(MedicineModel.name, `%${term}%`),
          ilike(MedicineModel.genericName, `%${term}%`)
        )
      : undefined;

    // Filter by category
    if (category) {
      conditions.push(eq(MedicineModel.category, category));
    }

    // Filter by prescription requirement
    if (requiresPrescription !== undefined) {
      conditions.push(
        eq(MedicineModel.requiresPrescription, requiresPrescription)
      );
    }

    if (isFavorite !== undefined) {
      conditions.push(eq(MedicineModel.isFavorite, isFavorite));
    }

    // Filter by active status
    if (isActive !== undefined) {
      conditions.push(eq(MedicineModel.isActive, isActive));
    }

    // User medicines + global medicines
    if (userId) {
      conditions.push(
        or(
          eq(MedicineModel.createdByUserId, userId),
          sql`${MedicineModel.createdByUserId} IS NULL`
        )
      );
    } else {
      conditions.push(sql`${MedicineModel.createdByUserId} IS NULL`);
    }

    const columns = {
      id: MedicineModel.id,
      name: MedicineModel.name,
      genericName: MedicineModel.genericName,
      manufacturer: MedicineModel.manufacturer,
      composition: MedicineModel.composition,
      form: MedicineModel.form,
      strength: MedicineModel.strength,
      category: MedicineModel.category,
      requiresPrescription: MedicineModel.requiresPrescription,
      isFavorite: MedicineModel.isFavorite,
      isActive: MedicineModel.isActive,
    };

    const medicines = await database
      .select(columns)
      .from(MedicineModel)
      .where(and(textMatch, ...conditions))
      .orderBy(
        // Best match first: the picker adds row 0 on Enter.
        ...(term
          ? [
              sql`CASE
                WHEN ${MedicineModel.name} ILIKE ${term} THEN 0
                WHEN ${MedicineModel.name} ILIKE ${`${term}%`} THEN 1
                WHEN ${MedicineModel.name} ILIKE ${`% ${term}%`} THEN 2
                WHEN ${MedicineModel.name} ILIKE ${`%${term}%`} THEN 3
                ELSE 4 END`,
              // Shortest first, as the picker ranks, so the 25-row cut keeps "PAN 40".
              sql`length(${MedicineModel.name})`,
              asc(MedicineModel.name),
            ]
          : [desc(MedicineModel.createdAt)])
      )
      .limit(limit)
      .offset(offset);

    const [total] = await database
      .select({
        count: sql<number>`COUNT(${MedicineModel.id})`,
      })
      .from(MedicineModel)
      .where(and(textMatch, ...conditions));

    const totalRecords = Number(total?.count) || 0;

    // "Did you mean" for a typo: a separate list the UI shows click-only, never
    // merged into `medicines`, whose row 0 Enter adds.
    let suggestions: typeof medicines = [];
    if (text && text.length >= 4 && totalRecords === 0) {
      const similarity = sql<number>`word_similarity(${text}, ${MedicineModel.name})`;
      try {
        const rows = await database
          .select({ ...columns, score: similarity.mapWith(Number) })
          .from(MedicineModel)
          .where(and(sql`${similarity} >= 0.35`, ...conditions))
          .orderBy(sql`${similarity} DESC`, sql`length(${MedicineModel.name})`)
          .limit(5);
        // Near the best only: "DOLO 500" scored DOLO 0.56 but also PARACETAMOL 500 MG 0.44.
        suggestions = rows
          .filter((row) => row.score >= rows[0].score - 0.1)
          .map(({ score: _score, ...medicine }) => medicine);
      } catch (err) {
        // Optional extra: a DB without pg_trgm must not take the search down with it.
        logger.error('Medicine suggestions failed', err);
      }
    }

    return {
      medicines,
      suggestions,
      pagination: {
        totalRecords,
        totalPages: Math.ceil(totalRecords / pageSize),
        currentPage: page,
        pageSize,
      },
    };
  }

  static async getUniqueForms(userId?: string) {
    try {
      const userForms = await database
        .select({
          form: MedicineModel.form,
        })
        .from(MedicineModel)
        .where(
          and(
            eq(MedicineModel.isActive, true),
            eq(MedicineModel.createdByUserId, userId || '')
          )
        )
        .groupBy(MedicineModel.form);

      const globalForms = await database
        .select({
          form: MedicineModel.form,
        })
        .from(MedicineModel)
        .where(
          and(
            eq(MedicineModel.isActive, true),
            sql`${MedicineModel.createdByUserId} IS NULL`
          )
        )
        .groupBy(MedicineModel.form);

      const allForms = [...userForms, ...globalForms];
      const uniqueForms = Array.from(
        new Set(
          allForms
            .map((item) => item.form)
            .filter((form) => form && form.trim().length > 0)
        )
      ).sort();

      return uniqueForms;
    } catch (error) {
      console.error('Error fetching unique forms:', error);
      throw error;
    }
  }

  /**
   * Get distinct generic names (Cached)
   */
  static async getDistinctGenericNames(searchTerm?: string) {
    const cacheKey = searchTerm
      ? `medicines:list:generics:search:${searchTerm}`
      : 'medicines:list:generics';

    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Build the where conditions
    const conditions = [
      eq(MedicineModel.isActive, true),
      sql`${MedicineModel.name} IS NOT NULL`,
    ];

    // Add search condition if search term is provided
    if (searchTerm) {
      conditions.push(
        sql`LOWER(${MedicineModel.name}) LIKE LOWER(${'%' + searchTerm + '%'})`
      );
    }

    const results = await database
      .selectDistinct({ value: MedicineModel.name })
      .from(MedicineModel)
      .where(and(...conditions))
      .orderBy(asc(MedicineModel.name));

    const list = results.map((r) => r.value).filter(Boolean);

    // Cache for shorter time if it's a search result (optional)
    const cacheDuration = searchTerm ? 1800 : 3600; // 30 min for searches, 1 hour for full list
    await redisClient.setex(cacheKey, cacheDuration, JSON.stringify(list));

    return list;
  }

  /**
   * Get distinct brand names (names of medicines) (Cached)
   */
  static async getDistinctBrandNames() {
    const cacheKey = 'medicines:list:brands';
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const results = await database
      .selectDistinct({ value: MedicineModel.name })
      .from(MedicineModel)
      .where(eq(MedicineModel.isActive, true))
      .orderBy(asc(MedicineModel.name));

    const list = results.map((r) => r.value);
    await redisClient.setex(cacheKey, 3600, JSON.stringify(list));
    return list;
  }

  /**
   * Get distinct manufacturers (Cached)
   */
  static async getDistinctManufacturers() {
    const cacheKey = 'medicines:list:manufacturers';
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const results = await database
      .selectDistinct({ value: MedicineModel.manufacturer })
      .from(MedicineModel)
      .where(
        and(
          eq(MedicineModel.isActive, true),
          sql`${MedicineModel.manufacturer} IS NOT NULL`
        )
      )
      .orderBy(asc(MedicineModel.manufacturer));

    const list = results.map((r) => r.value).filter(Boolean);
    await redisClient.setex(cacheKey, 3600, JSON.stringify(list));
    return list;
  }

  /**
   * Get distinct categories (Cached)
   */
  static async getDistinctCategories() {
    const cacheKey = 'medicines:list:categories';
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const results = await database
      .selectDistinct({ value: MedicineModel.category })
      .from(MedicineModel)
      .where(
        and(
          eq(MedicineModel.isActive, true),
          sql`${MedicineModel.category} IS NOT NULL`
        )
      )
      .orderBy(asc(MedicineModel.category));

    const list = results.map((r) => r.value).filter(Boolean);
    await redisClient.setex(cacheKey, 3600, JSON.stringify(list));
    return list;
  }
}
