/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import {
  createRazorpayRouteAccount,
  fetchRazorpayRouteAccount,
  fetchRazorpayRouteAccountProducts,
  createRazorpayStakeholder,
  requestRazorpayProductConfig,
  updateRazorpayProductSettlements,
  updateRazorpayUpiSettlement,
  updateRazorpayBankSettlementAccount,
  validateRazorpayVpa,
  razorpayUpiPayoutsAvailable,
  UPI_TEST_MODE,
  uploadRazorpayDocument,
  fetchRazorpayRouteDocuments,
  getRazorpayDocumentType,
  fetchRazorpayRouteAccountAllProducts,
  normalizeRazorpayDocumentType,
} from '../../../../utils/razorpay';
import { OnboardRouteDto } from '../../../clinic/schemas/clinic.schemas';
import type { PayoutDestinationDto } from '../../schemas/payoutAccount.schemas';
import { database } from '../../../../configurations/dbConnection';
import redisClient from '../../../../configurations/redisConfig';
import { HttpError } from '../../../../middlewear/errorHandler';
import logger from '../../../../utils/logger';
import { ClinicModel } from '../../../clinic/models/clinic.model';
import { ClinicPaymentAccountModel } from '../../../clinic/models/clinicPaymentAccount.model';
import { CacheKeys } from '../../../../utils/cache.util';
import {
  serializeRouteDraft,
  parseRouteDraft,
  destinationFingerprint,
  isPayoutDestinationReason,
  validateRouteKycFile,
  getMissingRazorpayDocuments,
  isRazorpayDocumentRequirementMatch,
  getRequiredDocumentsForBusinessType,
} from '../../utils/payoutAccount.utils';

