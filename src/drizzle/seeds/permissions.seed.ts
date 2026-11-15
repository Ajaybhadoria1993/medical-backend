import { eq, inArray } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import { ClinicAssignModel } from '../../main/clinic/models/clinic.model';
import {
  PermissionAuditLogModel,
  PermissionsModel,
  UserPermissionsModel,
} from '../../main/permissions/models/permission.model';
import {
  PermissionCatalogEntry,
  PERMISSION_KEYS,
} from '../../main/permissions/utils/permission.constants';
import { SCOPED_STAFF_ROLES } from '../../main/permissions/utils/staffScope.utils';
import { UserModel } from '../../main/users/models/user.model';
import logger from '../../utils/logger';
import { logSeed, newCounts, syncRow, tally } from './seedSync';

// `resource` doubles as the list of roles the key applies to — it is what
// PermissionService.getUserPermissionMatrix filters the admin UI on. Comma
// separate for a key that more than one role can hold.
export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  {
    key: PERMISSION_KEYS.LAB_TEST_VIEW,
    resource: 'Receptionist',
    action: 'view',
    description: 'View lab tests and orders',
  },
  {
    key: PERMISSION_KEYS.LAB_TEST_CREATE,
    resource: 'Receptionist',
    action: 'create',
    description: 'Create walk-in / independent lab test orders',
  },
  {
    key: PERMISSION_KEYS.LAB_TEST_MARK_PAID,
    resource: 'Receptionist',
    action: 'mark_paid',
    description: 'Mark a lab test payment as paid',
  },
  {
    key: PERMISSION_KEYS.APPOINTMENT_VIEW,
    resource: 'Receptionist, Nurse',
    action: 'view',
    description: 'View appointments for the doctors they are assigned to',
  },
  {
    key: PERMISSION_KEYS.APPOINTMENT_CREATE,
    resource: 'Receptionist, Nurse',
    action: 'create',
    description: 'Book appointments for the doctors they are assigned to',
  },
  {
    key: PERMISSION_KEYS.APPOINTMENT_WALKIN,
    resource: 'Receptionist, Nurse',
    action: 'walkin',
    description: 'Add walk-in patients to an assigned doctor',
  },
  {
    key: PERMISSION_KEYS.APPOINTMENT_CUSTOM_SLOT,
    resource: 'Receptionist, Nurse',
    action: 'custom_slot',
    description:
      "Book override appointments outside the doctor's configured availability",
  },
  {
    key: PERMISSION_KEYS.QUEUE_MANAGE,
    resource: 'Receptionist, Nurse',
    action: 'manage',
    description: 'Manage the live queue for assigned doctors',
  },
  {
    key: PERMISSION_KEYS.PAYMENT_MANAGE,
    resource: 'Receptionist, Nurse',
    action: 'manage',
    description: 'Collect and update appointment payments',
  },
  {
    key: PERMISSION_KEYS.PATIENT_MANAGE,
    resource: 'Receptionist, Nurse',
    action: 'manage',
    description: 'Add and edit patient details',
  },
];

// These could all be done by role alone before permissions existed, so every
// staff member already in the system needs the grant written once — otherwise
// the deploy quietly takes abilities away from people mid-shift. New staff start
// with nothing and are configured by their clinic admin.
// APPOINTMENT_CUSTOM_SLOT is intentionally absent: it is a new capability, not
// one staff already had before permissions existed, so nobody is backfilled
// into the ability to book outside a doctor's availability.
const STAFF_BACKFILL_KEYS: string[] = [
  PERMISSION_KEYS.APPOINTMENT_VIEW,
  PERMISSION_KEYS.APPOINTMENT_CREATE,
  PERMISSION_KEYS.APPOINTMENT_WALKIN,
  PERMISSION_KEYS.QUEUE_MANAGE,
  PERMISSION_KEYS.PAYMENT_MANAGE,
  PERMISSION_KEYS.PATIENT_MANAGE,
  PERMISSION_KEYS.LAB_TEST_CREATE,
];

async function backfillExistingStaff() {
  const permissions = await database
    .select({ id: PermissionsModel.id, key: PermissionsModel.key })
    .from(PermissionsModel)
    .where(inArray(PermissionsModel.key, STAFF_BACKFILL_KEYS));

  if (!permissions.length) return;

  const staff = await database
    .select({
      userId: ClinicAssignModel.userId,
      clinicId: ClinicAssignModel.clinicId,
    })
    .from(ClinicAssignModel)
    .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
    .where(inArray(UserModel.userType, [...SCOPED_STAFF_ROLES]));

  if (!staff.length) return;

  // Only staff never configured: no permission rows and no grant/revoke in the audit log. The log
  // remembers an admin who revoked everything, so a revoked permission never comes back.
  const [granted, audited] = await Promise.all([
    database
      .selectDistinct({
        userId: UserPermissionsModel.userId,
        clinicId: UserPermissionsModel.clinicId,
      })
      .from(UserPermissionsModel),
    database
      .selectDistinct({
        userId: PermissionAuditLogModel.targetUserId,
        clinicId: PermissionAuditLogModel.clinicId,
      })
      .from(PermissionAuditLogModel),
  ]);
  const configured = new Set(
    [...granted, ...audited].map((r) => `${r.userId}|${r.clinicId}`)
  );
  const fresh = staff.filter(
    (s) => !configured.has(`${s.userId}|${s.clinicId}`)
  );
  if (!fresh.length) {
    logger.info('[seed] staff permission backfill: 0 created');
    return;
  }

  const rows = fresh.flatMap(({ userId, clinicId }) =>
    permissions.map((permission) => ({
      userId,
      clinicId,
      permissionId: permission.id,
    }))
  );

  const added = await database
    .insert(UserPermissionsModel)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: UserPermissionsModel.id });
  logger.info(`[seed] staff permission backfill: ${added.length} created`);
}

/** The permission catalog is code-owned: every key is kept in step with PERMISSION_CATALOG. */
export async function seedPermissions() {
  const counts = newCounts();
  const changed: string[] = [];
  for (const entry of PERMISSION_CATALOG) {
    const { result } = await syncRow({
      table: PermissionsModel,
      where: eq(PermissionsModel.key, entry.key),
      values: { ...entry, isActive: true },
    });
    tally(counts, changed, entry.key, result);
  }
  logSeed('permissions', counts, changed);
  await backfillExistingStaff();
}
