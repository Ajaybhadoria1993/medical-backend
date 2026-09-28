import { validateRazorpayVpa } from '../../../utils/razorpay';
import { HttpError } from '../../../middlewear/errorHandler';

export const getUpiDetails = async (upiId: string) => {
  if (!upiId?.trim()) {
    throw HttpError.badRequest('UPI ID is required');
  }

  const trimmedUpiId = upiId.trim();
  const isValidFormat = /^[^@\s]+@[^@\s]+$/.test(trimmedUpiId);
  if (!isValidFormat) {
    throw HttpError.badRequest('Invalid UPI ID format');
  }

  const result = await validateRazorpayVpa(trimmedUpiId);

  return {
    upiId: trimmedUpiId,
    exists: result.exists ?? false,
    name: result.name ?? null,
    ...(result.bank ? { bank: result.bank } : {}),
  };
};
