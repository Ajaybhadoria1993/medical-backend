// src/main/global/routes/v1/upload.route.ts
import { singleFileController } from '../../controllers/fileUploader.controller';
import { apiKeyAuth } from '../../../../middlewear/apiKey';
import { generatePresignedURL } from '../../services/uploads.service';
import express from 'express';

const uploadeRouter = express.Router();

/**
 * @route POST /api/v1/global/upload/single/external
 * @desc Generate presigned URL and upload a single file for external services
 * @access Private (API Key)
 */
uploadeRouter.post(
  '/single/external',
  apiKeyAuth,
  generatePresignedURL([
    // Documents & Spreadsheets
    'xlsx',
    'xls',
    'csv',
    'pdf',
    'docx',
    'doc',

    // Images
    'jpg',
    'jpeg',
    'png',
    'gif',
    'bmp',
    'tiff',
    'svg',
    'webp',
    'heic',
    'ico',
    'psd',
    'raw',
    'cr2',
    'nef',

    // Video
    'mp4',
    'mkv',
    'avi',
    'mov',
    'wmv',
    'flv',
    'webm',
    'mpg',
    'mpeg',
    '3gp',
    'ogv',

    // Audio
    'mp3',
    'wav',
    'aac',
    'flac',
  ]),
  singleFileController
);

export default uploadeRouter;
