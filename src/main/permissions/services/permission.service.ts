import { and, asc, eq, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  CacheKeys,
  getOrSetCache,
  invalidateCache,
} from '../../../utils/cache.util';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { realtimeBus, target as realtimeTarget } from '../../realtime';
import { UserModel } from '../../users/models/user.model';
import {
  PermissionAuditLogModel,
  PermissionsModel,
  UserPermissionsModel,
} from '../models/permission.model';
import {
  ALL_PERMISSION_KEYS,
  PermissionCatalogEntry,
  PermissionCatalogItem,
  PermissionResourceGroup,
  ROLE_DEFAULT_PERMISSIONS,
  UpdateUserPermissionsResult,
} from '../utils/permission.constants';

// The catalog's `resource` column holds the comma-separated roles an entry
// applies to. Shared by the per-user matrix and the pre-creation catalog so a
// role can never be offered one set of permissions before it exists and a
// different set after.
function catalogForRole(
  catalog: PermissionCatalogEntry[],
  userType: string
): PermissionCatalogEntry[] {
  if (userType === 'Super_Admin' || userType === 'Admin') return catalog;

  return catalog.filter((entry) => {
    if (!entry.resource) return false;
    return entry.resource
      .split(',')
      .map((role) => role.trim())
      .includes(userType);
  });
}

function roleDefaultsFor(userType: string): Set<string> {
  return new Set<string>(
    userType === 'Super_Admin'
      ? ALL_PERMISSION_KEYS
      : (ROLE_DEFAULT_PERMISSIONS[userType] ?? [])
  );
}

function groupByResource<T extends PermissionCatalogEntry>(
  entries: T[]
): PermissionResourceGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.resource);
    if (bucket) bucket.push(entry);
    else groups.set(entry.resource, [entry]);
  }
  return Array.from(groups, ([resource, permissions]) => ({
    resource,
    permissions,
  }));
}

export class PermissionService {
  private static CACHE_TTL = 300;

  static async getActiveCatalog(): Promise<PermissionCatalogEntry[]> {
    return database
      .select({
        key: PermissionsModel.key,
        resource: PermissionsModel.resource,
        action: PermissionsModel.action,
        description: PermissionsModel.description,
      })
      .from(PermissionsModel)
      .where(eq(PermissionsModel.isActive, true))
      .orderBy(asc(PermissionsModel.resource), asc(PermissionsModel.key));
  }

  static async getGroupedCatalog(): Promise<PermissionResourceGroup[]> {
    return groupByResource(await this.getActiveCatalog());
  }

  // Only the DB-backed grants are cached — role defaults are resolved from code on
  // every check, so a user_type change needs no cache bust.
  static async getGrantedKeys(
    userId: string,
    clinicId: string
  ): Promise<string[]> {
    return getOrSetCache(
      CacheKeys.userPermissions(userId, clinicId),
      this.CACHE_TTL,
      async () => {
        const rows = await database
          .select({ key: PermissionsModel.key })
          .from(UserPermissionsModel)
          .innerJoin(
            PermissionsModel,
            eq(PermissionsModel.id, UserPermissionsModel.permissionId)
          )
          .where(
            and(
              eq(UserPermissionsModel.userId, userId),
              eq(UserPermissionsModel.clinicId, clinicId),
              eq(PermissionsModel.isActive, true)
            )
          );
        return rows.map((row) => row.key);
      }
    );
  }

  static async getEffectivePermissions(
    userId: string,
    userType: string,
    clinicId: string
  ): Promise<string[]> {
    if (userType === 'Super_Admin') return [...ALL_PERMISSION_KEYS];

    const defaults = ROLE_DEFAULT_PERMISSIONS[userType] ?? [];
    const granted = await this.getGrantedKeys(userId, clinicId);
    return Array.from(new Set<string>([...defaults, ...granted]));
  }

  static async hasPermission(
    userId: string,
    userType: string,
    clinicId: string,
    permissionKey: string
  ): Promise<boolean> {
    if (userType === 'Super_Admin') return true;

    const defaults = ROLE_DEFAULT_PERMISSIONS[userType] ?? [];
    if ((defaults as string[]).includes(permissionKey)) return true;

    const granted = await this.getGrantedKeys(userId, clinicId);
    return granted.includes(permissionKey);
  }

  static async hasResourcePermission(
    userId: string,
    userType: string,
    clinicId: string,
    resource: string
  ): Promise<boolean> {
    const prefix = `${resource}:`;
    const effective = await this.getEffectivePermissions(
      userId,
      userType,
      clinicId
    );
    return effective.some((key) => key.startsWith(prefix));
  }

  static async getUserPermissionMatrix(
    userId: string,
    userType: string,
    clinicId: string
  ): Promise<PermissionResourceGroup<PermissionCatalogItem>[]> {
    const [catalog, granted] = await Promise.all([
      this.getActiveCatalog(),
      this.getGrantedKeys(userId, clinicId),
    ]);

    const grantedSet = new Set(granted);
    const roleDefaults = roleDefaultsFor(userType);

    return groupByResource(
      catalogForRole(catalog, userType).map((entry) => ({
        ...entry,
        granted: grantedSet.has(entry.key),
        viaRole: roleDefaults.has(entry.key),
      }))
    );
  }

