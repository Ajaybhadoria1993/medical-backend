import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, BUCKET_NAME } from '../../../configurations/s3/client';
import {
  DOCUMENT_FIELDS,
  INLINE_TTL_SECONDS,
  looksLikeStoredFile,
  MAX_WALK_NODES,
  parseS3Ref,
  safeDownloadName,
  shouldRoundSigningTime,
  signingWindowStart,
} from '../utils/s3Ref.utils';
import type { SignOptions, StoredFile } from '../types/files.types';

/**
 * Turns a stored file value into a time-limited URL the client can fetch.
 * Accepts a full URL or a bare key; the bucket comes from whichever it names.
 */
export async function signS3Url(
  stored: string | null | undefined,
  opts: SignOptions = {}
): Promise<string | null | undefined> {
  if (!stored) return stored;

  const ref = parseS3Ref(stored, BUCKET_NAME);
  // Not one of ours — a seeded placeholder or an external avatar. Leave it be.
  if (!ref) return stored;

  const expiresIn = opts.expiresIn ?? INLINE_TTL_SECONDS;

  const command = new GetObjectCommand({
    Bucket: ref.bucket,
    Key: ref.key,
    ...(opts.downloadAs
      ? {
          ResponseContentDisposition: `attachment; filename="${safeDownloadName(
            opts.downloadAs
          )}"`,
        }
      : {}),
  });

  return getSignedUrl(s3Client, command, {
    expiresIn,
    ...(shouldRoundSigningTime(expiresIn)
      ? { signingDate: signingWindowStart() }
      : {}),
  });
}

/** Reads one of our stored files, for sending through the API rather than a signed link. */
export async function readS3Object(stored: string): Promise<StoredFile | null> {
  const ref = parseS3Ref(stored, BUCKET_NAME);
  if (!ref) return null;

  try {
    const object = await s3Client.send(
      new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key })
    );
    if (!object.Body) return null;
    return {
      bytes: Buffer.from(await object.Body.transformToByteArray()),
      contentType: object.ContentType ?? 'application/octet-stream',
      key: ref.key,
    };
  } catch (err) {
    // A record pointing at a deleted object is a missing document, not a server fault.
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    throw err;
  }
}

/** Signs every value in a list, leaving untouched anything that is not ours. */
export async function signS3Urls(
  stored: (string | null | undefined)[],
  opts: SignOptions = {}
): Promise<(string | null | undefined)[]> {
  return Promise.all(stored.map((value) => signS3Url(value, opts)));
}

/**
 * Cheap synchronous scan that exits on the first hit, so a caller can skip
 * the async walk entirely when there is nothing to sign.
 */
export function hasStoredFile(
  value: unknown,
  budget = { nodes: 0 },
  seen = new WeakSet<object>(),
  key?: string
): boolean {
  if (budget.nodes++ > MAX_WALK_NODES) return false;

  if (typeof value === 'string') {
    return !(key && DOCUMENT_FIELDS.has(key)) && looksLikeStoredFile(value);
  }

  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasStoredFile(item, budget, seen, key));
  }
  if (value.constructor !== Object) return false;

  return Object.entries(value).some(([k, v]) =>
    hasStoredFile(v, budget, seen, k)
  );
}

/**
 * Signs every stored file value inside a structure, leaving everything else
 * untouched. Used for API responses and for data handed to the PDF renderer.
 */
export async function signStoredFilesDeep(value: unknown): Promise<unknown> {
  return walkAndSign(value, { nodes: 0 }, new WeakSet(), undefined);
}

async function walkAndSign(
  value: unknown,
  budget: { nodes: number },
  seen: WeakSet<object>,
  key: string | undefined
): Promise<unknown> {
  if (budget.nodes++ > MAX_WALK_NODES) return value;

  if (typeof value === 'string') {
    if (key && DOCUMENT_FIELDS.has(key)) return value;
    if (!looksLikeStoredFile(value)) return value;
    return (await signS3Url(value, { expiresIn: INLINE_TTL_SECONDS })) ?? value;
  }

  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item) => walkAndSign(item, budget, seen, key))
    );
  }

  // Dates, buffers and the like are values, not containers.
  if (value.constructor !== Object) return value;

  const entries = await Promise.all(
    Object.entries(value).map(
      async ([k, v]) => [k, await walkAndSign(v, budget, seen, k)] as const
    )
  );
  return Object.fromEntries(entries);
}
