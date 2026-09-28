import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  getMyPermissionsController,
  getPermissionCatalogController,
  getUserPermissionsController,
  updateUserPermissionsController,
} from '../../controllers/permission.controller';
import {
  permissionCatalogQuerySchema,
  permissionUserIdParamSchema,
  updateUserPermissionsSchema,
  permissionCatalogResponseSchema,
  myPermissionsResponseSchema,
  userPermissionsResponseSchema,
  updateUserPermissionsResponseSchema,
} from '../../schemas/permission.schema';
import {
  getDoctorStaffController,
  getMyScopeController,
  getStaffAssignmentController,
  listStaffAssignmentsController,
  updateStaffAssignmentController,
} from '../../controllers/staffAssignment.controller';
import {
  doctorIdParamSchema,
  staffUserIdParamSchema,
  updateStaffAssignmentSchema,
  myScopeResponseSchema,
  listStaffAssignmentsResponseSchema,
  staffAssignmentResponseSchema,
  doctorStaffResponseSchema,
} from '../../schemas/staffAssignment.schema';

const permissionsRouter = express.Router();

const requirePermissionAdmin = requireRole(['Admin', 'Super_Admin']);

permissionsRouter.get(
  '/catalog',
  requireAuth,
  requirePermissionAdmin,
  requireClinic,
  validate(permissionCatalogQuerySchema, 'query'),
  getPermissionCatalogController
);

permissionsRouter.get(
  '/me',
  requireAuth,
  requireClinic,
  getMyPermissionsController
);

permissionsRouter.get(
  '/users/:userId',
  validate(permissionUserIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requirePermissionAdmin,
  getUserPermissionsController
);

permissionsRouter.put(
  '/users/:userId',
  validate(permissionUserIdParamSchema, 'params'),
  validate(updateUserPermissionsSchema, 'body'),
  requireAuth,
  requireClinic,
  requirePermissionAdmin,
  updateUserPermissionsController
);

permissionsRouter.get(
  '/me/scope',
  requireAuth,
  requireClinic,
  getMyScopeController
);

permissionsRouter.get(
  '/assignments',
  requireAuth,
  requireClinic,
  requirePermissionAdmin,
  listStaffAssignmentsController
);

permissionsRouter.get(
  '/doctors/:doctorId/staff',
  validate(doctorIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requirePermissionAdmin,
  getDoctorStaffController
);

permissionsRouter.get(
  '/users/:userId/assignment',
  validate(staffUserIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requirePermissionAdmin,
  getStaffAssignmentController
);

permissionsRouter.put(
  '/users/:userId/assignment',
  validate(staffUserIdParamSchema, 'params'),
  validate(updateStaffAssignmentSchema, 'body'),
  requireAuth,
  requireClinic,
  requirePermissionAdmin,
  updateStaffAssignmentController
);

export default permissionsRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/permissions/catalog',
  description:
    'Every active permission key grouped by resource. `?role=` returns the ' +
    'subset a role supports with `granted` / `viaRole` flags — what Add User ' +
    'shows before the user exists. Access: Admin / Super_Admin.',
  query: permissionCatalogQuerySchema,
  responseSchema: permissionCatalogResponseSchema,
  tags: ['permissions'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/permissions/me',
  description:
    'The effective permission keys of the authenticated user in the current ' +
    'clinic (role defaults ∪ explicit grants; Super_Admin gets all). Access: ' +
    'any authenticated clinic user — this is what the frontend gates UI on.',
  responseSchema: myPermissionsResponseSchema,
  tags: ['permissions'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/permissions/users/:userId',
  description:
    "The full permission catalog for a user's role, each entry flagged " +
    '`granted` (explicit grant) and `viaRole` (role default, read-only in the ' +
    'UI). Access: Admin / Super_Admin.',
  params: permissionUserIdParamSchema,
  responseSchema: userPermissionsResponseSchema,
  tags: ['permissions'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/permissions/users/:userId',
  description:
    'Replace the explicit grant set for a user in the clinic (full desired ' +
    'list in `permissionKeys`; the server diffs and audit-logs add/remove). ' +
    'Rejects unknown keys, a Super_Admin target, and changing your own ' +
    'permissions. Access: Admin / Super_Admin.',
  params: permissionUserIdParamSchema,
  requestSchema: updateUserPermissionsSchema,
  responseSchema: updateUserPermissionsResponseSchema,
  tags: ['permissions'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/permissions/me/scope',
  description:
    "The caller's own doctor scope: access scope, assigned doctors, location, " +
    'and `isDefault` (no scope row configured yet → treated as all doctors). ' +
    'Access: any authenticated clinic user.',
  responseSchema: myScopeResponseSchema,
  tags: ['permissions'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/permissions/assignments',
  description:
    'Every assignable staff member (scoped roles only) with their access ' +
    'scope, doctors, location and responsibility. Access: Admin / Super_Admin.',
  responseSchema: listStaffAssignmentsResponseSchema,
  tags: ['permissions'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/permissions/doctors/:doctorId/staff',
  description:
    'The staff responsible for a given doctor — explicit assignments plus ' +
    'clinic-wide (`all_doctors`) staff, flagged `viaAllDoctorsAccess`. ' +
    'Access: Admin / Super_Admin.',
  params: doctorIdParamSchema,
  responseSchema: doctorStaffResponseSchema,
  tags: ['permissions'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/permissions/users/:userId/assignment',
  description:
    "One staff member's doctor assignment, access scope, location and " +
    'responsibility. Access: Admin / Super_Admin.',
  params: staffUserIdParamSchema,
  responseSchema: staffAssignmentResponseSchema,
  tags: ['permissions'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/permissions/users/:userId/assignment',
  description:
    "Replace a staff member's access scope, assigned doctors, location and " +
    'responsibility. `assigned_doctors` requires at least one `doctorIds` ' +
    'entry; applies to scoped roles (Receptionist, Nurse) only. Access: ' +
    'Admin / Super_Admin.',
  params: staffUserIdParamSchema,
  requestSchema: updateStaffAssignmentSchema,
  responseSchema: staffAssignmentResponseSchema,
  tags: ['permissions'],
});
