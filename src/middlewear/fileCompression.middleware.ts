import { Request, Response, NextFunction } from 'express';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import path from 'path';
import { asyncHandler } from './errorHandler';
import logger from '../utils/logger';

interface FileRequest extends Request {
  file?: Express.Multer.File & {
    compressedBuffer?: Buffer;
    compressedSize?: number;
    originalSize?: number;
  };
}

export const fileCompressionMiddleware = asyncHandler(
  async (req: FileRequest, res: Response, next: NextFunction) => {
    // If no file is uploaded, continue
    if (!req.file) {
      return next();
    }

    const file = req.file;
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype.toLowerCase();

    try {
      // Handle image compression
      if (
        ['jpg', 'jpeg', 'png', 'webp'].includes(
          fileExtension.replace('.', '')
        ) ||
        mimeType.includes('image')
      ) {
        const compressedBuffer = await compressImage(file.buffer, mimeType);
        file.compressedBuffer = compressedBuffer;
        file.originalSize = file.buffer.length;
        file.compressedSize = compressedBuffer.length;
        file.buffer = compressedBuffer;
        file.size = compressedBuffer.length;
      }
      // Handle PDF compression
      else if (fileExtension === '.pdf' || mimeType === 'application/pdf') {
        const compressedBuffer = await compressPDF(file.buffer);
        file.compressedBuffer = compressedBuffer;
        file.originalSize = file.buffer.length;
        file.compressedSize = compressedBuffer.length;
        file.buffer = compressedBuffer;
        file.size = compressedBuffer.length;
      }

      next();
    } catch (error) {
      logger.error('File compression error:', error);
      // Continue without compression if error occurs
      next();
    }
  }
);

/**
 * Compress image while maintaining quality
 */
async function compressImage(
  buffer: Buffer,
  mimeType: string
): Promise<Buffer> {
  try {
    let pipeline = sharp(buffer);

    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
      pipeline = pipeline.jpeg({
        quality: 80, // 80% quality maintains good visual quality
        progressive: true,
        mozjpeg: true, // Use mozjpeg for better compression
      });
    } else if (mimeType.includes('png')) {
      pipeline = pipeline.png({
        quality: 85,
        progressive: true,
        compressionLevel: 9, // Maximum compression
      });
    } else if (mimeType.includes('webp')) {
      pipeline = pipeline.webp({
        quality: 80,
      });
    }

    const compressedBuffer = await pipeline.toBuffer();
    logger.info(
      `Image compressed: ${(buffer.length / 1024 / 1024).toFixed(2)}MB -> ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB`
    );

    return compressedBuffer;
  } catch (error) {
    logger.error('Image compression failed:', error);
    return buffer; // Return original if compression fails
  }
}

/**
 * Compress PDF while maintaining quality
 */
async function compressPDF(buffer: Buffer): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.load(buffer);

    // Embed images with compression if available
    const compressedUint8Array = await pdfDoc.save();
    const compressedBuffer = Buffer.from(compressedUint8Array);

    logger.info(
      `PDF size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB -> ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB`
    );

    return compressedBuffer;
  } catch (error) {
    logger.error('PDF compression failed:', error);
    return buffer; // Return original if compression fails
  }
}

/**
 * Get compression stats (optional utility)
 */
export function getCompressionStats(file: FileRequest['file']): {
  originalSize: string;
  compressedSize: string;
  compressionRatio: string;
} | null {
  if (!file?.originalSize || !file?.compressedSize) {
    return null;
  }

  const originalSizeKB = (file.originalSize / 1024).toFixed(2);
  const compressedSizeKB = (file.compressedSize / 1024).toFixed(2);
  const ratio = (
    ((file.originalSize - file.compressedSize) / file.originalSize) *
    100
  ).toFixed(2);

  return {
    originalSize: `${originalSizeKB} KB`,
    compressedSize: `${compressedSizeKB} KB`,
    compressionRatio: `${ratio}%`,
  };
}
