import { requireRole } from '../../../middlewear/auth.middleware';

// Buying, changing or cancelling a plan, AutoPay and add-ons are for the clinic owner and Super Admin only.
export const requireBillingAdmin = requireRole(['Admin', 'Super_Admin']);
