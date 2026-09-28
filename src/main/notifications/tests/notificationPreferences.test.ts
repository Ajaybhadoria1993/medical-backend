import { getRoleDefaults } from '../preferences/notificationPreferences.constants';

describe('Notification Preferences Defaults', () => {
  it('should return default Admin preferences for Admin role', () => {
    const adminDefaults = getRoleDefaults('Admin');
    expect(adminDefaults.inApp).toBeDefined();
    expect(adminDefaults.inApp.appointment_created).toEqual({
      enabled: true,
      configurable: true,
    });
    expect(adminDefaults.inApp.clinic_created).toBeUndefined();
  });

  it('should merge Super_Admin custom defaults on top of Admin defaults', () => {
    const superAdminDefaults = getRoleDefaults('Super_Admin');
    expect(superAdminDefaults.inApp).toBeDefined();
    // Inherited from Admin
    expect(superAdminDefaults.inApp.appointment_created).toEqual({
      enabled: true,
      configurable: true,
    });
    // Specific to Super_Admin
    expect(superAdminDefaults.inApp.clinic_created).toEqual({
      enabled: true,
      configurable: true,
    });
    expect(superAdminDefaults.push.clinic_created).toEqual({
      enabled: true,
      configurable: true,
    });
  });

  it('should return empty preference structure for unknown role', () => {
    const unknownDefaults = getRoleDefaults('UnknownRole');
    expect(unknownDefaults).toEqual({
      inApp: {},
      push: {},
    });
  });
});
