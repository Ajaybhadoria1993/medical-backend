// Your multer-s3 config file (whatever it's called)
import {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import multer from 'multer';
import multerS3 from 'multer-s3';
import dotenv from 'dotenv';
import { envConfig } from '../../utils/envConfig';
import { HttpError } from '../../middlewear/errorHandler';
import { buildObjectKey, fileExtension, type KeyRequest } from './keys';

dotenv.config();

// ─── S3 Client ──────────────────────────────────────────────
// Support both naming conventions for flexibility
const accessKey = process.env.ACCESS_KEY_ID || process.env.AWS_ACCESS_TOKEN;
const secretKey = process.env.SECRET_ACCESS_KEY || process.env.AWS_SECRET_TOKEN;
const sessionToken = process.env.AWS_SESSION_TOKEN;

const s3Config: any = {
  region: process.env.AWS_REGION || 'ap-south-1',
  maxAttempts: 3,
};

// Add credentials if available
if (accessKey && secretKey) {
  const credentials: any = {
    accessKeyId: accessKey.trim(),
    secretAccessKey: secretKey.trim(),
  };

  // Add session token for temporary credentials
  if (sessionToken) {
    credentials.sessionToken = sessionToken.trim();
  }

  s3Config.credentials = credentials;
}

export const s3Client = new S3Client(s3Config);
export const BUCKET_NAME = envConfig.AWS_BUCKET_NAME || '';

// ─── Env Folder Prefix ──────────────────────────────────────
// Single shared bucket, isolated by a top-level folder per environment
// (production/, staging/, development/) so dev/staging uploads never
// mix with real patient data in production.
const S3_ENV_FOLDER =
  envConfig.NODE_ENV === 'production'
    ? 'production'
    : envConfig.NODE_ENV === 'staging'
      ? 'staging'
      : 'development';

/** The object's address. Only resolvable once signed, now the bucket is closing. */
export const s3ObjectUrl = (prefixedKey: string): string =>
  `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${prefixedKey}`;

export const withEnvPrefix = (key: string): string =>
  key.startsWith(`${S3_ENV_FOLDER}/`) ? key : `${S3_ENV_FOLDER}/${key}`;

// Log configuration

// ─── Shared Upload Factory ─────────────────────────────────

/** Applies unless an uploader passes its own, smaller cap. */
export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

interface UploaderOptions {
  /** Fixed category folder, or one chosen per form field. */
  folder: string | ((fieldname: string) => string);
  formats: string[];
  maxBytes?: number;
  /** Extension to accepted MIME types. Both must agree, so a renamed
   *  executable cannot pass as a PDF. Extension-only when omitted. */
  mimeTypes?: Record<string, string[]>;
  maxFiles?: number;
  /** Shown instead of the generated list, where the route words it better. */
  rejectionMessage?: string;
}

const storageFor = (folder: UploaderOptions['folder'], formats: string[]) => {
  if (!BUCKET_NAME) {
    throw new Error('AWS_BUCKET_NAME is not configured');
  }

  return multerS3({
    s3: s3Client,
    bucket: BUCKET_NAME,
    key: (req, file, cb) => {
      const category =
        typeof folder === 'function' ? folder(file.fieldname) : folder;
      // multer-s3 types req as the bare global Express.Request, which declares
      // none of the fields the key reads; at runtime it is the real request.
      const keyReq = req as unknown as KeyRequest;
      cb(
        null,
        withEnvPrefix(buildObjectKey(keyReq, category, file.originalname))
      );
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      // The only place the upload's real name survives — never the key.
      cb(null, {
        fieldName: file.fieldname,
        originalName: file.originalname,
        allowedFormats: formats.join(','),
      });
    },
  });
};

/**
 * Builds an uploader whose extension whitelist and size cap are enforced,
 * not merely recorded. `formats` used to be written to metadata and ignored.
 */
export const createUploader = ({
  folder,
  formats,
  maxBytes = DEFAULT_UPLOAD_MAX_BYTES,
  mimeTypes,
  maxFiles,
  rejectionMessage,
}: UploaderOptions) =>
  multer({
    storage: storageFor(folder, formats),
    limits: { fileSize: maxBytes, ...(maxFiles ? { files: maxFiles } : {}) },
    fileFilter: (_req, file, cb) => {
      const ext = fileExtension(file.originalname);
      const allowed = mimeTypes
        ? (mimeTypes[ext]?.includes(file.mimetype.toLowerCase()) ?? false)
        : formats.includes(ext);

      if (!allowed) {
        return cb(
          new HttpError(
            400,
            rejectionMessage ??
              `Invalid file type ".${ext}". Allowed: ${formats.join(', ')}`
          )
        );
      }
      cb(null, true);
    },
  });

// ─── Utility: Upload Buffer ─────────────────────────────────
export async function uploadBufferToS3(
  buffer: Buffer,
  key: string,
  contentType: string = 'application/pdf'
): Promise<string> {
  if (!BUCKET_NAME) throw new Error('AWS_BUCKET_NAME is not configured');

  const prefixedKey = withEnvPrefix(key);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: prefixedKey,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  return s3ObjectUrl(prefixedKey);
}

export async function doesFileExistInS3(key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: withEnvPrefix(key),
      })
    );

    return true;
  } catch (error: any) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === 'NotFound'
    ) {
      return false;
    }

    throw error;
  }
}

// ─── Utility: Delete Object ─────────────────────────────────
export async function deleteFromS3(urlOrKey: string): Promise<void> {
  if (!BUCKET_NAME) throw new Error('AWS_BUCKET_NAME is not configured');

  let key = urlOrKey;

  // If it's a full URL, extract the key from the pathname
  if (urlOrKey.startsWith('http')) {
    const url = new URL(urlOrKey);
    key = decodeURIComponent(url.pathname.replace(/^\//, ''));
  }

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}
