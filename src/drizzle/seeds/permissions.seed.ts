import { eq, inArray, sql } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import { ClinicAssignModel } from '../../main/clinic/models/clinic.model';
import {
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

  if (!staff.length) {
    logger.info('No existing staff to backfill.');
    return;
  }

  const rows = staff.flatMap(({ userId, clinicId }) =>
    permissions.map((permission) => ({
      userId,
      clinicId,
      permissionId: permission.id,
    }))
  );

  // Idempotent: a re-run re-grants nothing, and a permission an admin has since
  // revoked stays revoked only until the next seed — which is why this seed is
  // a one-time migration aid, not something to run on a schedule.
  await database
    .insert(UserPermissionsModel)
    .values(rows)
    .onConflictDoNothing();

  logger.info(
    `Backfilled staff permissions for ${staff.length} clinic assignment(s).`
  );
}

export async function seedPermissions() {
  try {
    logger.info('Seeding permission catalog...');

    await database
      .insert(PermissionsModel)
      .values(PERMISSION_CATALOG.map((entry) => ({ ...entry, isActive: true })))
      .onConflictDoUpdate({
        target: PermissionsModel.key,
        set: {
          resource: sql`excluded.resource`,
          action: sql`excluded.action`,
          description: sql`excluded.description`,
          isActive: sql`excluded.is_active`,
        },
      });

    logger.info(
      `Permission catalog seeded successfully (${PERMISSION_CATALOG.length} keys)!`
    );

    await backfillExistingStaff();
  } catch (error) {
    logger.error('Error seeding permission catalog:', error);
    throw error;
  }
}
