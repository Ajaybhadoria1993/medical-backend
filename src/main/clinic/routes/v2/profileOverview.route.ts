import express from 'express';
import {
  enforceClinicAutoLogout,
  requireAuth,
  requireClinic,
  requireUser,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import { getClinicProfileOverviewController } from '../../controllers/v2/clinic.controller';

const ProfileOverviewRouter = express.Router();

ProfileOverviewRouter.get(
  '/',
  requireAuth,
  requireUser,
  requireClinic,
  enforceClinicAutoLogout,
  getClinicProfileOverviewController
);

export default ProfileOverviewRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v2/clinic/profile-overview',
  description:
    'Aggregated Clinic Information page payload (clinic, admin, subscription, stats, contact, hours, services, doctors preview, reviews) in a single cached request',
  tags: ['clinic'],
});