/** Razorpay Route setup of a clinic's payout account: account, documents, activation, bank change. */
export class PayoutAccountSetupService {
  /** First onboarding stage: creates the Razorpay account and stakeholder, safe to retry from where it stopped. */
  static async onboardRouteAccount(
    clinicId: string,
    data: OnboardRouteDto,
    _clientIp: string
  ) {
    // Fail before any provider-side mutation if the encryption key is absent or invalid.
    let encryptedDraft = serializeRouteDraft(data);
    const [clinic] = await database
      .select({
        id: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        userId: ClinicModel.userId,
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
        routeReferenceId: ClinicPaymentAccountModel.routeReferenceId,
        razorpayStakeholderId: ClinicPaymentAccountModel.gatewayStakeholderId,
        routeStatus: ClinicPaymentAccountModel.routeStatus,
        rejectionReason:
          ClinicPaymentAccountModel.routeOnboardingRejectionReason,
        previousDraft: ClinicPaymentAccountModel.onboardingDraftData,
      })
      .from(ClinicModel)
      .leftJoin(
        ClinicPaymentAccountModel,
        and(
          eq(ClinicModel.id, ClinicPaymentAccountModel.clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);

    if (!clinic) throw new HttpError(404, 'Clinic not found');
    if (clinic.razorpayAccountId && clinic.routeStatus === 'ACTIVE') {
      throw new HttpError(400, 'Clinic is already active on Razorpay Route');
    }

    // Checked before this submit overwrites the status: resending details Razorpay already
    // failed uses up one of its few bank checks, then it locks the account.
    let lastSent: string | undefined;
    try {
      lastSent = clinic.previousDraft
        ? parseRouteDraft(clinic.previousDraft).lastSentDestination
        : undefined;
    } catch {
      lastSent = undefined;
    }
    if (
      lastSent &&
      lastSent === destinationFingerprint(data) &&
      ['DRAFT', 'NEEDS_CLARIFICATION', 'REJECTED'].includes(
        clinic.routeStatus ?? ''
      ) &&
      isPayoutDestinationReason(clinic.rejectionReason)
    ) {
      throw new HttpError(
        422,
        "Razorpay couldn't verify these payout details. Enter a different bank account or a UPI ID.",
        {
          code: 'SAME_FAILED_DESTINATION',
          retryable: false,
          field: 'payoutDestination',
        }
      );
    }
    if (lastSent)
      encryptedDraft = serializeRouteDraft({
        ...data,
        lastSentDestination: lastSent,
      });

    let accountId = clinic.razorpayAccountId;
    let stakeholderId = clinic.razorpayStakeholderId;

    // 1. Create Base Account if not already created
    if (!accountId) {
      // Razorpay's linked-account reference code is limited to 20 characters.
      // Persist it before the provider call so retries use the same reference.
      let routeReferenceId = clinic.routeReferenceId;
      if (!routeReferenceId) {
        const candidateReferenceId = randomBytes(10).toString('hex');
        const [paymentAccount] = await database
          .insert(ClinicPaymentAccountModel)
          .values({
            clinicId,
            paymentProvider: 'razorpay',
            routeReferenceId: candidateReferenceId,
            routeStatus: 'DRAFT',
            onboardingDraftData: encryptedDraft,
          })
          .onConflictDoUpdate({
            target: [
              ClinicPaymentAccountModel.clinicId,
              ClinicPaymentAccountModel.paymentProvider,
            ],
            set: {
              routeReferenceId: sql`COALESCE(${ClinicPaymentAccountModel.routeReferenceId}, ${candidateReferenceId})`,
              onboardingDraftData: encryptedDraft,
              updatedAt: new Date(),
            },
          })
          .returning({
            routeReferenceId: ClinicPaymentAccountModel.routeReferenceId,
          });
        routeReferenceId = paymentAccount?.routeReferenceId ?? null;
      }
      if (!routeReferenceId) {
        throw new HttpError(
          500,
          'Could not prepare Razorpay account reference'
        );
      }

      let razorpayAccount: any;
      try {
        razorpayAccount = await createRazorpayRouteAccount({
          email: data.stakeholder.email,
          phone: data.stakeholder.phone,
          name: data.legalBusinessName,
          referenceId: routeReferenceId,
          contactName: data.stakeholder.name,
          businessType:
            data.businessType === 'proprietorship'
              ? 'individual'
              : data.businessType,
          // Razorpay refuses a company PAN on an individual account; the owner's PAN goes on the stakeholder.
          businessPan:
            data.businessType === 'proprietorship' ||
            data.businessType === 'individual'
              ? undefined
              : data.businessPan,
          gstin: data.gstin,
          address: {
            street1: data.address.street1,
            street2: data.address.street2,
            city: data.address.city,
            state: data.address.state,
            postalCode: data.address.postalCode,
            country: 'IN',
          },
        });
        accountId = razorpayAccount.id;
      } catch (error: any) {
        const provider = error?.details?.error;
        // An earlier attempt may have created this clinic's account before our save; reuse it if it is ours.
        accountId = await this.ownAccountForTakenEmail(
          provider,
          routeReferenceId
        );
        if (accountId) {
          logger.info(
            '[Route] Reused the linked account from an earlier attempt',
            { clinicId }
          );
        } else {
          // A 400 is bad input: Razorpay's own sentence tells the clinic what to fix (it never echoes PAN).
          const badInput = error?.status === 400 && provider?.description;
          const failureReason =
            provider?.field === 'email'
              ? 'This email is already used by another Razorpay account. Use a different email for the owner.'
              : badInput
                ? `Razorpay: ${provider.description}`
                : 'We could not create your linked account. Please review the business details and try again.';
          logger.error('[Route] Linked-account creation failed', {
            clinicId,
            errorType: error?.name || 'UnknownError',
            providerStatus: error?.status,
            providerReason: provider?.description,
            providerField: provider?.field,
          });
          await database
            .update(ClinicPaymentAccountModel)
            .set({
              routeOnboardingRejectionReason: failureReason,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(ClinicPaymentAccountModel.clinicId, clinicId),
                eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
              )
            );
          throw badInput
            ? new HttpError(422, failureReason, {
                code: 'LINKED_ACCOUNT_DETAILS_REJECTED',
                field: provider.field,
                retryable: false,
              })
            : new HttpError(
                502,
                'We could not create your linked account. Check your details and try again.',
                { code: 'LINKED_ACCOUNT_CREATION_FAILED', retryable: true }
              );
        }
      }

      await database
        .insert(ClinicPaymentAccountModel)
        .values({
          clinicId,
          paymentProvider: 'razorpay',
          gatewayAccountId: accountId,
          routeStatus: 'DRAFT',
          routeOnboardingRejectionReason: null,
          onboardingDraftData: encryptedDraft,
        })
        .onConflictDoUpdate({
          target: [
            ClinicPaymentAccountModel.clinicId,
            ClinicPaymentAccountModel.paymentProvider,
          ],
          set: {
            gatewayAccountId: accountId,
            routeStatus: 'DRAFT',
            routeOnboardingRejectionReason: null,
            onboardingDraftData: encryptedDraft,
            updatedAt: new Date(),
          },
        });
    }

    // 2. Create Stakeholder if not already created
    if (accountId && !stakeholderId) {
      try {
        const stakeholder = await createRazorpayStakeholder(accountId, {
          name: data.stakeholder.name,
          email: data.stakeholder.email,
          phone: data.stakeholder.phone,
          pan: data.stakeholder.pan,
          relationship: data.stakeholder.relationship,
          percentageOwnership: data.stakeholder.percentageOwnership,
          address: {
            street: `${data.address.street1}, ${data.address.street2}`,
            city: data.address.city,
            state: data.address.state,
            postalCode: data.address.postalCode,
            country: 'IN',
          },
        });
        stakeholderId = stakeholder.id;
        // Persist each successful provider step before starting the next one.
        await database
          .update(ClinicPaymentAccountModel)
          .set({
            gatewayStakeholderId: stakeholderId,
            routeOnboardingRejectionReason: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ClinicPaymentAccountModel.clinicId, clinicId),
              eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
            )
          );
      } catch (error: any) {
        const failureReason =
          'We could not verify the authorized stakeholder details. Please review them and try again.';
        logger.error('[Route] Stakeholder creation failed', {
          clinicId,
          errorType: error?.name || 'UnknownError',
          providerStatus: error?.status,
          providerReason: error?.details?.error?.description ?? error?.message,
        });
        await database
          .update(ClinicPaymentAccountModel)
          .set({
            routeOnboardingRejectionReason: failureReason,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ClinicPaymentAccountModel.clinicId, clinicId),
              eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
            )
          );
        throw new HttpError(
          502,
          'We could not verify the authorized stakeholder details. Review them and try again.',
          { code: 'STAKEHOLDER_CREATION_FAILED', retryable: true }
        );
      }
    }

    if (!accountId || !stakeholderId) {
      throw new HttpError(
        500,
        'Razorpay account or stakeholder configuration failed'
      );
    }

    // 3. Update/Upsert the ClinicPaymentAccountModel
    const [existingAccount] = await database
      .select({ id: ClinicPaymentAccountModel.id })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (existingAccount) {
      await database
        .update(ClinicPaymentAccountModel)
        .set({
          gatewayAccountId: accountId,
          gatewayStakeholderId: stakeholderId,
          routeStatus: 'DRAFT',
          routeOnboardingRejectionReason: null,
          onboardingDraftData: encryptedDraft,
          updatedAt: new Date(),
        })
        .where(eq(ClinicPaymentAccountModel.id, existingAccount.id));
    } else {
      await database.insert(ClinicPaymentAccountModel).values({
        clinicId,
        paymentProvider: 'razorpay',
        gatewayAccountId: accountId,
        gatewayStakeholderId: stakeholderId,
        routeStatus: 'DRAFT',
        routeOnboardingRejectionReason: null,
        onboardingDraftData: encryptedDraft,
      });
    }

    try {
      await redisClient.del(CacheKeys.clinicDetails(clinicId));
    } catch (err) {
      logger.error(
        `[Cache] Error invalidating clinic details cache in onboardRouteAccount for clinic ${clinicId}:`,
        err
      );
    }

    return {
      ...clinic,
      razorpayAccountId: accountId,
      razorpayStakeholderId: stakeholderId,
      routeStatus: 'DRAFT',
      rejectionIssues: [],
      requiredDocuments: getRequiredDocumentsForBusinessType(data.businessType),
      uploadedDocuments: [],
    };
  }

