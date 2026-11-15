import Razorpay from 'razorpay';
import crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import { envConfig } from './envConfig';
import { HttpError } from '../middlewear/errorHandler';

export const razorpayInstance = new Razorpay({
  key_id: envConfig.RAZORPAY_KEY_ID,
  key_secret: envConfig.RAZORPAY_KEY_SECRET,
});

/**
 * The Razorpay SDK rejects with a plain object (`{ statusCode, error: { code,
 * description } }`) rather than an Error, so an SDK failure would otherwise fall
 * through the global error handler as an opaque 500. This maps it onto HttpError
 * the same way the hand-written axios helpers below already do.
 *
 * Credential/permission failures (401/403) are our misconfiguration, not the
 * caller's, so they surface as 502 — a 401 would wrongly read as "your session
 * expired" to the client.
 */
export const callRazorpaySdk = async <T>(
  context: string,
  fn: () => Promise<T>
): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const statusCode: number | undefined = error?.statusCode;
    if (!statusCode) throw error;

    const description =
      error?.error?.description || error?.message || 'Unknown error';
    const status = statusCode === 401 || statusCode === 403 ? 502 : statusCode;
    const message =
      statusCode === 401 || statusCode === 403
        ? `Payment gateway authentication failed (${context}). Check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.`
        : `${context} failed: ${description}`;

    throw new HttpError(status, message, error?.error);
  }
};

const LIST_PAGE = 100;

/** Every payment or refund on the account in a window (Unix seconds), all pages. */
export const listRazorpayAll = async <T>(
  kind: 'payments' | 'refunds',
  from: number,
  to: number
): Promise<T[]> => {
  const all: T[] = [];
  for (let skip = 0; ; skip += LIST_PAGE) {
    const page = (await callRazorpaySdk(`Razorpay ${kind} list`, () =>
      (
        razorpayInstance[kind] as unknown as {
          all: (q: object) => Promise<{ items?: T[] }>;
        }
      ).all({ from, to, count: LIST_PAGE, skip })
    )) as { items?: T[] };
    const items = page?.items ?? [];
    all.push(...items);
    if (items.length < LIST_PAGE) return all;
  }
};

// ✅ Fixed: Use KEY_SECRET instead of WEBHOOK_SECRET
export const verifyRazorpayPayment = (
  orderId: string,
  paymentId: string,
  signature: string
): boolean => {
  const secret =
    process.env.RAZORPAY_KEY_SECRET || envConfig.RAZORPAY_KEY_SECRET || '';

  if (!secret || !signature) return false;

  const body = orderId + '|' + paymentId;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body.toString())
    .digest('hex');

  const bufExpected = Buffer.from(expectedSignature, 'utf8');
  const bufActual = Buffer.from(signature, 'utf8');
  if (bufExpected.length !== bufActual.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufExpected, bufActual);
};

export const verifyRazorpaySubscriptionPayment = (
  subscriptionId: string,
  paymentId: string,
  signature: string
): boolean => {
  const secret =
    process.env.RAZORPAY_KEY_SECRET || envConfig.RAZORPAY_KEY_SECRET || '';

  if (!secret || !signature) return false;

  const expected1 = crypto
    .createHmac('sha256', secret)
    .update(paymentId + '|' + subscriptionId)
    .digest('hex');

  const expected2 = crypto
    .createHmac('sha256', secret)
    .update(subscriptionId + '|' + paymentId)
    .digest('hex');

  const bufActual = Buffer.from(signature, 'utf8');

  const bufExpected1 = Buffer.from(expected1, 'utf8');
  if (
    bufExpected1.length === bufActual.length &&
    crypto.timingSafeEqual(bufExpected1, bufActual)
  ) {
    return true;
  }

  const bufExpected2 = Buffer.from(expected2, 'utf8');
  if (
    bufExpected2.length === bufActual.length &&
    crypto.timingSafeEqual(bufExpected2, bufActual)
  ) {
    return true;
  }

  return false;
};

export const verifyWebhookSignature = (
  body: string,
  signature?: string,
  secret?: string
): boolean => {
  const effectiveSecret =
    secret ||
    envConfig.RAZORPAY_WEBHOOK_APP_SECRET ||
    envConfig.RAZORPAY_WEBHOOK_SECRET ||
    process.env.RAZORPAY_WEBHOOK_SECRET ||
    process.env.RAZORPAY_WEBHOOK_APP_SECRET;

  if (!signature || !effectiveSecret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', effectiveSecret)
      .update(body)
      .digest('hex');

    const bufExpected = Buffer.from(expectedSignature, 'utf8');
    const bufActual = Buffer.from(signature, 'utf8');
    if (bufExpected.length !== bufActual.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufExpected, bufActual);
  } catch {
    return false;
  }
};

