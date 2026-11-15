import { updateConfigBodySchema } from '../schemas/appUpdate.schemas';
import { compareVersions } from '../utils/version.utils';

const body = {
  app_name: 'doctor',
  platform: 'android' as const,
  force_update: false,
  latest_version: '2.1.0',
  minimum_version: '1.5.0',
};

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('treats a missing part as 0', () => {
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
  });
});

describe('updateConfigBodySchema', () => {
  it('accepts a minimum below latest and defaults the store URL', () => {
    const result = updateConfigBodySchema.safeParse(body);
    expect(result.success).toBe(true);
    expect(result.success && result.data.store_url).toBe('');
  });

  it('rejects a minimum above latest, which would block every user', () => {
    const result = updateConfigBodySchema.safeParse({
      ...body,
      minimum_version: '9.0.0',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a version that is not numbers and dots', () => {
    expect(
      updateConfigBodySchema.safeParse({ ...body, latest_version: 'abc' })
        .success
    ).toBe(false);
  });

  it('rejects a store URL that is not https', () => {
    expect(
      updateConfigBodySchema.safeParse({
        ...body,
        store_url: 'http://play.google.com/x',
      }).success
    ).toBe(false);
  });
});
