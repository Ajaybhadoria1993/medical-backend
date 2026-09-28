import { eq } from 'drizzle-orm';
import { Request, Response } from 'express';
import { database } from '../../../configurations/dbConnection';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { UserModel } from '../../users/models/user.model';
import { PermissionService } from '../services/permission.service';

async function getClinicUserType(userId: string): Promise<string> {
  const [user] = await database
    .select({ userType: UserModel.userType })
    .from(UserModel)
    .where(eq(UserModel.id, userId))
    .limit(1);

  if (!user) throw new HttpError(404, 'User not found');
  return user.userType;
}

export const getPermissionCatalogController = asyncHandler(
  async (req: Request, res: Response) => {
    // With ?role=, the catalog a role supports before any user exists for it —
    // what Add User needs to offer permissions at creation time.
    const { role } = req.validatedQuery ?? {};

    const catalog = role
      ? await PermissionService.getRolePermissionMatrix(role)
      : await PermissionService.getGroupedCatalog();

    return sendOk(res, 'Permission catalog fetched successfully', catalog);
  }
);

export const getMyPermissionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const permissions = await PermissionService.getEffectivePermissions(
      req.user.id,
      req.user.userType,
      req.clinicId
    );
    return sendOk(res, 'Permissions fetched successfully', { permissions });
  }
);

export const getUserPermissionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.validatedParams;
    const userType = await getClinicUserType(userId);

    const permissions = await PermissionService.getUserPermissionMatrix(
      userId,
      userType,
      req.clinicId
    );

    return sendOk(res, 'User permissions fetched successfully', {
      userId,
      userType,
      permissions,
    });
  }
);

export const updateUserPermissionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.validatedParams;
    const { permissionKeys } = req.validatedBody;

    if (userId === req.user.id) {
      throw new HttpError(400, 'You cannot change your own permissions');
    }

    const result = await PermissionService.updateUserPermissions({
      userId,
      clinicId: req.clinicId,
      permissionKeys,
      performedBy: req.user.id,
    });

    return sendOk(res, 'Permissions updated', result);
  }
);
