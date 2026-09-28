import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../../../middlewear/errorHandler';
import { envConfig } from '../../../utils/envConfig';
import { s3Client, withEnvPrefix } from '../../../configurations/s3/client';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import qs from 'qs';

// ✅ SINGLE FILE PRESIGNED URL
export const generatePresignedURL =
  (allowedExtensions: string[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyReq = req as any;
      if (typeof anyReq.doc !== 'object' || anyReq.doc === null) {
        anyReq.doc = {};
      }

      const { filename, fileType, path } = req.body;

      const ext = filename.split('.').pop()?.toLowerCase();
      if (!ext || !allowedExtensions.includes(ext)) {
        throw new HttpError(
          400,
          `Only files with extensions ${allowedExtensions.join(', ')} are allowed`
        );
      }

      const mimeMap: Record<string, string[]> = {
        csv: ['text/csv', 'application/vnd.ms-excel'],
        xlsx: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        xls: ['application/vnd.ms-excel'],
        jpeg: ['image/jpeg'],
        jpg: ['image/jpeg'],
        png: ['image/png'],
        pdf: ['application/pdf'],
        docx: [
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        mp4: ['video/mp4'],
        mp3: ['audio/mpeg'],
      };

      if (!mimeMap[ext]?.includes(fileType)) {
        throw new HttpError(
          400,
          `MIME type ${fileType} is not allowed for .${ext} files`
        );
      }

      const key = withEnvPrefix(
        `uploads/${path}/${Date.now()}_${filename.replace(/\s+/g, '_')}`
      );
      const bucketName = envConfig.AWS_BUCKET_NAME;

      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: fileType,
      });

      const signedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 300,
      });

      anyReq.doc = {
        uploadUrl: signedUrl,
        key,
        bucketName,
        fileType,
        fileName: filename,
      };

      next();
    } catch (err) {
      next(err);
    }
  };

// ✅ PARSE FORM DATA (with QS & file attachment)
export const nestedFormDataParser = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (req.body && typeof req.body === 'object') {
    let parsed = qs.parse(req.body);

    const deepTrim = (obj: unknown): unknown => {
      if (Array.isArray(obj)) {
        return obj.map(deepTrim);
      } else if (obj && typeof obj === 'object') {
        return Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [k, deepTrim(v)])
        );
      } else if (typeof obj === 'string') {
        return obj.trim();
      }
      return obj;
    };

    parsed = deepTrim(parsed) as qs.ParsedQs;

    if (req.file && parsed.documents && Array.isArray(parsed.documents)) {
      const file = req.file;
      parsed.documents = parsed.documents.map((doc) => {
        if (typeof doc === 'object' && doc && !('documentUrl' in doc)) {
          return {
            ...doc,
            documentUrl: (file as Express.Multer.File & { key?: string }).key,
          };
        }
        return doc;
      }) as qs.ParsedQs[];
    }

    req.body = parsed;
  }
  next();
};
