import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { HttpError } from '../../../middlewear/errorHandler';
import { sendOk, sendCreated } from '../../../utils/response.utils';
import { BannerService } from '../services/banner.service';
import {
  CreateBannerDto,
  UpdateBannerDto,
  BannerAnalyticsEventDto,
  BannerAnalyticsBatchDto,
} from '../schemas/banner.schemas';
import { database } from '../../../configurations/dbConnection';
import { BannerModel } from '../models/banner.model';
import { and, asc, eq, gte, lte, or, sql } from 'drizzle-orm';

// ─── Super Admin Controllers ──────────────────────────────────────────────────

/**
 * POST /api/v1/banners
 * Create a new banner. Super Admin only.
 */
export const createBannerController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody as CreateBannerDto;
    const createdBy = req.user.id;

    const banner = await BannerService.createBanner(payload, createdBy);
    return sendCreated(res, 'Banner created successfully', banner);
  }
);

/**
 * PUT /api/v1/banners/:bannerId
 * Update an existing banner. Super Admin only.
 */
export const updateBannerController = asyncHandler(
  async (req: Request, res: Response) => {
    const { bannerId } = req.validatedParams;
    const payload = req.validatedBody as UpdateBannerDto;
    const updatedBy = req.user.id;

    const banner = await BannerService.updateBanner(
      bannerId,
      payload,
      updatedBy
    );
    return sendOk(res, 'Banner updated successfully', banner);
  }
);

/**
 * DELETE /api/v1/banners/:bannerId
 * Delete a banner. Super Admin only.
 */
export const deleteBannerController = asyncHandler(
  async (req: Request, res: Response) => {
    const { bannerId } = req.validatedParams;

    const deleted = await BannerService.deleteBanner(bannerId);
    return sendOk(res, 'Banner deleted successfully', deleted);
  }
);

/**
 * GET /api/v1/banners/:bannerId
 * Get a single banner by ID. Super Admin only.
 */
export const getBannerController = asyncHandler(
  async (req: Request, res: Response) => {
    const { bannerId } = req.validatedParams;

    const banner = await BannerService.getBannerById(bannerId);
    return sendOk(res, 'Banner retrieved successfully', banner);
  }
);

/**
 * GET /api/v1/banners
 * List all banners with filters and pagination. Super Admin only.
 */
export const listBannersController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.validatedQuery;

    const result = await BannerService.listBanners(query);
    return res.status(200).json({
      success: true,
      message: 'Banners retrieved successfully',
      data: result.data,
      metadata: result.metadata,
    });
  }
);

/**
 * PATCH /api/v1/banners/:bannerId/activate
 * Activate a banner. Super Admin only.
 */
export const activateBannerController = asyncHandler(
  async (req: Request, res: Response) => {
    const { bannerId } = req.validatedParams;
    const updatedBy = req.user.id;

    const banner = await BannerService.activateBanner(bannerId, updatedBy);
    return sendOk(res, 'Banner activated successfully', banner);
  }
);

/**
 * PATCH /api/v1/banners/:bannerId/pause
 * Pause a banner. Super Admin only.
 */
export const pauseBannerController = asyncHandler(
  async (req: Request, res: Response) => {
    const { bannerId } = req.validatedParams;
    const updatedBy = req.user.id;

    const banner = await BannerService.pauseBanner(bannerId, updatedBy);
    return sendOk(res, 'Banner paused successfully', banner);
  }
);

// ─── User-facing Controllers ──────────────────────────────────────────────────

/**
 * GET /api/v1/banners/eligible/all
 * Returns banners eligible for the authenticated user across all placements.
 * Performance optimized: returns all 6 placements in a single response.
 */
export const getEligibleBannersAllController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = req.user;
    const clinicId = req.clinicId; // set by requireClinic middleware (may be undefined)

    // Specialty is optionally passed as query param (some users have it, some don't)
    const specialty = (req.query.specialty as string) || undefined;

    const banners = await BannerService.getEligibleBannersAllPlacements(
      user,
      clinicId,
      specialty
    );

    return sendOk(res, 'Eligible banners retrieved successfully', banners);
  }
);