  // The same matrix for a user who does not exist yet, so Add User can offer
  // the permissions a role supports before there is an id to grant them to.
  // Nothing is granted, so `granted` is false everywhere except role defaults.
  static async getRolePermissionMatrix(
    userType: string
  ): Promise<PermissionResourceGroup<PermissionCatalogItem>[]> {
    const roleDefaults = roleDefaultsFor(userType);

    return groupByResource(
      catalogForRole(await this.getActiveCatalog(), userType).map((entry) => ({
        ...entry,
        granted: roleDefaults.has(entry.key),
        viaRole: roleDefaults.has(entry.key),
      }))
    );
  }

  static async updateUserPermissions(params: {
    userId: string;
    clinicId: string;
    permissionKeys: string[];
    performedBy: string;
  }): Promise<UpdateUserPermissionsResult> {
    const { userId, clinicId, permissionKeys, performedBy } = params;

    const [target] = await database
      .select({ userType: UserModel.userType })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.userId, userId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!target) {
      throw new HttpError(404, 'User is not assigned to this clinic');
    }

    // A Super_Admin bypasses every check, so a grant row would be meaningless.
    if (target.userType === 'Super_Admin') {
      throw new HttpError(
        403,
        'Permissions cannot be assigned to a Super Admin'
      );
    }

    const catalog = await database
      .select({ id: PermissionsModel.id, key: PermissionsModel.key })
      .from(PermissionsModel)
      .where(eq(PermissionsModel.isActive, true));

    const idByKey = new Map(catalog.map((row) => [row.key, row.id]));
    const desiredKeys = Array.from(new Set(permissionKeys));
    const unknownKeys = desiredKeys.filter((key) => !idByKey.has(key));
    if (unknownKeys.length) {
      throw new HttpError(
        400,
        `Unknown or inactive permission keys: ${unknownKeys.join(', ')}`
      );
    }

    const existing = await database
      .select({
        id: UserPermissionsModel.id,
        key: PermissionsModel.key,
      })
      .from(UserPermissionsModel)
      .innerJoin(
        PermissionsModel,
        eq(PermissionsModel.id, UserPermissionsModel.permissionId)
      )
      .where(
        and(
          eq(UserPermissionsModel.userId, userId),
          eq(UserPermissionsModel.clinicId, clinicId)
        )
      );

    const existingKeys = new Set(existing.map((row) => row.key));
    const desiredSet = new Set(desiredKeys);
    const toAdd = desiredKeys.filter((key) => !existingKeys.has(key));
    const toRemove = existing.filter((row) => !desiredSet.has(row.key));

    if (!toAdd.length && !toRemove.length) {
      return { added: [], removed: [] };
    }

    await database.transaction(async (tx) => {
      if (toAdd.length) {
        await tx.insert(UserPermissionsModel).values(
          toAdd.map((key) => ({
            userId,
            clinicId,
            permissionId: idByKey.get(key) as string,
            grantedBy: performedBy,
          }))
        );
      }

      if (toRemove.length) {
        await tx.delete(UserPermissionsModel).where(
          inArray(
            UserPermissionsModel.id,
            toRemove.map((row) => row.id)
          )
        );
      }

      await tx.insert(PermissionAuditLogModel).values([
        ...toAdd.map((key) => ({
          clinicId,
          targetUserId: userId,
          performedBy,
          permissionKey: key,
          action: 'granted' as const,
        })),
        ...toRemove.map((row) => ({
          clinicId,
          targetUserId: userId,
          performedBy,
          permissionKey: row.key,
          action: 'revoked' as const,
        })),
      ]);
    });

    await invalidateCache(CacheKeys.userPermissions(userId, clinicId));

    realtimeBus.notify(
      realtimeTarget.permissions(userId),
      'permissions.updated'
    );

    return { added: toAdd, removed: toRemove.map((row) => row.key) };
  }

  // Called on deactivate/reject/block so a stale grant row doesn't outlive the account it was granted to.
  static async revokeAllForUser(
    userId: string,
    clinicId: string,
    performedBy: string
  ): Promise<string[]> {
    const existing = await database
      .select({ id: UserPermissionsModel.id, key: PermissionsModel.key })
      .from(UserPermissionsModel)
      .innerJoin(
        PermissionsModel,
        eq(PermissionsModel.id, UserPermissionsModel.permissionId)
      )
      .where(
        and(
          eq(UserPermissionsModel.userId, userId),
          eq(UserPermissionsModel.clinicId, clinicId)
        )
      );

    if (!existing.length) return [];

    await database.transaction(async (tx) => {
      await tx.delete(UserPermissionsModel).where(
        inArray(
          UserPermissionsModel.id,
          existing.map((row) => row.id)
        )
      );

      await tx.insert(PermissionAuditLogModel).values(
        existing.map((row) => ({
          clinicId,
          targetUserId: userId,
          performedBy,
          permissionKey: row.key,
          action: 'revoked' as const,
        }))
      );
    });

    await invalidateCache(CacheKeys.userPermissions(userId, clinicId));
    realtimeBus.notify(
      realtimeTarget.permissions(userId),
      'permissions.revoked'
    );

    return existing.map((row) => row.key);
  }
}
