import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getSystemJobs,
  runSystemJob,
} from '../../controllers/systemJobs.controller';
import { jobKeyParamsSchema } from '../../schemas/systemJobs.schemas';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

/** @route GET /api/v1/system-jobs — background jobs, last run, failures, missed runs
 *  @access Super_Admin */
router.get('/', getSystemJobs);

/** @route POST /api/v1/system-jobs/:key/run — run one job now (recorded with who pressed it)
 *  @access Super_Admin */
router.post('/:key/run', validate(jobKeyParamsSchema, 'params'), runSystemJob);

export default router;
