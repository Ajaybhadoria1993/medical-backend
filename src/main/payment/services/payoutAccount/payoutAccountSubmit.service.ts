import { HttpError } from '../../../../middlewear/errorHandler';
import type { OnboardRouteDto } from '../../../clinic/schemas/clinic.schemas';
import {
  CANCELLED_CHEQUE_DOCUMENT,
  getRequiredDocumentsForBusinessType,
} from '../../utils/payoutAccount.utils';
import {
  payoutCard,
  type PayoutCard,
  type PayoutStage,
} from '../../utils/payoutAccountCard.utils';
import {
  razorpayUpiPayoutsAvailable,
  UPI_TEST_MODE,
} from '../../../../utils/razorpay';
import { PayoutAccountSetupService } from './payoutAccountSetup.service';
import { PayoutAccountStatusService } from './payoutAccountStatus.service';

/** One uploaded document: the form field name is its document type. */
export interface PayoutDocumentFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

/** The one-form payout setup: runs Razorpay's stages in order and answers with the status card. */
export class PayoutAccountSubmitService {
  /** Each stage skips what is already done, so sending the form again continues from a failed stage. */
  static async submit(
    clinicId: string,
    details: OnboardRouteDto,
    files: PayoutDocumentFile[],
    clientIp: string
  ): Promise<PayoutCard> {
    // Razorpay test mode refuses UPI payouts; say so before any Razorpay call.
    if (details.upi?.vpa && !razorpayUpiPayoutsAvailable())
      throw new HttpError(422, UPI_TEST_MODE);
    const before = await this.card(clinicId);
    if (before.state === 'verifying' || before.state === 'ready') return before;
    this.checkDocuments(details.businessType, files);

    let stage: PayoutStage = 'account';
    try {
      await PayoutAccountSetupService.onboardRouteAccount(
        clinicId,
        details,
        clientIp
      );
      stage = 'documents';
      for (const f of files)
        await PayoutAccountSetupService.uploadKYCDocuments(
          clinicId,
          f.fieldname,
          f.buffer,
          f.originalname,
          f.mimetype
        );
      stage = 'activation';
      await PayoutAccountSetupService.activateRouteAccount(clinicId, clientIp);
    } catch (err) {
      // A Razorpay or stage refusal is shown on the card; anything else is a bug and surfaces as 500.
      if (!(err instanceof HttpError)) throw err;
      // Razorpay named a form field (e.g. email taken): the form shows it under that field.
      if ((err.details as { field?: string } | undefined)?.field) throw err;
      return this.card(clinicId, { stage, reason: err.message });
    }
    return this.card(clinicId);
  }

  /** The status card: stored Route status, the verified bank and, after a failed submit, why. */
  static async card(
    clinicId: string,
    failure?: { stage: PayoutStage; reason: string }
  ): Promise<PayoutCard> {
    const [status, bank] = await Promise.all([
      PayoutAccountStatusService.getOnboardingStatus(clinicId),
      PayoutAccountStatusService.getActiveBankDetails(clinicId),
    ]);
    return {
      ...payoutCard(status, bank, failure),
      upiPayoutsAvailable: razorpayUpiPayoutsAvailable(),
    };
  }

  /** 422 before any Razorpay call for an unknown document field; which ones are needed is Razorpay's call. */
  private static checkDocuments(
    businessType: string,
    files: PayoutDocumentFile[]
  ) {
    const known = new Set(
      [
        ...getRequiredDocumentsForBusinessType(businessType),
        CANCELLED_CHEQUE_DOCUMENT,
      ].map((d) => d.documentType)
    );
    const unknown = files.filter((f) => !known.has(f.fieldname));
    if (unknown.length)
      throw new HttpError(
        422,
        `Unknown document: ${unknown.map((f) => f.fieldname).join(', ')}`
      );
  }
}