/** Test keys (rzp_test_) mean test mode, where Razorpay refuses UPI payouts to linked accounts. */
export const razorpayUpiPayoutsAvailable = () =>
  !String(envConfig.RAZORPAY_KEY_ID ?? '').startsWith('rzp_test_');

export const UPI_TEST_MODE =
  'UPI payouts work only in live mode. In test mode, use a bank account.';
export const validateRazorpayVpa = async (vpa: string) => {
  if (!envConfig.RAZORPAY_KEY_ID || !envConfig.RAZORPAY_KEY_SECRET) {
    throw HttpError.internal(
      'Razorpay credentials are not configured for VPA validation.'
    );
  }

  try {
    const response = await axios.post(
      'https://api.razorpay.com/v1/payments/validate/vpa',
      {
        vpa,
      },
      {
        auth: {
          username: envConfig.RAZORPAY_KEY_ID,
          password: envConfig.RAZORPAY_KEY_SECRET,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status || 400;
      const description =
        error.response.data?.error?.description ||
        error.response.statusText ||
        error.message;
      throw new HttpError(
        status,
        `Razorpay VPA validation failed: ${description}`,
        error.response.data
      );
    }
    throw error;
  }
};

/**
 * Creates a Razorpay Route linked account for a clinic.
 * Uses Basic Auth headers since the standard SDK might not cover route account creation fully.
 */
export const createRazorpayRouteAccount = async (data: {
  email: string;
  phone: string;
  name: string;
  referenceId: string;
  contactName: string;
  businessType: string;
  businessPan?: string;
  gstin?: string;
  address: {
    street1: string;
    street2: string;
    city: string;
    state: string;
    postalCode: number;
    country: string;
  };
}) => {
  if (!data.referenceId || data.referenceId.length > 20) {
    throw new HttpError(
      400,
      'Razorpay Route reference ID must be between 1 and 20 characters'
    );
  }

  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  const street1 = data.address.street1.normalize('NFKC').trim();
  const street2 = data.address.street2.normalize('NFKC').trim();

  try {
    const response = await axios.post(
      'https://api.razorpay.com/v2/accounts',
      {
        email: data.email,
        phone: data.phone,
        type: 'route',
        reference_id: data.referenceId,
        legal_business_name: data.name,
        business_type: data.businessType,
        ...(data.businessPan || data.gstin
          ? {
              legal_info: {
                ...(data.businessPan ? { pan: data.businessPan } : {}),
                ...(data.gstin ? { gst: data.gstin } : {}),
              },
            }
          : {}),
        contact_name: data.contactName,
        profile: {
          category: 'healthcare',
          subcategory: 'clinic',
          addresses: {
            registered: {
              street1: street1,
              street2: street2,
              city: data.address.city,
              state: data.address.state,
              postal_code: data.address.postalCode,
              country: data.address.country,
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status || 400;
      const description =
        error.response.data?.error?.description ||
        error.response.data?.error?.reason ||
        error.message;
      throw new HttpError(
        status,
        `Razorpay route account creation failed: ${description}`,
        error.response.data
      );
    }
    if (axios.isAxiosError(error)) {
      throw new HttpError(
        502,
        `Razorpay route account creation network error: ${error.message}`
      );
    }
    throw error;
  }
};

/**
 * Creates a split/route order on Razorpay.
 * Sets up transfer of clinicShareAmount to the linked route account, while
 * the remainder automatically stays in the platform's central account as platform fee.
 */
export const createRazorpaySplitOrder = async (
  totalAmount: number,
  routeAccountId: string,
  clinicShareAmount: number,
  appointmentId: string,
  clinicId: string,
  patientId: string
) => {
  const options = {
    amount: Math.round(totalAmount * 100), // convert to paise
    currency: 'INR',
    receipt: `apt_${appointmentId}`,
    payment_capture: 1,
    notes: {
      type: 'appointment_booking',
      appointmentId,
      clinicId,
      patientId,
    },
    transfers: [
      {
        account: routeAccountId,
        amount: Math.round(clinicShareAmount * 100), // convert to paise
        currency: 'INR',
        notes: {
          appointmentId,
        },
        on_hold: false,
      },
    ],
  };
  return await callRazorpaySdk('Razorpay split order creation', () =>
    razorpayInstance.orders.create(options)
  );
};

/**
 * Creates a regular Razorpay order for clinic appointment bookings.
 */
export const createRazorpayAppointmentOrder = async (
  amount: number,
  appointmentId: string,
  clinicId: string,
  patientId: string
) => {
  const options = {
    amount: Math.round(amount * 100), // convert to paise
    currency: 'INR',
    receipt: `apt_${appointmentId}`,
    payment_capture: 1,
    notes: {
      type: 'appointment_booking',
      appointmentId,
      clinicId,
      patientId,
    },
  };
  return await callRazorpaySdk('Razorpay appointment order creation', () =>
    razorpayInstance.orders.create(options)
  );
};

/**
 * Fetches an existing order. Exported so callers get the same HttpError
 * translation as the create helpers instead of a raw SDK rejection.
 */
export const fetchRazorpayOrder = async (orderId: string) =>
  callRazorpaySdk('Razorpay order fetch', () =>
    razorpayInstance.orders.fetch(orderId)
  );

/** One Route transfer: settlement_status and, once paid out, recipient_settlement_id. */
export const fetchRazorpayTransfer = async (transferId: string) =>
  callRazorpaySdk(
    'Razorpay transfer fetch',
    () =>
      razorpayInstance.transfers.fetch(transferId) as unknown as Promise<
        Record<string, unknown>
      >
  );

/** A linked account's settlement (amount, UTR, date), read as that account via X-Razorpay-Account. */
export const fetchRazorpayLinkedSettlement = async (
  accountId: string,
  settlementId: string
) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  const response = await axios.get(
    `https://api.razorpay.com/v1/settlements/${encodeURIComponent(settlementId)}`,
    {
      headers: {
        Authorization: `Basic ${authHeader}`,
        'X-Razorpay-Account': accountId,
      },
    }
  );
  return response.data as Record<string, unknown>;
};

/** One Route linked account by id (reference_id tells whose it is). */
export const fetchRazorpayRouteAccount = async (accountId: string) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  try {
    const response = await axios.get(
      `https://api.razorpay.com/v2/accounts/${encodeURIComponent(accountId)}`,
      { headers: { Authorization: `Basic ${authHeader}` } }
    );
    return response.data as {
      id: string;
      reference_id?: string;
      status?: string;
    };
  } catch (error: any) {
    const description =
      error.response?.data?.error?.description || error.message;
    throw new HttpError(
      error.response?.status || 500,
      `Razorpay account fetch failed: ${description}`
    );
  }
};

/**
 * Fetches the active product configurations (such as settlement bank details) for a Route Linked Account.
 */
export const fetchRazorpayRouteAccountProducts = async (
  accountId: string,
  productId: string
) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  try {
    const response = await axios.get(
      `https://api.razorpay.com/v2/accounts/${accountId}/products/${productId}`,
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    const description =
      error.response?.data?.error?.description || error.message;
    throw new HttpError(
      error.response?.status || 500,
      `Razorpay products fetch failed: ${description}`
    );
  }
};

/**
 * Creates a stakeholder for a Razorpay route sub-account.
 */
export const createRazorpayStakeholder = async (
  accountId: string,
  data: {
    name: string;
    email: string;
    phone: string;
    pan: string;
    relationship?: { director: boolean; executive: boolean };
    percentageOwnership?: number;
    address?: {
      street?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: number | null;
      country?: string | null;
    };
  }
) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  const fullAddress = data.address?.street || 'Clinic Address';

  try {
    const response = await axios.post(
      `https://api.razorpay.com/v2/accounts/${accountId}/stakeholders`,
      {
        name: data.name,
        email: data.email,
        phone: {
          primary: data.phone,
        },
        kyc: {
          pan: data.pan,
        },
        relationship: data.relationship || { executive: true },
        ...(data.percentageOwnership !== undefined
          ? { percentage_ownership: data.percentageOwnership }
          : {}),
        addresses: {
          residential: {
            street: fullAddress.trim() || 'Clinic Address',
            city: data.address?.city || 'City',
            state: data.address?.state || 'State',
            postal_code: String(data.address?.postalCode || 110001),
            country: data.address?.country || 'IN',
          },
        },
      },
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    const description =
      error.response?.data?.error?.description ||
      error.response?.data?.error?.reason ||
      error.message;
    throw new HttpError(
      error.response?.status || 500,
      `Razorpay stakeholder creation failed: ${description}`,
      error.response?.data
    );
  }
};

/**
 * Requests activation for the route product on a Linked Account.
 */
export const requestRazorpayProductConfig = async (
  accountId: string,
  _clientIp: string
) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  try {
    const response = await axios.post(
      `https://api.razorpay.com/v2/accounts/${accountId}/products`,
      {
        product_name: 'route',
        tnc_accepted: true,
        // Razorpay's v2 products API refuses an ip field ("should not be sent"); consent is tnc_accepted.
      },
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    const description =
      error.response?.data?.error?.description || error.message;
    throw new HttpError(
      error.response?.status || 500,
      `Razorpay product request failed: ${description}`
    );
  }
};

/**
 * Updates settlement bank configuration for the Route product.
 */
/** Pays a linked account to a UPI ID; Razorpay verifies it instantly (settlement_accounts, one entry). */
export const updateRazorpayUpiSettlement = async (
  accountId: string,
  productId: string,
  upi: { vpa: string; beneficiaryName: string }
) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  try {
    const response = await axios.patch(
      `https://api.razorpay.com/v2/accounts/${accountId}/products/${productId}`,
      {
        settlement_accounts: [
          {
            method: 'upi',
            upi: {
              vpa: upi.vpa,
              beneficiary_name: upi.beneficiaryName,
              currency: 'INR',
              is_default: true,
            },
          },
        ],
        tnc_accepted: true,
      },
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    const description =
      error.response?.data?.error?.description || error.message;
    throw new HttpError(
      error.response?.status || 500,
      `Razorpay UPI settlement update failed: ${description}`
    );
  }
};

/** Makes a bank account the default payout destination; the documented way to switch away from UPI. */
export const updateRazorpayBankSettlementAccount = async (
  accountId: string,
  productId: string,
  bank: { accountNumber: string; ifscCode: string; beneficiaryName: string }
) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  try {
    const response = await axios.patch(
      `https://api.razorpay.com/v2/accounts/${accountId}/products/${productId}`,
      {
        settlement_accounts: [
          {
            method: 'bank_account',
            bank_account: {
              account_number: bank.accountNumber,
              beneficiary_name: bank.beneficiaryName,
              code_type: 'ifsc',
              code: bank.ifscCode,
              currency: 'INR',
              is_default: true,
            },
          },
        ],
        tnc_accepted: true,
      },
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    const description =
      error.response?.data?.error?.description || error.message;
    throw new HttpError(
      error.response?.status || 500,
      `Razorpay bank settlement update failed: ${description}`
    );
  }
};

export const updateRazorpayProductSettlements = async (
  accountId: string,
  productId: string,
  bankDetails: {
    beneficiaryName: string;
    accountNumber: string;
    ifscCode: string;
    accountType: string;
  }
) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  try {
    const response = await axios.patch(
      `https://api.razorpay.com/v2/accounts/${accountId}/products/${productId}`,
      {
        settlements: {
          account_number: bankDetails.accountNumber,
          ifsc_code: bankDetails.ifscCode,
          beneficiary_name: bankDetails.beneficiaryName,
        },
        tnc_accepted: true,
      },
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    const description =
      error.response?.data?.error?.description || error.message;
    throw new HttpError(
      error.response?.status || 500,
      `Razorpay product settlements update failed: ${description}`
    );
  }
};

/**
 * Fetches all products requested for a route Linked Account.
 */
export const fetchRazorpayRouteAccountAllProducts = async (
  accountId: string,
  _clientIp?: string
) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  try {
    // POST is idempotent: returns the existing route product config if already created
    const response = await axios.post(
      `https://api.razorpay.com/v2/accounts/${accountId}/products`,
      {
        product_name: 'route',
        tnc_accepted: true,
      },
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
      }
    );
    // Return in same shape as before so callers using .items still work
    return { items: [response.data] };
  } catch (error: any) {
    const description =
      error.response?.data?.error?.description || error.message;
    throw new HttpError(
      error.response?.status || 500,
      `Razorpay all products fetch failed: ${description}`
    );
  }
};

/**
 * Maps our internal document type name to the Razorpay KYC document_type value.
 * Razorpay v2 onboarding API uses `document_type` (not `purpose`).
 * Stakeholder docs use personal_pan, aadhar front/back, passport front/back,
 * or voter ID front/back document types.
 * Business document_type values include business_pan_url, gst_certificate,
 * msme_certificate, shop_establishment_certificate, and business_proof_url.
 */
const RAZORPAY_DOCUMENT_TYPE_MAP: Record<string, string> = {
  pan: 'personal_pan',
  personal_pan: 'personal_pan',
  aadhaar_front: 'aadhar_front',
  aadhar_front: 'aadhar_front',
  aadhaar_back: 'aadhar_back',
  aadhar_back: 'aadhar_back',
  passport: 'passport_front',
  passport_front: 'passport_front',
  passport_back: 'passport_back',
  voter_id_front: 'voter_id_front',
  voter_id_back: 'voter_id_back',
  business_pan: 'business_pan_url',
  // Accept Razorpay's generic business-proof value when the caller is
  // resolving a requirement returned by the product configuration API.
  business_proof_url: 'business_proof_url',
  gst: 'gst_certificate',
  gst_certificate: 'gst_certificate',
  cancelled_cheque: 'cancelled_cheque',
  cancel_cheque: 'cancelled_cheque',
  incorporation_certificate: 'business_proof_url',
  partnership_deed: 'business_proof_url',
  llp_agreement: 'business_proof_url',
  board_resolution: 'business_proof_url',
  power_of_attorney: 'business_proof_url',
  moa: 'business_proof_url',
  aoa: 'business_proof_url',
  business_address_proof: 'business_proof_url',
  business_identity_proof: 'business_proof_url',
  msme_certificate: 'msme_certificate',
  shop_establishment_certificate: 'shop_establishment_certificate',
};

const RAZORPAY_DOCUMENT_TYPE_ALIASES: Record<string, string> = {
  pan: 'personal_pan',
  aadhaar_front: 'aadhar_front',
  aadhaar_back: 'aadhar_back',
  passport: 'passport_front',
  cancel_cheque: 'cancelled_cheque',
  gst: 'gst_certificate',
  // Razorpay's API value is also commonly sent back by its requirements API.
  // Normalize it to our user-facing slot so it can be uploaded/replaced.
  business_pan_url: 'business_pan',
};

export const getRazorpayDocumentType = (documentType: string) =>
  RAZORPAY_DOCUMENT_TYPE_MAP[documentType] || null;

export const normalizeRazorpayDocumentType = (docType: string) => {
  if (typeof docType !== 'string' || !docType.trim()) return null;
  const normalized = docType.trim().toLowerCase();
  const canonical = RAZORPAY_DOCUMENT_TYPE_ALIASES[normalized] || normalized;
  return RAZORPAY_DOCUMENT_TYPE_MAP[canonical] ? canonical : null;
};

/**
 * Uploads a verification document to Razorpay for a sub-account or stakeholder.
 */
export const uploadRazorpayDocument = async (
  accountId: string,
  stakeholderId: string | null,
  docType: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
) => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  const razorpayDocumentType = RAZORPAY_DOCUMENT_TYPE_MAP[docType];
  if (!razorpayDocumentType) {
    throw new HttpError(400, `Unsupported KYC document type: ${docType}`);
  }

  const form = new FormData();
  form.append('file', fileBuffer, {
    filename: fileName,
    contentType: mimeType,
  });
  form.append('document_type', razorpayDocumentType);

  const url = stakeholderId
    ? `https://api.razorpay.com/v2/accounts/${accountId}/stakeholders/${stakeholderId}/documents`
    : `https://api.razorpay.com/v2/accounts/${accountId}/documents`;

  try {
    const response = await axios.post(url, form, {
      headers: {
        Authorization: `Basic ${authHeader}`,
        ...form.getHeaders(),
      },
    });
    return response.data;
  } catch (error: any) {
    const description =
      error.response?.data?.error?.description || error.message;
    throw new HttpError(
      error.response?.status || 500,
      `Razorpay document upload failed: ${description}`
    );
  }
};

/** Fetches the KYC document index for an account or one of its stakeholders. */
export const fetchRazorpayRouteDocuments = async (
  accountId: string,
  stakeholderId?: string | null
): Promise<Array<{ type: string; documentId: string }>> => {
  const authHeader = Buffer.from(
    `${envConfig.RAZORPAY_KEY_ID}:${envConfig.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  const url = stakeholderId
    ? `https://api.razorpay.com/v2/accounts/${encodeURIComponent(accountId)}/stakeholders/${encodeURIComponent(stakeholderId)}/documents`
    : `https://api.razorpay.com/v2/accounts/${encodeURIComponent(accountId)}/documents`;

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${authHeader}` },
      timeout: 30000,
    });
    const groups = Array.isArray(response.data)
      ? [response.data]
      : Object.values(response.data || {}).filter(Array.isArray);
    return groups.flatMap((group: any[]) =>
      group.flatMap((item: any) => {
        const documentId = item?.document_id || item?.id;
        return item?.type && documentId
          ? [{ type: String(item.type), documentId: String(documentId) }]
          : [];
      })
    );
  } catch (error: any) {
    const status = error.response?.status || 502;
    const description =
      error.response?.data?.error?.description ||
      error.message ||
      'Could not fetch Razorpay KYC documents';
    throw new HttpError(
      status === 401 || status === 403 ? 502 : status,
      `Razorpay document lookup failed: ${description}`
    );
  }
};