  /** Last onboarding stage: requests the Route product and sets the bank for settlements. */
  static async activateRouteAccount(clinicId: string, clientIp: string) {
    const [clinic] = await database
      .select({
        id: ClinicPaymentAccountModel.id,
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
        razorpayStakeholderId: ClinicPaymentAccountModel.gatewayStakeholderId,
        razorpayProductId: ClinicPaymentAccountModel.routeProductId,
        onboardingDraftData: ClinicPaymentAccountModel.onboardingDraftData,
        routeStatus: ClinicPaymentAccountModel.routeStatus,
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
      throw new HttpError(
        404,
        'Clinic has not initiated Route onboarding details'
      );
    }
    if (!clinic.razorpayAccountId) {
      throw new HttpError(400, 'Razorpay account has not been created yet');
    }
    if (clinic.routeStatus === 'ACTIVE') {
      throw new HttpError(400, 'Clinic is already active on Razorpay Route');
    }
    if (!clinic.onboardingDraftData) {
      throw new HttpError(400, 'No onboarding details found to activate');
    }
    if (!clinic.razorpayStakeholderId) {
      throw new HttpError(400, 'Razorpay stakeholder has not been created');
    }

    let parsedDraft: any;
    try {
      parsedDraft = parseRouteDraft(clinic.onboardingDraftData);
    } catch {
      throw new HttpError(400, 'Invalid onboarding details data');
    }

    if (!parsedDraft.bankDetails && !parsedDraft.upi?.vpa) {
      throw new HttpError(
        400,
        'A bank account or UPI ID is required to activate Route onboarding'
      );
    }
    if (!parsedDraft.tncAccepted) {
      throw new HttpError(400, 'Terms and conditions must be accepted');
    }
    const accountId = clinic.razorpayAccountId;

    // 1. Request Route product config
    let productId = clinic.razorpayProductId;
    let productConfig: any = null;
    try {
      if (!productId) {
        const productsRes = await fetchRazorpayRouteAccountAllProducts(
          accountId,
          clientIp
        );
        const products = productsRes?.items || [];
        const routeProduct = products.find(
          (p: any) => p.product_name === 'route'
        );
        productId = routeProduct?.id;
        productConfig = routeProduct || null;
      }

      if (!productId) {
        productConfig = await requestRazorpayProductConfig(accountId, clientIp);
        productId = productConfig.id;
      }
    } catch (error) {
      const message =
        'We could not submit your account for verification. Your details are saved; please try again later.';
      await this.persistRouteFailure(clinicId, message, error);
      throw new HttpError(502, message, {
        code: 'ROUTE_SUBMISSION_FAILED',
        retryable: true,
      });
    }

    if (!productId) {
      throw new HttpError(
        500,
        'Razorpay product activation configuration failed'
      );
    }

    await database
      .update(ClinicPaymentAccountModel)
      .set({ routeProductId: productId, updatedAt: new Date() })
      .where(eq(ClinicPaymentAccountModel.id, clinic.id));

    // Razorpay's product requirements are account-specific. Avoid imposing a
    // guessed document checklist by legal form; evaluate the live requirements.
    try {
      productConfig = await fetchRazorpayRouteAccountProducts(
        accountId,
        productId
      );
    } catch (error) {
      const message =
        'We could not verify the account requirements. Your details are saved; please try again later.';
      await this.persistRouteFailure(clinicId, message, error);
      throw new HttpError(502, message, {
        code: 'ROUTE_REQUIREMENTS_UNAVAILABLE',
        retryable: true,
      });
    }
    const uploadedDocumentTypes = Array.isArray(parsedDraft.uploadedDocuments)
      ? parsedDraft.uploadedDocuments
          .filter((item: any) => item.status !== 'pending_sync')
          .map((item: any) => item.documentType)
      : [];
    const missingDocuments = getMissingRazorpayDocuments(
      Array.isArray(productConfig?.requirements)
        ? productConfig.requirements
        : [],
      uploadedDocumentTypes
    );
    if (missingDocuments.length > 0) {
      throw new HttpError(
        400,
        `Please upload the required verification documents: ${missingDocuments.join(', ')}.`,
        {
          code: 'KYC_DOCUMENTS_REQUIRED',
          retryable: false,
          issues: missingDocuments.map((documentType: string) => ({
            fieldPath: null,
            documentType,
            message: `Please upload the required ${documentType.replace(/_/g, ' ')} document.`,
          })),
        }
      );
    }

    // 2. Where payouts go: the UPI ID if one was given, else the bank account.
    const fingerprint = destinationFingerprint(parsedDraft);
    // Every send counts against Razorpay's bank checks, so it is recorded before the call (fingerprint only).
    if (fingerprint)
      await this.saveOnboardingDraft(clinicId, {
        ...parsedDraft,
        lastSentDestination: fingerprint,
      });
    try {
      if (parsedDraft.upi?.vpa)
        await updateRazorpayUpiSettlement(
          accountId,
          productId,
          parsedDraft.upi
        );
      else
        await updateRazorpayProductSettlements(accountId, productId, {
          beneficiaryName: parsedDraft.bankDetails.beneficiaryName,
          accountNumber: parsedDraft.bankDetails.accountNumber,
          ifscCode: parsedDraft.bankDetails.ifscCode,
          accountType: parsedDraft.bankDetails.accountType,
        });
    } catch (error) {
      const isProviderValidationError =
        error instanceof HttpError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429;
      const message = isProviderValidationError
        ? parsedDraft.upi?.vpa
          ? 'Razorpay could not verify the UPI ID. Check it is active in your UPI app and the name matches it.'
          : 'Razorpay could not verify the settlement bank details. Check the account holder name, account number, and IFSC code.'
        : 'Bank verification is temporarily unavailable. Your details are saved; please try again later.';
      await this.persistRouteFailure(clinicId, message, error);
      throw new HttpError(isProviderValidationError ? 422 : 502, message, {
        code: 'SETTLEMENT_DETAILS_REJECTED',
        retryable: !isProviderValidationError,
        issues: [
          {
            fieldPath: null,
            documentType: null,
            message,
          },
        ],
      });
    }

    // 3. Transition status to PENDING
    await database
      .update(ClinicPaymentAccountModel)
      .set({
        routeStatus: 'PENDING',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      );

    try {
      await redisClient.del(CacheKeys.clinicDetails(clinicId));
    } catch (err) {
      logger.error(
        `[Cache] Error invalidating clinic details cache in activateRouteAccount for clinic ${clinicId}:`,
        err
      );
    }

    return {
      accountId,
      routeStatus: 'PENDING',
    };
  }

  /**
   * Uploads KYC verification documents for sub-merchant onboarding.
   */
  static async uploadKYCDocuments(
    clinicId: string,
    documentType: string,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string
  ) {
    const normalizedDocumentType = normalizeRazorpayDocumentType(documentType);
    if (!normalizedDocumentType) {
      throw new HttpError(
        400,
        `Unsupported KYC document type: ${documentType}`
      );
    }
    const validatedMimeType = await validateRouteKycFile(
      normalizedDocumentType,
      fileBuffer,
      fileName,
      mimeType
    );
    const [clinic] = await database
      .select({
        id: ClinicPaymentAccountModel.id,
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
        razorpayStakeholderId: ClinicPaymentAccountModel.gatewayStakeholderId,
        razorpayProductId: ClinicPaymentAccountModel.routeProductId,
        routeStatus: ClinicPaymentAccountModel.routeStatus,
      })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (!clinic) throw new HttpError(404, 'Clinic not found');
    if (!clinic.razorpayAccountId) {
      throw new HttpError(
        400,
        'Razorpay linked account has not been created yet. Please complete and submit the business details step first.'
      );
    }

    if (clinic.routeStatus === 'PENDING' && !clinic.razorpayProductId) {
      throw new HttpError(
        409,
        'Razorpay product status is unavailable; document updates are paused until its state can be confirmed'
      );
    }
    let productConfig: any = null;
    if (clinic.razorpayProductId) {
      productConfig = await fetchRazorpayRouteAccountProducts(
        clinic.razorpayAccountId,
        clinic.razorpayProductId
      );
    }
    await this.assertRazorpayDocumentUpdateAllowed(
      clinic.routeStatus,
      productConfig,
      normalizedDocumentType
    );

    // personal documents (e.g. pan, passport, aadhaar) need stakeholder association
    const isStakeholderDoc = [
      'pan',
      'personal_pan',
      'passport',
      'passport_front',
      'passport_back',
      'aadhaar_front',
      'aadhaar_back',
      'aadhar_front',
      'aadhar_back',
      'voter_id_front',
      'voter_id_back',
    ].includes(normalizedDocumentType);
    const stakeholderId = isStakeholderDoc
      ? clinic.razorpayStakeholderId
      : null;
    if (isStakeholderDoc && !stakeholderId) {
      throw new HttpError(
        400,
        'Stakeholder must be created before uploading personal KYC documents'
      );
    }

    const [paymentAccount] = await database
      .select({
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
    const draft = this.parseOnboardingDraft(
      paymentAccount?.onboardingDraftData
    );
    const uploadedDocuments = Array.isArray(draft.uploadedDocuments)
      ? draft.uploadedDocuments
      : [];
    let docUploadRes: any;
    try {
      docUploadRes = await uploadRazorpayDocument(
        clinic.razorpayAccountId,
        stakeholderId,
        normalizedDocumentType,
        fileBuffer,
        fileName,
        validatedMimeType
      );
    } catch (error) {
      logger.error('[Route] KYC document upload failed', {
        clinicId,
        documentType: normalizedDocumentType,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        providerStatus: error instanceof HttpError ? error.status : undefined,
      });
      throw new HttpError(
        502,
        `We could not upload the ${normalizedDocumentType.replace(/_/g, ' ')} document. Check the file and try again.`,
        {
          code: 'KYC_DOCUMENT_UPLOAD_FAILED',
          retryable: true,
          issues: [
            {
              fieldPath: null,
              documentType: normalizedDocumentType,
              message: `Upload failed. Please check the ${normalizedDocumentType.replace(/_/g, ' ')} file and try again.`,
            },
          ],
        }
      );
    }

    let providerDocumentId = this.getRazorpayDocumentId(docUploadRes);
    if (!providerDocumentId) {
      try {
        const providerType = getRazorpayDocumentType(normalizedDocumentType);
        const remoteDocuments = await fetchRazorpayRouteDocuments(
          clinic.razorpayAccountId,
          stakeholderId
        );
        providerDocumentId =
          remoteDocuments.filter((item) => item.type === providerType).pop()
            ?.documentId || null;
      } catch (error) {
        // The upload succeeded. Keep its state; preview can resolve the document
        // ID from Razorpay's document list when the provider API is available.
        logger.warn('[Razorpay KYC] Could not resolve uploaded document ID', {
          clinicId,
          documentType: normalizedDocumentType,
          error,
        });
      }
    }

    draft.uploadedDocuments = [
      ...uploadedDocuments.filter(
        (item: any) => item.documentType !== normalizedDocumentType
      ),
      {
        documentType: normalizedDocumentType,
        providerDocumentId,
        fileName: fileName.replace(/[\\/]/g, '_').slice(0, 180),
        status: 'uploaded',
        uploadedAt: new Date().toISOString(),
      },
    ];
    await this.saveOnboardingDraft(clinicId, draft);

    return { documentType: normalizedDocumentType, status: 'uploaded' };
  }

  /** The saved form draft, decrypted; empty when none was saved yet. */
  private static parseOnboardingDraft(
    value?: string | null
  ): Record<string, any> {
    if (!value) return {};
    try {
      return parseRouteDraft(value);
    } catch {
      return {};
    }
  }

  /** Keeps the encrypted form draft so a retry continues where the clinic left off. */
  private static async saveOnboardingDraft(
    clinicId: string,
    draft: Record<string, any>
  ) {
    await database
      .update(ClinicPaymentAccountModel)
      .set({
        onboardingDraftData: serializeRouteDraft(draft),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      );
  }

  /** Razorpay returns the document id under different keys per document type. */
  private static getRazorpayDocumentId(response: any): string | null {
    if (response?.document_id || response?.id)
      return response.document_id || response.id;
    const groups = Array.isArray(response)
      ? [response]
      : Object.values(response || {});
    for (const group of groups) {
      if (Array.isArray(group)) {
        const match = group.find((item: any) => item?.document_id || item?.id);
        if (match) return match.document_id || match.id || null;
      }
    }
    return null;
  }

  /** Moves payouts to a new UPI ID or bank account after setup; Razorpay re-verifies it. */
  static async updateSettlementBank(
    clinicId: string,
    destination: PayoutDestinationDto,
    clientIp: string
  ) {
    // A UPI ID is checked before anything is sent, so a wrong one changes nothing.
    if (destination.method === 'upi' && !razorpayUpiPayoutsAvailable())
      throw new HttpError(422, UPI_TEST_MODE);
    if (destination.method === 'upi') {
      const check = await validateRazorpayVpa(destination.upi.vpa).catch(
        () => null
      );
      if (!check?.success)
        throw new HttpError(
          422,
          'This UPI ID could not be verified. Check it and try again.'
        );
    }
    const [clinic] = await database
      .select({
        id: ClinicPaymentAccountModel.id,
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
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

    if (!clinic) throw new HttpError(404, 'Clinic payment profile not found');
    if (!clinic.razorpayAccountId) {
      throw new HttpError(
        400,
        'Razorpay linked account has not been created yet. Please complete and submit the business details step first.'
      );
    }

    const accountId = clinic.razorpayAccountId;

    // Resolve target Route product ID dynamically
    const productsRes = await fetchRazorpayRouteAccountAllProducts(
      accountId,
      clientIp
    );
    const products = productsRes?.items || [];
    const routeProduct = products.find((p: any) => p.product_name === 'route');

    if (!routeProduct) {
      throw new HttpError(
        400,
        'Route product configuration not found on Razorpay sub-account'
      );
    }

    const productId = routeProduct.id;

    // settlement_accounts is Razorpay's documented switch between UPI and bank (one default entry).
    if (destination.method === 'upi')
      await updateRazorpayUpiSettlement(accountId, productId, destination.upi);
    else
      await updateRazorpayBankSettlementAccount(
        accountId,
        productId,
        destination.bank
      );

    // Only a setup still in progress keeps a draft (so a retry sends this destination); never create one.
    let updatedDraft: string | null = null;
    if (clinic.onboardingDraftData) {
      try {
        const parsed = parseRouteDraft(clinic.onboardingDraftData);
        if (destination.method === 'upi') {
          parsed.upi = destination.upi;
          delete parsed.bankDetails;
        } else {
          parsed.bankDetails = destination.bank;
          delete parsed.upi;
        }
        updatedDraft = serializeRouteDraft(parsed);
      } catch {
        updatedDraft = null;
      }
    }

    // Set local routeStatus back to PENDING while Razorpay runs penny verification
    const [updatedClinic] = await database
      .update(ClinicPaymentAccountModel)
      .set({
        routeStatus: 'PENDING',
        routeOnboardingRejectionReason: null,
        onboardingDraftData: updatedDraft,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .returning();

    try {
      await redisClient.del(CacheKeys.clinicDetails(clinicId));
    } catch (err) {
      logger.error(
        `[Cache] Error invalidating clinic details cache in updateSettlementBank for clinic ${clinicId}:`,
        err
      );
    }

    return updatedClinic;
  }

  /** Keeps the provider failure on the account so the clinic sees why setup stopped. */
  private static async persistRouteFailure(
    clinicId: string,
    userMessage: string,
    error: unknown
  ) {
    logger.error('[Route] Provider operation failed', {
      clinicId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      providerStatus: error instanceof HttpError ? error.status : undefined,
      // Razorpay's own sentence (helpers put it in the message); it never echoes PAN or account numbers.
      providerMessage: error instanceof Error ? error.message : undefined,
    });
    try {
      await database
        .update(ClinicPaymentAccountModel)
        .set({
          routeOnboardingRejectionReason: userMessage,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ClinicPaymentAccountModel.clinicId, clinicId),
            eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
          )
        );
    } catch (persistError) {
      logger.error('[Route] Could not persist provider failure', {
        clinicId,
        errorType:
          persistError instanceof Error ? persistError.name : 'UnknownError',
      });
    }
  }

  /** "Email already exists for account - X": X is ours only if its reference_id is this clinic's; else null. */
  private static async ownAccountForTakenEmail(
    provider: { field?: string; description?: string } | undefined,
    routeReferenceId: string
  ): Promise<string | null> {
    const id = /already exists for account\s*-\s*(\w+)/i.exec(
      provider?.description ?? ''
    )?.[1];
    if (provider?.field !== 'email' || !id) return null;
    try {
      const account = await fetchRazorpayRouteAccount(
        id.startsWith('acc_') ? id : `acc_${id}`
      );
      return account.reference_id === routeReferenceId ? account.id : null;
    } catch {
      return null;
    }
  }

  /** Razorpay refuses document changes under review or active, and in clarification only for the asked field. */
  private static async assertRazorpayDocumentUpdateAllowed(
    routeStatus: string,
    productConfig: any,
    documentType: string
  ) {
    const activationStatus = String(
      productConfig?.activation_status || ''
    ).toLowerCase();
    if (
      ['under_review', 'activated', 'suspended'].includes(activationStatus) ||
      ['ACTIVE', 'SUSPENDED', 'REJECTED'].includes(routeStatus)
    ) {
      throw new HttpError(
        409,
        'Razorpay does not allow document changes while this account is under review or active'
      );
    }

    if (
      activationStatus !== 'needs_clarification' &&
      routeStatus !== 'NEEDS_CLARIFICATION'
    ) {
      return;
    }

    const requirements = Array.isArray(productConfig?.requirements)
      ? productConfig.requirements
      : [];
    if (!requirements.length) {
      throw new HttpError(
        409,
        'Razorpay has not provided the clarification field yet; document changes are paused until it can be confirmed'
      );
    }
    const fieldClarifications = requirements.filter(
      (item: any) => item.reason_code === 'needs_clarification'
    );
    if (
      fieldClarifications.length > 0 &&
      !fieldClarifications.some((item: any) =>
        isRazorpayDocumentRequirementMatch(documentType, item)
      )
    ) {
      throw new HttpError(
        409,
        'Razorpay requested clarification for a different field; this document cannot be changed yet'
      );
    }
  }
}
