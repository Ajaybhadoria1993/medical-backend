import {
  and,
  asc,
  desc,
  eq,
  ilike,
  gte,
  lte,
  or,
  sql,
  inArray,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { AuthUser } from '../../../middlewear/auth.middleware';
import {
  BannerModel,
  BannerDismissalModel,
  BannerAnalyticsModel,
} from '../models/banner.model';
import {
  CreateBannerDto,
  UpdateBannerDto,
  ListBannersQueryDto,
  EligibleBannersQueryDto,
} from '../schemas/banner.schemas';
import {
  getCacheKeyPlacement,
  getCacheKeyAllPlacements,
  invalidateBannerCache,
  logCacheMiss,
  logCacheHit,
  logCacheInvalidation,
  getBannerCache,
  setBannerCache,
} from '../utils/bannerCacheService';

export class BannerService {
  // ─── Super Admin: Create ────────────────────────────────────────────────────

  static async createBanner(dto: CreateBannerDto, createdByUserId: string) {
    // Prevent exact duplicate campaigns (same title + placement + active status)
    // This prevents accidental re-uploads of the same campaign.
    // Allow multiple banners with:
    // - Different titles (even on same placement)
    // - Different banner types (multiple Referral, Feature Announcement, etc.)
    // - Overlapping date ranges (multiple campaigns running simultaneously)
    const duplicate = await database
      .select({ id: BannerModel.id })
      .from(BannerModel)
      .where(
        and(
          eq(BannerModel.title, dto.title),
          eq(BannerModel.placement, dto.placement),
          eq(BannerModel.isActive, true)
        )
      )
      .limit(1);

    if (duplicate.length > 0) {
      throw HttpError.conflict(
        'An active banner with this title already exists on this placement. Use a different title or pause the existing banner first.'
      );
    }

    const now = new Date();
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    // Determine initial status based on scheduling
    let status: 'Active' | 'Scheduled' | 'Draft' = 'Draft';
    if (dto.isActive) {
      status = now >= start && now <= end ? 'Active' : 'Scheduled';
    }

    const [banner] = await database
      .insert(BannerModel)
      .values({
        title: dto.title,
        description: dto.description ?? null,
        bannerType: dto.bannerType,
        priority: dto.priority,
        placement: dto.placement,
        ctaText: dto.ctaText ?? null,
        ctaUrl: dto.ctaUrl ?? null,
        imageUrl: dto.imageUrl ?? null,
        thumbnailUrl: dto.thumbnailUrl ?? null,
        imageAlt: dto.imageAlt ?? null,
        startDate: start,
        endDate: end,
        targetRoles: dto.targetRoles ?? null,
        targetClinics: dto.targetClinics ?? null,
        targetSpecialties: dto.targetSpecialties ?? null,
        isSponsored: dto.isSponsored,
        isDismissible: dto.isDismissible,
        isActive: dto.isActive,
        status,
        displayOrder: dto.displayOrder,
        createdBy: createdByUserId,
        updatedBy: createdByUserId,
      })
      .returning();

    // ─── Cache Invalidation ──────────────────────────────────────────────
    // When a new banner is created, invalidate all eligible banner caches
    // so the new banner appears immediately in subsequent requests.
    // Pattern: DELETE all keys matching 'banners:*'
    await invalidateBannerCache();
    logCacheInvalidation('Banner created');

    return banner;
  }

  // ─── Super Admin: Update ────────────────────────────────────────────────────

  static async updateBanner(
    bannerId: string,
    dto: UpdateBannerDto,
    updatedByUserId: string
  ) {
    const [existing] = await database
      .select()
      .from(BannerModel)
      .where(eq(BannerModel.id, bannerId))
      .limit(1);

    if (!existing) {
      throw HttpError.notFound('Banner not found');
    }

    // If title or placement are being updated, re-validate for exact duplicates (excluding self)
    if (dto.title || dto.placement) {
      const newTitle = dto.title ?? existing.title;
      const newPlacement = dto.placement ?? existing.placement;

      const duplicate = await database
        .select({ id: BannerModel.id })
        .from(BannerModel)
        .where(
          and(
            eq(BannerModel.title, newTitle),
            eq(BannerModel.placement, newPlacement),
            eq(BannerModel.isActive, true),
            // Exclude the banner being updated
            sql`${BannerModel.id} != ${bannerId}`
          )
        )
        .limit(1);

      if (duplicate.length > 0) {
        throw HttpError.conflict(
          'An active banner with this title already exists on this placement. Use a different title or pause the existing banner first.'
        );
      }
    }

    const now = new Date();
    const resolvedStart = new Date(dto.startDate ?? existing.startDate);
    const resolvedEnd = new Date(dto.endDate ?? existing.endDate);
    const resolvedIsActive = dto.isActive ?? existing.isActive;

    // Recalculate status if isActive or dates changed
    let resolvedStatus = dto.status ?? existing.status;
    if (dto.isActive !== undefined || dto.startDate || dto.endDate) {
      if (!resolvedIsActive) {
        resolvedStatus = 'Paused';
      } else if (now > resolvedEnd) {
        resolvedStatus = 'Expired';
      } else if (now >= resolvedStart && now <= resolvedEnd) {
        resolvedStatus = 'Active';
      } else {
        resolvedStatus = 'Scheduled';
      }
    }

    const updatePayload: Partial<typeof BannerModel.$inferInsert> = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.bannerType !== undefined && { bannerType: dto.bannerType }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.placement !== undefined && { placement: dto.placement }),
      ...(dto.ctaText !== undefined && { ctaText: dto.ctaText }),
      ...(dto.ctaUrl !== undefined && { ctaUrl: dto.ctaUrl }),
      ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      ...(dto.thumbnailUrl !== undefined && { thumbnailUrl: dto.thumbnailUrl }),
      ...(dto.imageAlt !== undefined && { imageAlt: dto.imageAlt }),
      ...(dto.startDate !== undefined && { startDate: resolvedStart }),
      ...(dto.endDate !== undefined && { endDate: resolvedEnd }),
      ...(dto.targetRoles !== undefined && { targetRoles: dto.targetRoles }),
      ...(dto.targetClinics !== undefined && {
        targetClinics: dto.targetClinics,
      }),
      ...(dto.targetSpecialties !== undefined && {
        targetSpecialties: dto.targetSpecialties,
      }),
      ...(dto.isSponsored !== undefined && { isSponsored: dto.isSponsored }),
      ...(dto.isDismissible !== undefined && {
        isDismissible: dto.isDismissible,
      }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
      status: resolvedStatus,
      updatedBy: updatedByUserId,
      updatedAt: new Date(),
    };

    const [updated] = await database
      .update(BannerModel)
      .set(updatePayload)
      .where(eq(BannerModel.id, bannerId))
      .returning();

    // ─── Cache Invalidation ──────────────────────────────────────────────
    // When a banner is updated, invalidate all eligible banner caches
    // so users see the updated banner configuration immediately.
    // Pattern: DELETE all keys matching 'banners:*'
    await invalidateBannerCache();
    logCacheInvalidation(`Banner updated: ${bannerId}`);

    return updated;
  }

  // ─── Super Admin: Delete ────────────────────────────────────────────────────

  static async deleteBanner(bannerId: string) {
    const [existing] = await database
      .select({ id: BannerModel.id })
      .from(BannerModel)
      .where(eq(BannerModel.id, bannerId))
      .limit(1);

    if (!existing) {
      throw HttpError.notFound('Banner not found');
    }

    const [deleted] = await database
      .delete(BannerModel)
      .where(eq(BannerModel.id, bannerId))
      .returning();

    // ─── Cache Invalidation ──────────────────────────────────────────────
    // When a banner is deleted, invalidate all eligible banner caches
    // so the deleted banner no longer appears in user-facing endpoints.
    // Pattern: DELETE all keys matching 'banners:*'
    await invalidateBannerCache();
    logCacheInvalidation(`Banner deleted: ${bannerId}`);

    return deleted;
  }

  // ─── Super Admin: Get single banner ─────────────────────────────────────────

  static async getBannerById(bannerId: string) {
    const [banner] = await database
      .select()
      .from(BannerModel)
      .where(eq(BannerModel.id, bannerId))
      .limit(1);

    if (!banner) {
      throw HttpError.notFound('Banner not found');
    }

    return banner;
  }

  // ─── Super Admin: List banners (paginated + filtered) ───────────────────────

  static async listBanners(query: ListBannersQueryDto) {
    const {
      pageSize,
      pageNumber,
      bannerType,
      priority,
      placement,
      status,
      isActive,
      search,
    } = query;
    const offset = (pageNumber - 1) * pageSize;

    const conditions = [];

    if (bannerType) conditions.push(eq(BannerModel.bannerType, bannerType));
    if (priority) conditions.push(eq(BannerModel.priority, priority));
    if (placement) conditions.push(eq(BannerModel.placement, placement));
    if (status) conditions.push(eq(BannerModel.status, status));
    if (isActive !== undefined)
      conditions.push(eq(BannerModel.isActive, isActive));
    if (search) {
      conditions.push(
        or(
          ilike(BannerModel.title, `%${search}%`),
          ilike(BannerModel.description, `%${search}%`)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      database
        .select()
        .from(BannerModel)
        .where(whereClause)
        .orderBy(
          asc(BannerModel.priority),
          asc(BannerModel.displayOrder),
          desc(BannerModel.createdAt)
        )
        .limit(pageSize)
        .offset(offset),
      database
        .select({ count: sql<number>`count(*)::int` })
        .from(BannerModel)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data: rows,
      metadata: {
        total,
        pageNumber,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  // ─── Super Admin: Activate / Pause ──────────────────────────────────────────

  static async activateBanner(bannerId: string, updatedByUserId: string) {
    const [existing] = await database
      .select()
      .from(BannerModel)
      .where(eq(BannerModel.id, bannerId))
      .limit(1);

    if (!existing) throw HttpError.notFound('Banner not found');

    const now = new Date();
    const status =
      now >= existing.startDate && now <= existing.endDate
        ? 'Active'
        : 'Scheduled';

    const [updated] = await database
      .update(BannerModel)
      .set({
        isActive: true,
        status,
        updatedBy: updatedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(BannerModel.id, bannerId))
      .returning();

    // ─── Cache Invalidation ──────────────────────────────────────────────
    // When a banner is activated, invalidate all eligible banner caches
    // so the activated banner appears immediately if it's currently eligible.
    // Pattern: DELETE all keys matching 'banners:*'
    await invalidateBannerCache();
    logCacheInvalidation(`Banner activated: ${bannerId}`);

    return updated;
  }

  static async pauseBanner(bannerId: string, updatedByUserId: string) {
    const [existing] = await database
      .select({ id: BannerModel.id })
      .from(BannerModel)
      .where(eq(BannerModel.id, bannerId))
      .limit(1);

    if (!existing) throw HttpError.notFound('Banner not found');

    const [updated] = await database
      .update(BannerModel)
      .set({
        isActive: false,
        status: 'Paused',
        updatedBy: updatedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(BannerModel.id, bannerId))
      .returning();

    // ─── Cache Invalidation ──────────────────────────────────────────────
    // When a banner is paused, invalidate all eligible banner caches
    // so the paused banner no longer appears in user-facing endpoints.
    // Pattern: DELETE all keys matching 'banners:*'
    await invalidateBannerCache();
    logCacheInvalidation(`Banner paused: ${bannerId}`);

    return updated;
  }

  // ─── User-facing: Get eligible banners ──────────────────────────────────────
  /**
   * Returns only banners that are:
   *  - isActive = true
   *  - status = 'Active'
   *  - now between startDate and endDate
   *  - targetRoles is null (all) OR includes user's role
   *  - targetClinics is null (all) OR includes user's clinicId
   *  - targetSpecialties is null (all) OR includes user's specialty
   *  - not already dismissed by this user (if banner isDismissible)
   *  - filtered by placement if requested
   *
   * IMPORTANT: Super_Admin users do NOT see promotional/user-facing banners.
   * They manage banners, they do not view them.
   *
   * Returns max 5 banners per placement (carousel support: top by priority + displayOrder)
   * Each banner includes isCritical metadata for carousel rendering.
   *
   * ─── CACHING ────────────────────────────────────────────────────────────────
   * Implements Cache-Aside Pattern:
   * 1. Check Redis for cached response: banners:eligible:{userId}:{placement}
   * 2. If cache hit: return immediately (log hit)
   * 3. If cache miss: execute query, store in Redis (TTL: 5 min), return (log miss)
   * 4. On banner changes: cache is invalidated automatically
   *
   * Performance: Cache hits typically return in <5ms vs 50-200ms for DB query
   */
  static async getEligibleBanners(
    user: AuthUser,
    clinicId: string | undefined,
    specialty: string | undefined,
    query: EligibleBannersQueryDto
  ) {
    // Super Admin should not see user-facing content
    if (user.userType === 'Super_Admin') {
      throw HttpError.forbidden(
        'Super Admin users manage banners. This endpoint is for viewing user-facing banners.'
      );
    }

    // ─── Cache-Aside: Try cache first ────────────────────────────────────
    // If placement is not specified, we cannot use the placement-specific cache
    if (!query.placement) {
      throw HttpError.badRequest('placement query parameter is required');
    }

    const cacheKey = getCacheKeyPlacement(user.id, query.placement);
    const startTime = Date.now();

    // Step 1: Check cache
    const cached =
      await getBannerCache<
        (typeof BannerModel.$inferSelect & { isCritical: boolean })[]
      >(cacheKey);
    if (cached) {
      const executionTime = Date.now() - startTime;
      logCacheHit(cacheKey, user.id, query.placement, executionTime);
      return cached;
    }

    // Step 2: Cache miss — execute business logic
    const now = new Date();

    // Base eligibility conditions
    const conditions = [
      eq(BannerModel.isActive, true),
      eq(BannerModel.status, 'Active'),
      lte(BannerModel.startDate, now),
      gte(BannerModel.endDate, now),
    ];

    if (query.placement) {
      conditions.push(eq(BannerModel.placement, query.placement));
    }

    const allBanners = await database
      .select()
      .from(BannerModel)
      .where(and(...conditions))
      .orderBy(asc(BannerModel.priority), asc(BannerModel.displayOrder));

    // Get dismissed banner IDs for this user
    const dismissedRows = await database
      .select({ bannerId: BannerDismissalModel.bannerId })
      .from(BannerDismissalModel)
      .where(eq(BannerDismissalModel.userId, user.id));

    const dismissedIds = new Set(dismissedRows.map((r) => r.bannerId));

    // Filter in-process (targeting + dismissal)
    const eligible = allBanners.filter((banner) => {
      // Skip dismissed banners (only relevant if isDismissible)
      if (banner.isDismissible && dismissedIds.has(banner.id)) return false;

      // Role targeting
      if (
        banner.targetRoles &&
        banner.targetRoles.length > 0 &&
        !banner.targetRoles.includes(user.userType)
      ) {
        return false;
      }

      // Clinic targeting
      if (
        banner.targetClinics &&
        banner.targetClinics.length > 0 &&
        clinicId &&
        !banner.targetClinics.includes(clinicId)
      ) {
        return false;
      }

      // Specialty targeting
      if (
        banner.targetSpecialties &&
        banner.targetSpecialties.length > 0 &&
        specialty &&
        !banner.targetSpecialties.includes(specialty)
      ) {
        return false;
      }

      return true;
    });

    // Limit to top 5 banners per placement for carousel support (industry standard)
    // Note: P0 banners always appear first due to priority-based sorting
    const maxBannersPerPlacement = 5;
    const limited = eligible.slice(0, maxBannersPerPlacement);

    // Add isCritical metadata (true for P0 banners, used by carousel for special styling)
    const result = limited.map((banner) => ({
      ...banner,
      isCritical: banner.priority === 'P0',
    }));

    // Step 3: Store in cache and log
    await setBannerCache(cacheKey, result);
    const executionTime = Date.now() - startTime;
    logCacheMiss(cacheKey, user.id, query.placement, executionTime);

    return result;
  }

  // ─── User: Get Eligible Banners All Placements (Optimized) ───────────────────

  /**
   * Fetches eligible banners for ALL 6 placements in a single response.
   * Performance optimized: 1 API call instead of 6.
   * Returns max 5 banners per placement (carousel support).
   * Each banner includes isCritical metadata for P0 alerts.
   *
   * ─── CACHING ────────────────────────────────────────────────────────────────
   * Implements Cache-Aside Pattern:
   * 1. Check Redis for cached response: banners:eligible:all:{userId}
   * 2. If cache hit: return immediately (log hit)
   * 3. If cache miss: execute query, store in Redis (TTL: 5 min), return (log miss)
   * 4. On banner changes: cache is invalidated automatically
   *
   * Performance: Cache hits typically return in <5ms vs 100-300ms for full multi-query DB
   */
  static async getEligibleBannersAllPlacements(
    user: AuthUser,
    clinicId: string | undefined,
    specialty: string | undefined
  ) {
    // Super Admin should not see user-facing content
    if (user.userType === 'Super_Admin') {
      throw HttpError.forbidden(
        'Super Admin users manage banners. This endpoint is for viewing user-facing banners.'
      );
    }

    // ─── Cache-Aside: Try cache first ────────────────────────────────────
    const cacheKey = getCacheKeyAllPlacements(user.id);
    const startTime = Date.now();

    // Step 1: Check cache
    const cached = await getBannerCache<{
      DASHBOARD_TOP: (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[];
      DASHBOARD_SIDEBAR: (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[];
      INSIGHTS_WIDGET: (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[];
      APPOINTMENT_HEADER: (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[];
      LOGIN_PAGE: (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[];
      BILLING_PAGE: (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[];
    }>(cacheKey);
    if (cached) {
      const executionTime = Date.now() - startTime;
      logCacheHit(cacheKey, user.id, 'all', executionTime);
      return cached;
    }

    // Step 2: Cache miss — execute business logic
    const now = new Date();

    // Base eligibility conditions
    const conditions = [
      eq(BannerModel.isActive, true),
      eq(BannerModel.status, 'Active'),
      lte(BannerModel.startDate, now),
      gte(BannerModel.endDate, now),
    ];

    const allBanners = await database
      .select()
      .from(BannerModel)
      .where(and(...conditions))
      .orderBy(asc(BannerModel.priority), asc(BannerModel.displayOrder));

    // Get dismissed banner IDs for this user
    const dismissedRows = await database
      .select({ bannerId: BannerDismissalModel.bannerId })
      .from(BannerDismissalModel)
      .where(eq(BannerDismissalModel.userId, user.id));

    const dismissedIds = new Set(dismissedRows.map((r) => r.bannerId));

    // Filter in-process (targeting + dismissal)
    const eligible = allBanners.filter((banner) => {
      // Skip dismissed banners (only relevant if isDismissible)
      if (banner.isDismissible && dismissedIds.has(banner.id)) return false;

      // Role targeting
      if (
        banner.targetRoles &&
        banner.targetRoles.length > 0 &&
        !banner.targetRoles.includes(user.userType)
      ) {
        return false;
      }

      // Clinic targeting
      if (
        banner.targetClinics &&
        banner.targetClinics.length > 0 &&
        clinicId &&
        !banner.targetClinics.includes(clinicId)
      ) {
        return false;
      }

      // Specialty targeting
      if (
        banner.targetSpecialties &&
        banner.targetSpecialties.length > 0 &&
        specialty &&
        !banner.targetSpecialties.includes(specialty)
      ) {
        return false;
      }

      return true;
    });

    // Group by placement and limit to top 5 per placement (carousel support)
    const maxBannersPerPlacement = 5;
    const result = {
      DASHBOARD_TOP: [] as (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[],
      DASHBOARD_SIDEBAR: [] as (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[],
      INSIGHTS_WIDGET: [] as (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[],
      APPOINTMENT_HEADER: [] as (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[],
      LOGIN_PAGE: [] as (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[],
      BILLING_PAGE: [] as (typeof BannerModel.$inferSelect & {
        isCritical: boolean;
      })[],
    };

    eligible.forEach((banner) => {
      const placement = banner.placement as keyof typeof result;
      if (
        placement in result &&
        result[placement].length < maxBannersPerPlacement
      ) {
        result[placement].push({
          ...banner,
          isCritical: banner.priority === 'P0',
        });
      }
    });

    // Step 3: Store in cache and log
    await setBannerCache(cacheKey, result);
    const executionTime = Date.now() - startTime;
    logCacheMiss(cacheKey, user.id, 'all', executionTime);

    return result;
  }

  // ─── User: Dismiss a banner ──────────────────────────────────────────────────

  static async dismissBanner(bannerId: string, userId: string) {
    const [banner] = await database
      .select({ id: BannerModel.id, isDismissible: BannerModel.isDismissible })
      .from(BannerModel)
      .where(eq(BannerModel.id, bannerId))
      .limit(1);

    if (!banner) throw HttpError.notFound('Banner not found');
    if (!banner.isDismissible) {
      throw HttpError.badRequest('This banner cannot be dismissed');
    }

    // Upsert — ignore if already dismissed
    const existing = await database
      .select({ id: BannerDismissalModel.id })
      .from(BannerDismissalModel)
      .where(
        and(
          eq(BannerDismissalModel.bannerId, bannerId),
          eq(BannerDismissalModel.userId, userId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return { message: 'Already dismissed' };
    }

    const [dismissal] = await database
      .insert(BannerDismissalModel)
      .values({ bannerId, userId })
      .returning();

    return dismissal;
  }

  // ─── Analytics: Track event (impression / click / dismissal) ─────────────────

  static async trackEvent(
    bannerId: string,
    userId: string,
    clinicId: string | undefined,
    eventType: 'impression' | 'click' | 'dismissal'
  ) {
    const [banner] = await database
      .select({ id: BannerModel.id })
      .from(BannerModel)
      .where(eq(BannerModel.id, bannerId))
      .limit(1);

    if (!banner) throw HttpError.notFound('Banner not found');

    const [event] = await database
      .insert(BannerAnalyticsModel)
      .values({
        bannerId,
        userId,
        clinicId: clinicId ?? null,
        eventType,
      })
      .returning();

    return event;
  }

  // ─── Analytics: Track a batch of events in one round trip ────────────────────

  static async trackEventsBatch(
    events: Array<{
      bannerId: string;
      eventType: 'impression' | 'click' | 'dismissal';
    }>,
    userId: string,
    clinicId: string | undefined
  ) {
    const bannerIds = [...new Set(events.map((e) => e.bannerId))];

    const validBanners = await database
      .select({ id: BannerModel.id })
      .from(BannerModel)
      .where(inArray(BannerModel.id, bannerIds));
    const validIds = new Set(validBanners.map((b) => b.id));

    const rows = events
      .filter((e) => validIds.has(e.bannerId))
      .map((e) => ({
        bannerId: e.bannerId,
        userId,
        clinicId: clinicId ?? null,
        eventType: e.eventType,
      }));

    if (rows.length === 0) return [];

    return database.insert(BannerAnalyticsModel).values(rows).returning();
  }
}
