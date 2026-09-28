// Guards the parsing that decides whether a stored value gets signed at all.
// Signing a foreign URL corrupts it; skipping one of ours 403s after the flip.

import {
  attachmentDisposition,
  parseS3Ref,
  safeDownloadName,
  shouldRoundSigningTime,
  signingWindowStart,
  DOCUMENT_TTL_SECONDS,
  INLINE_TTL_SECONDS,
  SIGNING_WINDOW_SECONDS,
} from '../utils/s3Ref.utils';

const DEFAULT_BUCKET = 'infinity-medisetu-private';

describe('parseS3Ref', () => {
  it('reads bucket and key from a virtual-hosted URL', () => {
    expect(
      parseS3Ref(
        'https://infninity-medisatu.s3.ap-south-1.amazonaws.com/production/clinic_logos/logo-1.png',
        DEFAULT_BUCKET
      )
    ).toEqual({
      bucket: 'infninity-medisatu',
      key: 'production/clinic_logos/logo-1.png',
    });
  });

  it('reads a path-style URL', () => {
    expect(
      parseS3Ref(
        'https://s3.ap-south-1.amazonaws.com/some-bucket/production/a.pdf',
        DEFAULT_BUCKET
      )
    ).toEqual({ bucket: 'some-bucket', key: 'production/a.pdf' });
  });

  it('reads the legacy s3-region host form', () => {
    expect(
      parseS3Ref(
        'https://old-bucket.s3-ap-south-1.amazonaws.com/x/y.jpg',
        DEFAULT_BUCKET
      )
    ).toEqual({ bucket: 'old-bucket', key: 'x/y.jpg' });
  });

  it('decodes percent-escaped keys', () => {
    expect(
      parseS3Ref(
        'https://b.s3.ap-south-1.amazonaws.com/ims/Logo%20V1.png',
        DEFAULT_BUCKET
      )
    ).toEqual({ bucket: 'b', key: 'ims/Logo V1.png' });
  });

  it('treats a bare key as living in the default bucket', () => {
    expect(
      parseS3Ref('production/c/abc/prescriptions/x.pdf', DEFAULT_BUCKET)
    ).toEqual({
      bucket: DEFAULT_BUCKET,
      key: 'production/c/abc/prescriptions/x.pdf',
    });
  });

  it('strips a leading slash from a bare key', () => {
    expect(parseS3Ref('/production/x.pdf', DEFAULT_BUCKET)?.key).toBe(
      'production/x.pdf'
    );
  });

  // Returning null here is what stops the signer mangling a value it does not own.
  it.each([
    ['an external avatar', 'https://lh3.googleusercontent.com/a/abc123'],
    ['a non-S3 aws host', 'https://example.cloudfront.net/a.png'],
    ['a blank string', '   '],
    ['a malformed URL', 'http://'],
    ['a bucket host with no key', 'https://b.s3.ap-south-1.amazonaws.com/'],
    ['a path-style URL with no key', 'https://s3.ap-south-1.amazonaws.com/b'],
  ])('returns null for %s', (_label, value) => {
    expect(parseS3Ref(value, DEFAULT_BUCKET)).toBeNull();
  });

  it('returns null for a bare key when no default bucket is configured', () => {
    expect(parseS3Ref('production/x.pdf', '')).toBeNull();
  });
});

describe('signingWindowStart', () => {
  it('rounds down to the window boundary', () => {
    const at = Date.parse('2026-09-24T10:59:59.999Z');
    expect(signingWindowStart(at).toISOString()).toBe(
      '2026-09-24T10:00:00.000Z'
    );
  });

  it('gives an identical date anywhere inside one window', () => {
    const early = signingWindowStart(Date.parse('2026-09-24T10:00:00Z'));
    const late = signingWindowStart(Date.parse('2026-09-24T10:59:00Z'));
    expect(early.getTime()).toBe(late.getTime());
  });

  it('moves on at the next window', () => {
    const before = signingWindowStart(Date.parse('2026-09-24T10:59:00Z'));
    const after = signingWindowStart(Date.parse('2026-09-24T11:00:01Z'));
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('shouldRoundSigningTime', () => {
  // Rounding a short-lived link backdates it past its own expiry.
  it('does not round a document link', () => {
    expect(shouldRoundSigningTime(DOCUMENT_TTL_SECONDS)).toBe(false);
  });

  it('rounds an inline image link', () => {
    expect(shouldRoundSigningTime(INLINE_TTL_SECONDS)).toBe(true);
  });

  it('does not round anything at or below one window', () => {
    expect(shouldRoundSigningTime(SIGNING_WINDOW_SECONDS)).toBe(false);
  });
});

describe('safeDownloadName', () => {
  it('removes quotes and backslashes that would break the header', () => {
    expect(safeDownloadName('re"po\\rt.pdf')).toBe('report.pdf');
  });

  it('removes CR and LF so a filename cannot inject a header', () => {
    expect(safeDownloadName('a.pdf\r\nX-Evil: 1')).toBe('a.pdfX-Evil: 1');
  });

  it('caps the length', () => {
    expect(safeDownloadName('a'.repeat(400)).length).toBe(150);
  });
});

describe('attachmentDisposition', () => {
  it('keeps a Devanagari name in filename* and falls back to ASCII', () => {
    expect(attachmentDisposition('Lab-Report_राहुल.pdf')).toBe(
      `attachment; filename="Lab-Report______.pdf"; filename*=UTF-8''Lab-Report_%E0%A4%B0%E0%A4%BE%E0%A4%B9%E0%A5%81%E0%A4%B2.pdf`
    );
  });

  it('escapes the quote that would end the filename* value', () => {
    expect(attachmentDisposition("O'Neil.pdf")).toContain(
      "filename*=UTF-8''O%27Neil.pdf"
    );
  });
});
