import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import { uploadBannerImage } from '../../../../middlewear/upload.middleware';

import {
  createBannerController,
  updateBannerController,
  deleteBannerController,
  getBannerController,
  listBannersController,
  activateBannerController,
  pauseBannerController,
  getEligibleBannersAllController,
  getEligibleBannersController,
  dismissBannerController,
  trackBannerEventController,
  trackBannerEventsBatchController,
} from '../../controllers/banner.controller';

import { uploadBannerImageController } from '../../controllers/upload.controller';

import {
  createBannerSchema,
  updateBannerSchema,
  bannerIdParamSchema,
  listBannersQuerySchema,
  eligibleBannersQuerySchema,
  bannerAnalyticsEventSchema,
  bannerAnalyticsBatchSchema,
} from '../../schemas/banner.schemas';

const bannersRouter = express.Router();

// ─── Super Admin Routes ───────────────────────────────────────────────────────

/**
 * @route POST /api/v1/banners
 * @desc Create a new banner
 * @access Super Admin
 */
bannersRouter.post(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(createBannerSchema, 'body'),
  createBannerController
);

/**
 * @route GET /api/v1/banners
 * @desc List all banners with optional filters and pagination
 * @access Super Admin
 */
bannersRouter.get(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(listBannersQuerySchema, 'query'),
  listBannersController
);

// ─── Upload Routes ───────────────────────────────────────────────────────────

/**
 * @route POST /api/v1/banners/upload/image
 * @desc Upload a banner image (full-size or thumbnail)
 * @access Super Admin
 * @field image: Image file (multipart/form-data)
 *
 * Response:
 * {
 *   success: true,
 *   message: "Image uploaded successfully",
 *   data: {
 *     url: "https://bucket.s3.region.amazonaws.com/banner_images/...",
 *     filename: "image-name.jpg",
 *     size: 12345,
 *     contentType: "image/jpeg"
 *   }
 * }
 */
bannersRouter.post(
  '/upload/image',
  requireAuth,
  requireSuperAdmin,
  uploadBannerImage.single('image'),
  uploadBannerImageController
);

// ─── Eligibility & User Routes ────────────────────────────────────────────────

/**
 * @route GET /api/v1/banners/eligible/all
 * @desc Get banners eligible for the authenticated user across all placements (performance optimized)
 * @access All authenticated users (NOT Super Admin)
 * NOTE: This route must be defined BEFORE /eligible to avoid route conflicts
 */
bannersRouter.get(
  '/eligible/all',
  requireAuth,
  getEligibleBannersAllController
);

/**
 * @route GET /api/v1/banners/eligible
 * @desc Get banners eligible for a specific placement
 * @access All users (authenticated) - EXCEPT for LOGIN_PAGE placement which is public
 *
 * Special Behavior for LOGIN_PAGE:
 * When placement=LOGIN_PAGE, authentication is NOT required because:
 * - Login page is public and accessed before authentication
 * - Only universal public banners are returned (no role/clinic/specialty targeting)
 * - Security is maintained by filtering on the backend
 *
 * For other placements: Authentication IS required
 *
 * NOTE: This route must be defined AFTER /eligible/all to avoid route conflicts
 */
bannersRouter.get(
  '/eligible',
  validate(eligibleBannersQuerySchema, 'query'),
  // Conditional auth: only required if placement !== LOGIN_PAGE
  (req, res, next) => {
    const placement = req.query.placement as string;
    if (placement && placement.toUpperCase() === 'LOGIN_PAGE') {
      // Login page is public - skip auth
      return next();
    }
    // All other placements require auth
    return requireAuth(req, res, next);
  },
  getEligibleBannersController
);

/**
 * @route GET /api/v1/banners/:bannerId
 * @desc Get a single banner by ID
 * @access Super Admin
 */
bannersRouter.get(
  '/:bannerId',
  requireAuth,
  requireSuperAdmin,
  validate(bannerIdParamSchema, 'params'),
  getBannerController
);

