export const PERMISSION_KEYS = {
  LAB_TEST_VIEW: 'lab_test:view',
  LAB_TEST_CREATE: 'lab_test:create',
  LAB_TEST_MARK_PAID: 'lab_test:mark_paid',

  // Staff responsibility model. These say *what* a staff member may do;
  // which doctors' data they may do it to is a separate question answered by
  // StaffScopeService. Never conflate the two.
  APPOINTMENT_VIEW: 'appointment:view',
  APPOINTMENT_CREATE: 'appointment:create',
  APPOINTMENT_WALKIN: 'appointment:walkin',
  // The override booking flow. Deliberately separate from APPOINTMENT_CREATE:
  // being allowed to book is not the same as being allowed to book *outside*
  // the doctor's configured availability, at 2am, during a break.
  APPOINTMENT_CUSTOM_SLOT: 'appointment:custom_slot',
  QUEUE_MANAGE: 'queue:manage',
  PAYMENT_MANAGE: 'payment:manage',
  PATIENT_MANAGE: 'patient:manage',
} as const;

export type PermissionKey =
  (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export const ALL_PERMISSION_KEYS = Object.values(
  PERMISSION_KEYS
) as PermissionKey[];

// The single source of truth for what a role can do without any grant.
// A new role is one line here — never re-scatter these across route files.
//
// The scoped staff roles stay empty on purpose. A role default is not
// revocable (the admin UI renders `viaRole` entries read-only), and the entire
// point of the staff permissions above is that a clinic configures them per
// person. Staff who already existed keep their abilities through the backfill
// in `permissions.seed.ts`, not through a default here.
export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionKey[]> = {
  Super_Admin: [], // bypasses the check entirely, and can never be granted to
  Admin: ALL_PERMISSION_KEYS,
  Doctor: [],
  Receptionist: [],
  Nurse: [],
  Pharmacist: [],
  Lab_Assistant: [],
  Radiologist: [],
  Patient: [],
  User: [],
};

export interface PermissionCatalogEntry {
  key: string;
  resource: string;
  action: string;
  description: string;
}

export interface PermissionCatalogItem extends PermissionCatalogEntry {
  granted: boolean;
  viaRole: boolean;
}

export interface PermissionResourceGroup<
  T extends PermissionCatalogEntry = PermissionCatalogEntry,
> {
  resource: string;
  permissions: T[];
}

export interface UpdateUserPermissionsResult {
  added: string[];
  removed: string[];
}
