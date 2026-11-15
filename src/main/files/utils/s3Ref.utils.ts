import type { S3Ref } from '../types/files.types';

/** Pure helpers for turning a stored file value into a signable S3 reference. */

/** Inline imagery: long enough to outlive a cached API response. */
export const INLINE_TTL_SECONDS = 12 * 60 * 60;

/** Clinical documents: fetched on click, never embedded in a cached response. */
export const DOCUMENT_TTL_SECONDS = 5 * 60;

/** Signatures inside one window are byte-identical, so browsers can cache them. */
export const SIGNING_WINDOW_SECONDS = 60 * 60;

const AWS_SUFFIX = '.amazonaws.com';
const MAX_DOWNLOAD_NAME = 150;

/**
 * Resolves a stored column value to a bucket and key.
 * Returns null for anything not ours — nullish, blank, or a foreign URL.
 */
export function parseS3Ref(
  stored: string,
  defaultBucket: string
): S3Ref | null {
  const value = stored.trim();
  if (!value) return null;

  // A bare key belongs to whichever bucket the app currently writes to.
  if (!/^https?:\/\//i.test(value)) {
    const key = value.replace(/^\/+/, '');
    return key && defaultBucket ? { bucket: defaultBucket, key } : null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!host.endsWith(AWS_SUFFIX)) return null;

  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const labels = host.slice(0, -AWS_SUFFIX.length).split('.');
  const s3At = labels.findIndex((l) => l === 's3' || l.startsWith('s3-'));
  if (s3At === -1) return null;

  // Virtual-hosted puts the bucket in the host; path-style leads the path with it.
  if (s3At > 0) {
    const bucket = labels.slice(0, s3At).join('.');
    return bucket && path ? { bucket, key: path } : null;
  }

  const slash = path.indexOf('/');
  if (slash <= 0) return null;
  const key = path.slice(slash + 1);
  return key ? { bucket: path.slice(0, slash), key } : null;
}

/** Start of the current signing window, so repeat signatures match exactly. */
export function signingWindowStart(nowMs: number = Date.now()): Date {
  const windowMs = SIGNING_WINDOW_SECONDS * 1000;
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}

/**
 * Rounding only helps when the window is well inside the lifetime.
 * A 5-minute link signed against the hour would already be expired.
 */
export function shouldRoundSigningTime(expiresIn: number): boolean {
  return expiresIn > SIGNING_WINDOW_SECONDS * 2;
}

/** Strips what would break or inject into a Content-Disposition header. */
export function safeDownloadName(name: string): string {
  const cleaned = Array.from(name)
    .filter((ch) => ch >= ' ' && ch !== '"' && ch !== '\\' && ch !== '\u007f')
    .join('');
  return cleaned.trim().slice(0, MAX_DOWNLOAD_NAME);
}

/** `filename*` carries non-Latin names (e.g. Devanagari); `filename` is the ASCII fallback. */
export function attachmentDisposition(name: string): string {
  const safe = safeDownloadName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const ENV_PREFIXES = ['development/', 'staging/', 'production/'];

/**
 * Tighter than parseS3Ref: decides whether an arbitrary response string is
 * ours at all. parseS3Ref would claim any bare string as a key.
 */
export function looksLikeStoredFile(
  value: string,
  nowMs = Date.now()
): boolean {
  if (value.length > 2048) return false;
  // A live signature is left alone: re-signing turns a 5-minute document or a PUT upload into a 12h GET.
  // An expired one can only be a stored row, so it is signed afresh.
  if (/[?&]X-Amz-Signature=/i.test(value))
    return isExpiredS3Signature(value, nowMs);
  if (/^https?:\/\//i.test(value)) return value.includes('.amazonaws.com/');
  return ENV_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** True once a presigned URL is past `X-Amz-Date + X-Amz-Expires`; false when either is missing. */
export function isExpiredS3Signature(
  value: string,
  nowMs = Date.now()
): boolean {
  try {
    const params = new URL(value).searchParams;
    const date = params.get('X-Amz-Date');
    const expires = Number(params.get('X-Amz-Expires'));
    const m = date?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m || !Number.isFinite(expires)) return false;
    const signedAt = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return nowMs >= signedAt + expires * 1000;
  } catch {
    return false;
  }
}

/**
 * A presigned S3 URL echoed back by a form, reduced to the plain URL we store.
 * Stored signatures expire, and the response signer skips already-signed values.
 */
export function stripS3Signature(value: string): string {
  if (!/[?&]X-Amz-Signature=/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (!url.hostname.toLowerCase().endsWith('.amazonaws.com')) return value;
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

/** Deep version of stripS3Signature for request bodies; returns the same shape. */
export function stripS3SignaturesDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return stripS3Signature(value);
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value))
    return value.map((v) => stripS3SignaturesDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value))
    out[k] = stripS3SignaturesDeep(v, depth + 1);
  return out;
}

/**
 * Signed on demand by GET /api/v1/files/sign, for minutes. A deep signer
 * must leave these alone or it hands back a long-lived clinical document.
 */
export const DOCUMENT_FIELDS = new Set([
  'prescriptionPdf',
  'reportPdf',
  'reportDocs',
  'consentFile',
  'doctorManualPrescription',
  'invoice',
  'invoiceUrl',
  'attachments',
  // The lab report, under every name its response gives it. The service signs
  // it at the document TTL itself; re-signing here would restore the 12h link.
  'pdfUrl',
  'downloadUrl',
  'currentFileUrl',
]);

/** Guards against a pathological payload walking forever. */
export const MAX_WALK_NODES = 20_000;
