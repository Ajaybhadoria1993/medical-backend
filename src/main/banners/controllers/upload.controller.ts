// src/main/banners/controllers/upload.controller.ts
/**
 * Banner Image Upload Controller
 * Handles image uploads for banner creation and updates
 *
 * Reuses the same response format as other upload modules
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { HttpError } from '../../../middlewear/errorHandler';

/**
 * POST /api/v1/banners/upload/image
 * Upload a single banner image
 *
 * Request:
 *   - file: Image file (multipart/form-data)
 *   - field name: 'image' or 'imageUrl' or 'thumbnailUrl'
 *
 * Response:
 *   {
 *     success: true,
 *     message: "Image uploaded successfully",
 *     data: {
 *       url: "https://bucket.s3.region.amazonaws.com/banner_images/..."
 *     }
 *   }
 */
export const uploadBannerImageController = asyncHandler(
  async (req: Request, res: Response) => {
    // Get uploaded file from S3 via multer-s3
    const file = req.file as any;

    // Validate file was uploaded
    if (!file) {
      throw HttpError.badRequest('No image file was uploaded');
    }

    // Extract the S3 URL from the uploaded file
    const imageUrl = file.location;

    if (!imageUrl) {
      throw HttpError.internal(
        'Failed to retrieve uploaded image URL from storage'
      );
    }

    // Return response in standard format
    return res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        url: imageUrl,
        // Additional metadata
        filename: file.originalname,
        size: file.size,
        contentType: file.contentType,
      },
    });
  }
);

/**
 * POST /api/v1/banners/upload
 * Generic upload endpoint for any file type with size/type validation
 *
 * Used by frontend when uploading banner images
 * Validates file size (max 5MB) and type (image/* only)
 */
export const uploadImageController = asyncHandler(
  async (req: Request, res: Response) => {
    const file = req.file as any;

    // Validate file was uploaded
    if (!file) {
      throw HttpError.badRequest('No image file was uploaded');
    }

    // Validate file size (should be enforced by multer, but double-check)
    const maxFileSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxFileSize) {
      throw HttpError.badRequest(
        `File size exceeds maximum limit of 5MB (uploaded: ${(file.size / 1024 / 1024).toFixed(2)}MB)`
      );
    }

    // Validate file type
    const validImageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/svg+xml',
      'image/gif',
    ];

    if (!validImageTypes.includes(file.contentType)) {
      throw HttpError.badRequest(
        `Invalid file type: ${file.contentType}. Allowed types: JPEG, PNG, WebP, SVG, GIF`
      );
    }

    const imageUrl = file.location;

    if (!imageUrl) {
      throw HttpError.internal(
        'Failed to retrieve uploaded image URL from storage'
      );
    }

    // Return response in standard format (matches other upload APIs)
    return res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        url: imageUrl,
      },
    });
  }
);
