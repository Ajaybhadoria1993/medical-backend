import type { Request } from 'express';
import { logPath } from '../requestLogger';

const path = (originalUrl: string) => logPath({ originalUrl } as Request);

// One API must log as one path, with no patient ids or phone numbers in it.
describe('logPath', () => {
  it('replaces uuids, numbers and long ids with :id', () => {
    expect(
      path('/api/v1/patients/2daa30cf-577f-4818-924b-36c5664fed66/appointments')
    ).toBe('/api/v1/patients/:id/appointments');
    expect(path('/api/v1/users/9876543210')).toBe('/api/v1/users/:id');
    expect(path('/api/v1/files/65f1a2b3c4d5e6f708192a3b')).toBe(
      '/api/v1/files/:id'
    );
  });

  it('keeps version and words, drops the query string', () => {
    expect(path('/api/v1/appointments/today?phone=9876543210')).toBe(
      '/api/v1/appointments/today'
    );
  });
});
