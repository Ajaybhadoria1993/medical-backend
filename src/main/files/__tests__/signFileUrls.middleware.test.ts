// Guards the response walker. It runs on every API response, so a false
// positive corrupts data and a false negative is a broken image after the flip.

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn() },
}));

// Mocked at the AWS boundary, so the real signer and walker both run.
jest.mock('../../../configurations/s3/client', () => ({
  s3Client: {},
  BUCKET_NAME: 'test-bucket',
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async () => 'SIGNED'),
}));

import type { Request, Response } from 'express';
import { signFileUrlsInResponses } from '../../../middlewear/signFileUrls.middleware';

/** Runs a payload through the middleware and resolves what actually got sent. */
const send = (body: unknown): Promise<any> =>
  new Promise((resolve) => {
    const res = {
      json: (sent: unknown) => resolve(sent),
    } as unknown as Response;
    signFileUrlsInResponses({} as Request, res, () => {});
    res.json(body);
  });

describe('signFileUrlsInResponses', () => {
  it('signs an env-prefixed key', async () => {
    const out = await send({
      data: { clinicLogo: 'production/clinic_logos/a.png' },
    });
    expect(out.data.clinicLogo).toBe('SIGNED');
  });

  it('signs a full S3 URL', async () => {
    const url = 'https://b.s3.ap-south-1.amazonaws.com/production/x.png';
    const out = await send({ data: { imageUrl: url } });
    expect(out.data.imageUrl).toBe('SIGNED');
  });

  // The sign route's `data.url` and upload `uploadUrl`s arrive already signed.
  it('leaves an already-presigned URL alone', async () => {
    const url =
      'https://b.s3.ap-south-1.amazonaws.com/production/x.pdf?X-Amz-Expires=300&X-Amz-Signature=abc';
    const out = await send({ data: { url, expiresIn: 300 } });
    expect(out.data.url).toBe(url);
  });

  it('signs inside arrays and nested objects', async () => {
    const out = await send({
      data: { items: [{ profileImage: 'staging/profile_pictures/a.jpg' }] },
    });
    expect(out.data.items[0].profileImage).toBe('SIGNED');
  });

  // These get a short-lived link from /files/sign instead.
  it.each([
    'prescriptionPdf',
    'reportPdf',
    'consentFile',
    'invoiceUrl',
    // Signed by labResult.service at the document TTL; re-signing here would
    // hand the caller a 12h link to a lab report.
    'pdfUrl',
    'downloadUrl',
    'currentFileUrl',
  ])('leaves the document field %s alone', async (field) => {
    const out = await send({
      data: { [field]: 'production/prescriptions/a.pdf' },
    });
    expect(out.data[field]).toBe('production/prescriptions/a.pdf');
  });

  it.each([
    ['an external avatar', 'https://lh3.googleusercontent.com/a/abc'],
    ['a patient name', 'Ramesh Sharma'],
    ['a status', 'pending'],
    ['a date', '2026-09-24'],
    ['a bare word that is not a key', 'production'],
  ])('leaves %s untouched', async (_label, value) => {
    const out = await send({ data: { field: value } });
    expect(out.data.field).toBe(value);
  });

  it('passes through nulls and numbers', async () => {
    const out = await send({ data: { a: null, b: 7, c: true } });
    expect(out.data).toEqual({ a: null, b: 7, c: true });
  });

  it('survives a circular payload', async () => {
    const body: any = { data: { clinicLogo: 'production/a.png' } };
    body.self = body;
    await expect(send(body)).resolves.toBeDefined();
  });

  it('sends the original body when signing throws', async () => {
    const { getSignedUrl } = jest.requireMock('@aws-sdk/s3-request-presigner');
    getSignedUrl.mockRejectedValueOnce(new Error('boom'));
    const body = { data: { clinicLogo: 'production/a.png' } };
    await expect(send(body)).resolves.toEqual(body);
  });
});

describe('synchronous fast path', () => {
  /** True when json() wrote before the caller regained control. */
  const sentSynchronously = (body: unknown): boolean => {
    let sent = false;
    const res = {
      json: () => {
        sent = true;
      },
    } as unknown as Response;
    signFileUrlsInResponses({} as Request, res, () => {});
    res.json(body);
    return sent;
  };

  it('sends synchronously when the payload holds no file', () => {
    expect(
      sentSynchronously({ data: { name: 'Ramesh', status: 'pending', n: 1 } })
    ).toBe(true);
  });

  it('sends synchronously when only document fields are present', () => {
    expect(sentSynchronously({ data: { reportPdf: 'production/x.pdf' } })).toBe(
      true
    );
  });

  it('defers only when there is something to sign', () => {
    expect(
      sentSynchronously({ data: { clinicLogo: 'production/a.png' } })
    ).toBe(false);
  });
});
