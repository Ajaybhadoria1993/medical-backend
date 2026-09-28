import { HttpError } from '../../../middlewear/errorHandler';
import { StaffScopeService } from '../services/staffScope.service';
import { StaffScope } from '../types/staffScope.types';
import { scopeCacheKey } from '../utils/staffScope.utils';

const scope = (overrides: Partial<StaffScope> = {}): StaffScope => ({
  accessScope: 'assigned_doctors',
  location: null,
  responsibility: null,
  doctorIds: [],
  isDefault: false,
  ...overrides,
});

describe('StaffScopeService.getAccessibleDoctorIds', () => {
  let getScopeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getScopeSpy = jest.spyOn(StaffScopeService, 'getScope');
  });

  afterEach(() => {
    getScopeSpy.mockRestore();
  });

  it('leaves an Admin unrestricted without reading any scope row', async () => {
    const result = await StaffScopeService.getAccessibleDoctorIds(
      { id: 'user-1', userType: 'Admin' },
      'clinic-1'
    );

    expect(result).toBeNull();
    expect(getScopeSpy).not.toHaveBeenCalled();
  });

  it('leaves a Doctor unrestricted — doctors are scoped by their own queries', async () => {
    const result = await StaffScopeService.getAccessibleDoctorIds(
      { id: 'user-1', userType: 'Doctor' },
      'clinic-1'
    );

    expect(result).toBeNull();
  });

  it('applies to every scoped staff role, not just Receptionist', async () => {
    getScopeSpy.mockResolvedValue(scope({ doctorIds: ['doctor-1'] }));

    const result = await StaffScopeService.getAccessibleDoctorIds(
      { id: 'user-1', userType: 'Nurse' },
      'clinic-1'
    );

    expect(result).toEqual(['doctor-1']);
  });

  it('returns the assigned doctor ids for a restricted staff member', async () => {
    getScopeSpy.mockResolvedValue(
      scope({ doctorIds: ['doctor-1', 'doctor-2'] })
    );

    const result = await StaffScopeService.getAccessibleDoctorIds(
      { id: 'user-1', userType: 'Receptionist' },
      'clinic-1'
    );

    expect(result).toEqual(['doctor-1', 'doctor-2']);
  });

  it('returns null for a staff member configured with all-doctors access', async () => {
    getScopeSpy.mockResolvedValue(scope({ accessScope: 'all_doctors' }));

    const result = await StaffScopeService.getAccessibleDoctorIds(
      { id: 'user-1', userType: 'Receptionist' },
      'clinic-1'
    );

    expect(result).toBeNull();
  });

  it('returns an empty list — not null — for a staff member assigned to nobody', async () => {
    getScopeSpy.mockResolvedValue(scope({ doctorIds: [] }));

    const result = await StaffScopeService.getAccessibleDoctorIds(
      { id: 'user-1', userType: 'Receptionist' },
      'clinic-1'
    );

    expect(result).toEqual([]);
  });
});

describe('StaffScopeService.assertDoctorAllowed', () => {
  let getAccessibleDoctorIdsSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getAccessibleDoctorIdsSpy = jest.spyOn(
      StaffScopeService,
      'getAccessibleDoctorIds'
    );
  });

  afterEach(() => {
    getAccessibleDoctorIdsSpy.mockRestore();
  });

  it('allows any doctor when the caller is unrestricted', async () => {
    getAccessibleDoctorIdsSpy.mockResolvedValue(null);

    await expect(
      StaffScopeService.assertDoctorAllowed(
        { id: 'user-1', userType: 'Admin' },
        'clinic-1',
        'doctor-9'
      )
    ).resolves.toBeUndefined();
  });

  it('allows an assigned doctor', async () => {
    getAccessibleDoctorIdsSpy.mockResolvedValue(['doctor-1']);

    await expect(
      StaffScopeService.assertDoctorAllowed(
        { id: 'user-1', userType: 'Receptionist' },
        'clinic-1',
        'doctor-1'
      )
    ).resolves.toBeUndefined();
  });

  it('rejects an unassigned doctor with a 403', async () => {
    getAccessibleDoctorIdsSpy.mockResolvedValue(['doctor-1']);

    await expect(
      StaffScopeService.assertDoctorAllowed(
        { id: 'user-1', userType: 'Receptionist' },
        'clinic-1',
        'doctor-2'
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects every doctor when the staff member is assigned to nobody', async () => {
    getAccessibleDoctorIdsSpy.mockResolvedValue([]);

    await expect(
      StaffScopeService.assertDoctorAllowed(
        { id: 'user-1', userType: 'Receptionist' },
        'clinic-1',
        'doctor-1'
      )
    ).rejects.toBeInstanceOf(HttpError);
  });
});

describe('scopeCacheKey', () => {
  it('separates unrestricted from assigned-to-nobody', () => {
    expect(scopeCacheKey(null)).toBe('all');
    expect(scopeCacheKey([])).toBe('none');
  });

  it('is stable regardless of the order the doctors come back in', () => {
    expect(scopeCacheKey(['b', 'a'])).toBe(scopeCacheKey(['a', 'b']));
  });
});