/**
 * @route PUT /api/v1/banners/:bannerId
 * @desc Update a banner
 * @access Super Admin
 */
bannersRouter.put(
  '/:bannerId',
  requireAuth,
  requireSuperAdmin,
  validate(bannerIdParamSchema, 'params'),
  validate(updateBannerSchema, 'body'),
  updateBannerController
);

/**
 * @route DELETE /api/v1/banners/:bannerId
 * @desc Delete a banner
 * @access Super Admin
 */
bannersRouter.delete(
  '/:bannerId',
  requireAuth,
  requireSuperAdmin,
  validate(bannerIdParamSchema, 'params'),
  deleteBannerController
);

/**
 * @route PATCH /api/v1/banners/:bannerId/activate
 * @desc Activate a banner
 * @access Super Admin
 */
bannersRouter.patch(
  '/:bannerId/activate',
  requireAuth,
  requireSuperAdmin,
  validate(bannerIdParamSchema, 'params'),
  activateBannerController
);

/**
 * @route PATCH /api/v1/banners/:bannerId/pause
 * @desc Pause a banner
 * @access Super Admin
 */
bannersRouter.patch(
  '/:bannerId/pause',
  requireAuth,
  requireSuperAdmin,
  validate(bannerIdParamSchema, 'params'),
  pauseBannerController
);

// ─── User-facing Routes ───────────────────────────────────────────────────────

/**
 * @route POST /api/v1/banners/:bannerId/dismiss
 * @desc Dismiss a banner (record user dismissal)
 * @access All authenticated users
 */
bannersRouter.post(
  '/:bannerId/dismiss',
  requireAuth,
  validate(bannerIdParamSchema, 'params'),
  dismissBannerController
);

/**
 * @route POST /api/v1/banners/:bannerId/track
 * @desc Track a banner analytics event (impression, click, dismissal)
 * @access All authenticated users
 */
bannersRouter.post(
  '/:bannerId/track',
  requireAuth,
  validate(bannerIdParamSchema, 'params'),
  validate(bannerAnalyticsEventSchema, 'body'),
  trackBannerEventController
);

/**
 * @route POST /api/v1/banners/track-batch
 * @desc Track multiple banner analytics events in a single request
 * @access All authenticated users
 */
bannersRouter.post(
  '/track-batch',
  requireAuth,
  validate(bannerAnalyticsBatchSchema, 'body'),
  trackBannerEventsBatchController
);

export default bannersRouter;

// ─── API Docs Registry ────────────────────────────────────────────────────────

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/banners/upload/image',
  description: 'Upload a banner image (Super Admin)',
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/banners',
  description: 'Create a new banner (Super Admin)',
  requestSchema: createBannerSchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/banners',
  description: 'List all banners with pagination and filters (Super Admin)',
  query: listBannersQuerySchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/banners/eligible',
  description: 'Get eligible banners for the authenticated user',
  query: eligibleBannersQuerySchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/banners/:bannerId',
  description: 'Get a banner by ID (Super Admin)',
  params: bannerIdParamSchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/banners/:bannerId',
  description: 'Update a banner (Super Admin)',
  params: bannerIdParamSchema,
  requestSchema: updateBannerSchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/banners/:bannerId',
  description: 'Delete a banner (Super Admin)',
  params: bannerIdParamSchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/banners/:bannerId/activate',
  description: 'Activate a banner (Super Admin)',
  params: bannerIdParamSchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/banners/:bannerId/pause',
  description: 'Pause a banner (Super Admin)',
  params: bannerIdParamSchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/banners/:bannerId/dismiss',
  description: 'Dismiss a banner for the current user',
  params: bannerIdParamSchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/banners/:bannerId/track',
  description: 'Track a banner analytics event (impression, click, dismissal)',
  params: bannerIdParamSchema,
  requestSchema: bannerAnalyticsEventSchema,
  tags: ['banners'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/banners/track-batch',
  description: 'Track multiple banner analytics events in a single request',
  requestSchema: bannerAnalyticsBatchSchema,
  tags: ['banners'],
});
