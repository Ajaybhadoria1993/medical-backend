import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import { validateUpiController } from '../../controllers/upi.controller';
import { validateUpiSchema } from '../../schemas/upi.schemas';
import { requireAuth } from '../../../../middlewear/auth.middleware';

const upiRouter = express.Router();

/**
 * @route POST /api/v1/global/upi/lookup
 * @desc Lookup UPI ID and return linked bank/name details
 * @access Public
 */
upiRouter.post(
  '/lookup',
  requireAuth,
  validate(validateUpiSchema, 'body'),
  validateUpiController
);

export default upiRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/global/upi/lookup',
  description:
    'Lookup UPI ID with Razorpay and return linked bank/name details',
  tags: ['global', 'upi'],
});
