import express from 'express';
import { razorpayWebhookController } from '../../controllers/webhook.controller';

const webhooksRouter = express.Router();

/** @route POST /api/v1/payment/webhooks/razorpay — every Razorpay event, one URL
 *  @access Public (Razorpay only, signature-checked) */
webhooksRouter.post('/razorpay', razorpayWebhookController);

export default webhooksRouter;