/**
 * GET /api/v1/banners/eligible
 * Returns banners eligible for a specific placement
 *
 * Special behavior for LOGIN_PAGE:
 * - Authentication NOT required (login page is public)
 * - Returns only universal public banners (no role/clinic/specialty targeting)
 * - req.user will be undefined for unauthenticated LOGIN_PAGE requests
 *
 * For other placements:
 * - Authentication IS required
 * - Returns banners filtered by user's role, clinic, specialty
 */
export const getEligibleBannersController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.validatedQuery;
    const placement = (query.placement as string) || '';

    // Handle public LOGIN_PAGE banners (no authentication required)
    if (placement.toUpperCase() === 'LOGIN_PAGE') {
      const now = new Date();

      // Query for public LOGIN_PAGE banners only
      const conditions = [
        eq(BannerModel.isActive, true),
        eq(BannerModel.status, 'Active'),
        eq(BannerModel.placement, 'LOGIN_PAGE'),
        lte(BannerModel.startDate, now),
        gte(BannerModel.endDate, now),
        // Only return banners with no role targeting (null or empty array)
        or(
          sql`${BannerModel.targetRoles} IS NULL`,
          sql`array_length(${BannerModel.targetRoles}, 1) IS NULL`
        ),
        // Only return banners with no clinic targeting
        or(
          sql`${BannerModel.targetClinics} IS NULL`,
          sql`array_length(${BannerModel.targetClinics}, 1) IS NULL`
        ),
        // Only return banners with no specialty targeting
        or(
          sql`${BannerModel.targetSpecialties} IS NULL`,
          sql`array_length(${BannerModel.targetSpecialties}, 1) IS NULL`
        ),
      ];

      const banners = await database
        .select()
        .from(BannerModel)
        .where(and(...conditions))
        .orderBy(asc(BannerModel.priority), asc(BannerModel.displayOrder))
        .limit(5);

      const result = banners.map((banner) => ({
        ...banner,
        isCritical: banner.priority === 'P0',
      }));

      return sendOk(res, 'Eligible banners retrieved successfully', result);
    }

    // All other placements require authentication
    const user = req.user;
    if (!user) {
      throw new HttpError(401, 'Authorization token missing');
    }

    const clinicId = req.clinicId; // set by requireClinic middleware (may be undefined)
    const specialty = (req.query.specialty as string) || undefined;

    const banners = await BannerService.getEligibleBanners(
      user,
      clinicId,
      specialty,
      query
    );

    return sendOk(res, 'Eligible banners retrieved successfully', banners);
  }
);

/**
 * POST /api/v1/banners/:bannerId/dismiss
 * Dismiss a banner for the current user.
 */
export const dismissBannerController = asyncHandler(
  async (req: Request, res: Response) => {
    const { bannerId } = req.validatedParams;
    const userId = req.user.id;

    const result = await BannerService.dismissBanner(bannerId, userId);
    return sendOk(res, 'Banner dismissed successfully', result);
  }
);

/**
 * POST /api/v1/banners/:bannerId/track
 * Track an analytics event (impression, click, dismissal) for a banner.
 */
export const trackBannerEventController = asyncHandler(
  async (req: Request, res: Response) => {
    const { bannerId } = req.validatedParams;
    const payload = req.validatedBody as BannerAnalyticsEventDto;
    const userId = req.user.id;
    const clinicId = req.clinicId;

    const event = await BannerService.trackEvent(
      bannerId,
      userId,
      clinicId,
      payload.eventType
    );

    return sendCreated(res, 'Event tracked successfully', event);
  }
);

/**
 * POST /api/v1/banners/track-batch
 * Track multiple analytics events (impression, click, dismissal) in one request.
 * Lets the client flush a queue of events instead of firing one POST per banner.
 */
export const trackBannerEventsBatchController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody as BannerAnalyticsBatchDto;
    const userId = req.user.id;
    const clinicId = req.clinicId;

    const events = await BannerService.trackEventsBatch(
      payload.events,
      userId,
      clinicId
    );

    return sendCreated(res, 'Events tracked successfully', events);
  }
);
