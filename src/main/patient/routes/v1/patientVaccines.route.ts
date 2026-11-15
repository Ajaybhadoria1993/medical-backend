import { Router } from 'express';
import { docsRegistry } from '../../../../apiDocs';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  addPatientVaccineController,
  listPatientVaccinesController,
  removePatientVaccineController,
} from '../../controllers/patientVaccine.controller';
import {
  addPatientVaccineSchema,
  patientVaccineIdParamsSchema,
  patientVaccinePatientParamsSchema,
} from '../../schemas/patientVaccine.schema';

const patientVaccinesRouter = Router();

/** @route GET /api/v1/patient/patient-vaccines/:patientId — the patient's doses in this clinic
 *  @access Admin, Doctor, Receptionist, Nurse */
patientVaccinesRouter.get(
  '/:patientId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist', 'Nurse']),
  requireClinic,
  validate(patientVaccinePatientParamsSchema, 'params'),
  listPatientVaccinesController
);

/** @route POST /api/v1/patient/patient-vaccines — record a past dose
 *  @access Admin, Doctor, Nurse */
patientVaccinesRouter.post(
  '/',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Nurse']),
  requireClinic,
  validate(addPatientVaccineSchema, 'body'),
  addPatientVaccineController
);

/** @route DELETE /api/v1/patient/patient-vaccines/:id — remove a wrong entry
 *  @access Admin, Doctor, Nurse */
patientVaccinesRouter.delete(
  '/:id',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Nurse']),
  requireClinic,
  validate(patientVaccineIdParamsSchema, 'params'),
  removePatientVaccineController
);

export default patientVaccinesRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/patient-vaccines/:patientId',
  description:
    "The patient's vaccine doses recorded in this clinic, newest first",
  params: patientVaccinePatientParamsSchema,
  tags: ['Patient'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/patient-vaccines',
  description:
    'Record a past vaccine dose; the dose number is counted automatically',
  requestSchema: addPatientVaccineSchema,
  tags: ['Patient'],
});
docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/patient/patient-vaccines/:id',
  description: 'Remove a wrong vaccine entry',
  params: patientVaccineIdParamsSchema,
  tags: ['Patient'],
});
