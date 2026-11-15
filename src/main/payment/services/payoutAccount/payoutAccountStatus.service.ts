/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq } from 'drizzle-orm';
import { fetchRazorpayRouteAccountProducts } from '../../../../utils/razorpay';
import { database } from '../../../../configurations/dbConnection';
import logger from '../../../../utils/logger';
import { ClinicPaymentAccountModel } from '../../../clinic/models/clinicPaymentAccount.model';
import { ClinicBankHistoryModel } from '../../../clinic/models/clinicBankHistory.model';
import {
  ROUTE_DRAFT_ENCRYPTED_PREFIX,
  serializeRouteDraft,
  parseRouteDraft,
  getRouteRejectionIssues,
  RequiredDocumentSpec,
  razorpayAskedDocuments,
  maskAccountNumber,
} from '../../utils/payoutAccount.utils';

/** A clinic's payout account as it stands: onboarding status and the verified bank on file. */
export class PayoutAccountStatusService {
  /**
   * Retrieves current onboarding status and parsed draft submission details.
   */
  static async getOnboardingStatus(clinicId: string) {
    const [clinic] = await database
      .select({
        id: ClinicPaymentAccountModel.id,
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
        razorpayProductId: ClinicPaymentAccountModel.routeProductId,
        routeStatus: ClinicPaymentAccountModel.routeStatus,
        routeOnboardingRejectionReason:
          ClinicPaymentAccountModel.routeOnboardingRejectionReason,
        onboardingDraftData: ClinicPaymentAccountModel.onboardingDraftData,
      })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (!clinic) {
      return {
        accountId: null,
        routeStatus: 'INACTIVE',
        rejectionReason: null,
        submittedDetails: null,
        uploadedDocuments: [],
        requiredDocuments: [],
      };
    }

    let submittedDetails = null;
    let uploadedDocuments: Array<{
      documentType: string;
      fileName: string;
      status: string;
      uploadedAt: string;
    }> = [];
    if (clinic.onboardingDraftData) {
      try {
        submittedDetails = parseRouteDraft(clinic.onboardingDraftData);
        const storedDraft = submittedDetails;
        if (
          !clinic.onboardingDraftData.startsWith(ROUTE_DRAFT_ENCRYPTED_PREFIX)
        ) {
          await database
            .update(ClinicPaymentAccountModel)
            .set({
              onboardingDraftData: serializeRouteDraft(storedDraft),
              updatedAt: new Date(),
            })
            .where(eq(ClinicPaymentAccountModel.id, clinic.id));
        }
        submittedDetails = { ...storedDraft };
        const rawUploadedDocs = Array.isArray(storedDraft.uploadedDocuments)
          ? storedDraft.uploadedDocuments
          : [];
        uploadedDocuments = rawUploadedDocs.map((doc: any) => ({
          documentType: doc.documentType,
          fileName: doc.fileName || `${doc.documentType}.pdf`,
          status: doc.status || 'uploaded',
          uploadedAt: doc.uploadedAt || new Date().toISOString(),
        }));
        delete submittedDetails.uploadedDocuments;
        submittedDetails = this.maskDetails(submittedDetails);
      } catch {
        // Safe fallback
      }
    }

    // Documents are asked for only when Razorpay asks on this account (Route needs details only).
    const businessType = submittedDetails?.businessType;
    let requiredDocuments: RequiredDocumentSpec[] = [];
    // Verifying or Ready can't be asked for documents, so skip the Razorpay call (saves a round trip per page load).
    const canAskDocuments = !['PENDING', 'ACTIVE'].includes(
      String(clinic.routeStatus ?? '').toUpperCase()
    );
    if (
      canAskDocuments &&
      businessType &&
      clinic.razorpayAccountId &&
      clinic.razorpayProductId
    ) {
      try {
        const productConfig = await fetchRazorpayRouteAccountProducts(
          clinic.razorpayAccountId,
          clinic.razorpayProductId
        );
        requiredDocuments = razorpayAskedDocuments(
          Array.isArray(productConfig?.requirements)
            ? productConfig.requirements
            : [],
          businessType
        );
      } catch (error) {
        logger.warn(
          `[Route] Could not refresh Razorpay document requirements for clinic ${clinicId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return {
      accountId: clinic.razorpayAccountId,
      routeStatus: clinic.routeStatus,
      rejectionReason: clinic.routeOnboardingRejectionReason,
      rejectionIssues: getRouteRejectionIssues(
        clinic.routeOnboardingRejectionReason
      ),
      submittedDetails,
      uploadedDocuments,
      requiredDocuments,
    };
  }

  /**
   * Syncs and snapshots the current active bank details config from Razorpay to local database history.
   */
  static async syncClinicBankHistory(accountId: string, productId: string) {
    // 1. Fetch clinic matching the razorpayAccountId
    const [account] = await database
      .select({ clinicId: ClinicPaymentAccountModel.clinicId })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.gatewayAccountId, accountId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (!account) {
      logger.warn(`No clinic found matching Razorpay account ID: ${accountId}`);
      return;
    }
    const clinic = { id: account.clinicId };

    // 2. Fetch configurations from Razorpay
    const products = await fetchRazorpayRouteAccountProducts(
      accountId,
      productId
    );

    // The default destination: settlement_accounts (UPI or bank, after a switch) wins over legacy settlements.
    const dest =
      this.payoutDestination(
        products?.requested_configuration ?? products?.active_configuration
      ) ?? this.payoutDestination(products?.active_configuration);
    if (!dest) {
      logger.warn(
        `No settlement configuration found for account: ${accountId}`
      );
      return;
    }

    const newAccNum = dest.account;
    const newIfsc = dest.ifsc;
    const newName = dest.name;
    const newBankName = dest.bankName;

    // 3. Query the current active snapshot in the DB
    const [currentActive] = await database
      .select()
      .from(ClinicBankHistoryModel)
      .where(
        and(
          eq(ClinicBankHistoryModel.clinicId, clinic.id),
          eq(ClinicBankHistoryModel.isActive, true)
        )
      )
      .limit(1);

    // 4. Compare and update versions if they differ
    const hasChanged =
      !currentActive ||
      currentActive.maskedAccountNumber !== newAccNum ||
      currentActive.ifscCode !== newIfsc ||
      currentActive.beneficiaryName !== newName ||
      currentActive.bankName !== newBankName;

    if (hasChanged) {
      const now = new Date();

      if (currentActive) {
        // Mark the old snapshot as inactive and set ending date
        await database
          .update(ClinicBankHistoryModel)
          .set({
            isActive: false,
            effectiveTo: now,
            updatedAt: now,
          })
          .where(eq(ClinicBankHistoryModel.id, currentActive.id));
      }

      // Insert the new active snapshot
      await database.insert(ClinicBankHistoryModel).values({
        clinicId: clinic.id,
        linkedAccountId: null,
        providerLinkedAccountId: accountId,
        beneficiaryName: newName,
        bankName: newBankName,
        maskedAccountNumber: newAccNum,
        ifscCode: newIfsc,
        effectiveFrom: now,
        isActive: true,
      });

      logger.info(`Recorded new bank history version for clinic ${clinic.id}`);
    }
  }

  /**
   * Fetches the currently active verified bank configuration snapshot for a clinic.
   */
  static async getActiveBankDetails(clinicId: string) {
    const [bankDetails] = await database
      .select({
        beneficiaryName: ClinicBankHistoryModel.beneficiaryName,
        bankName: ClinicBankHistoryModel.bankName,
        maskedAccountNumber: ClinicBankHistoryModel.maskedAccountNumber,
        ifscCode: ClinicBankHistoryModel.ifscCode,
        isActive: ClinicBankHistoryModel.isActive,
      })
      .from(ClinicBankHistoryModel)
      .where(
        and(
          eq(ClinicBankHistoryModel.clinicId, clinicId),
          eq(ClinicBankHistoryModel.isActive, true)
        )
      )
      .limit(1);

    return bankDetails || null;
  }

  /** Where Razorpay pays this account, in bank-history terms; a UPI ID is masked like dr••@okhdfc. */
  private static payoutDestination(config: any) {
    const entry =
      (config?.settlement_accounts ?? []).find(
        (a: any) => a?.upi?.is_default || a?.bank_account?.is_default
      ) ?? config?.settlement_accounts?.[0];
    if (entry?.method === 'upi' && entry.upi?.vpa) {
      const [user, handle] = String(entry.upi.vpa).split('@');
      return {
        account: `${user.slice(0, 2)}••@${handle ?? ''}`,
        ifsc: null,
        name: entry.upi.beneficiary_name ?? null,
        bankName: 'UPI',
      };
    }
    const bank = entry?.method === 'bank_account' ? entry.bank_account : null;
    if (bank)
      return {
        account: maskAccountNumber(bank.account_number),
        ifsc: bank.code ?? null,
        name: bank.beneficiary_name ?? null,
        bankName: bank.bank_name ?? null,
      };
    const s = config?.settlements;
    return s
      ? {
          account: maskAccountNumber(s.account_number),
          ifsc: s.ifsc_code,
          name: s.beneficiary_name,
          bankName: s.bank_name || null,
        }
      : null;
  }

  /** The browser never gets a full PAN or account number; the clinic re-enters them on a retry. */
  private static maskDetails(details: Record<string, any>) {
    const pan = (v?: string) => (v ? `${v.slice(0, 5)}••••${v.slice(-1)}` : v);
    const acc = (v?: string) => (v ? `••••${v.slice(-4)}` : v);
    return {
      ...details,
      businessPan: pan(details.businessPan),
      stakeholder: details.stakeholder && {
        ...details.stakeholder,
        pan: pan(details.stakeholder.pan),
        dob: undefined,
      },
      bankDetails: details.bankDetails && {
        ...details.bankDetails,
        accountNumber: acc(details.bankDetails.accountNumber),
      },
    };
  }
}
