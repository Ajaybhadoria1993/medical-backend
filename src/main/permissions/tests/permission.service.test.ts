import { PermissionService } from '../services/permission.service';

describe('PermissionService.getUserPermissionMatrix', () => {
  let getActiveCatalogSpy: jest.SpyInstance;
  let getGrantedKeysSpy: jest.SpyInstance;

  const mockCatalog = [
    {
      key: 'lab_test:view',
      resource: 'Receptionist',
      action: 'view',
      description: 'View lab tests',
    },
    {
      key: 'lab_test:mark_paid',
      resource: 'Receptionist, Doctor',
      action: 'mark_paid',
      description: 'Mark lab tests as paid',
    },
    {
      key: 'patient:delete',
      resource: 'Doctor',
      action: 'delete',
      description: 'Delete patient records',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    getActiveCatalogSpy = jest
      .spyOn(PermissionService, 'getActiveCatalog')
      .mockResolvedValue(mockCatalog);
    getGrantedKeysSpy = jest
      .spyOn(PermissionService, 'getGrantedKeys')
      .mockResolvedValue([]);
  });

  afterEach(() => {
    getActiveCatalogSpy.mockRestore();
    getGrantedKeysSpy.mockRestore();
  });

  it('should filter permissions for a Doctor user to only show permissions with resource containing Doctor', async () => {
    const result = await PermissionService.getUserPermissionMatrix(
      'user-123',
      'Doctor',
      'clinic-123'
    );

    // Doctor should see 'lab_test:mark_paid' (Receptionist, Doctor) and 'patient:delete' (Doctor)
    // Doctor should NOT see 'lab_test:view' (Receptionist)
    const allPermissions = result.flatMap((group) => group.permissions);
    const keys = allPermissions.map((p) => p.key);

    expect(keys).toContain('lab_test:mark_paid');
    expect(keys).toContain('patient:delete');
    expect(keys).not.toContain('lab_test:view');

    // Verification of resource groups format
    expect(result).toHaveLength(2); // 'Receptionist, Doctor' and 'Doctor' resources
  });

  it('should filter permissions for a Receptionist user to only show permissions with resource containing Receptionist', async () => {
    const result = await PermissionService.getUserPermissionMatrix(
      'user-123',
      'Receptionist',
      'clinic-123'
    );

    // Receptionist should see 'lab_test:view' (Receptionist) and 'lab_test:mark_paid' (Receptionist, Doctor)
    // Receptionist should NOT see 'patient:delete' (Doctor)
    const allPermissions = result.flatMap((group) => group.permissions);
    const keys = allPermissions.map((p) => p.key);

    expect(keys).toContain('lab_test:view');
    expect(keys).toContain('lab_test:mark_paid');
    expect(keys).not.toContain('patient:delete');
  });

  it('should return all catalog permissions without filtering for Admin userType', async () => {
    const result = await PermissionService.getUserPermissionMatrix(
      'user-123',
      'Admin',
      'clinic-123'
    );

    const allPermissions = result.flatMap((group) => group.permissions);
    const keys = allPermissions.map((p) => p.key);

    expect(keys).toContain('lab_test:view');
    expect(keys).toContain('lab_test:mark_paid');
    expect(keys).toContain('patient:delete');
  });

  it('should return all catalog permissions without filtering for Super_Admin userType', async () => {
    const result = await PermissionService.getUserPermissionMatrix(
      'user-123',
      'Super_Admin',
      'clinic-123'
    );

    const allPermissions = result.flatMap((group) => group.permissions);
    const keys = allPermissions.map((p) => p.key);

    expect(keys).toContain('lab_test:view');
    expect(keys).toContain('lab_test:mark_paid');
    expect(keys).toContain('patient:delete');
  });
});
