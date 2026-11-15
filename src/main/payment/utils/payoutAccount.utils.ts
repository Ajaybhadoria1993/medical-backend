/* eslint-disable @typescript-eslint/no-explicit-any */
/** Pure rules of Razorpay Route onboarding: draft encryption, required documents, rejection reasons. */
import { normalizeRazorpayDocumentType } from '../../../utils/razorpay';
import { HttpError } from '../../../middlewear/errorHandler';
import { decrypt, encrypt } from '../../../utils/mfaCrypto';
import { createHash } from 'crypto';
import { extname } from 'path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

export const ROUTE_DRAFT_ENCRYPTED_PREFIX = 'enc:v1:';

/** One-way fingerprint of where payouts go, so a resend of the same details is spotted without keeping them. */
export const destinationFingerprint = (draft: any): string | null => {
  const key = draft?.upi?.vpa
    ? `upi:${String(draft.upi.vpa).toLowerCase()}`
    : draft?.bankDetails?.accountNumber
      ? `bank:${String(draft.bankDetails.accountNumber).replace(/\s+/g, '')}:${String(draft.bankDetails.ifscCode ?? '').toUpperCase()}`
      : null;
  return key
    ? createHash('sha256').update(key).digest('hex').slice(0, 24)
    : null;
};

/** Razorpay's reason is about the bank or UPI details (not KYC or business details). */
export const isPayoutDestinationReason = (reason?: string | null) =>
  !!reason && /bank|ifsc|account (number|holder)|upi|vpa|penny/i.test(reason);

// One sentence for the lock, kept with the card (it rewrites old saved wording there).
export { BANK_CHECKS_LOCKED } from './payoutAccountCard.utils';

// Payout drafts have their own key, so they never depend on MFA settings; unset falls back to the MFA key.
const PAYOUT_KEY = 'PAYOUT_ENCRYPTION_KEY';
const payoutKey = () =>
  process.env[PAYOUT_KEY] ? PAYOUT_KEY : 'MFA_ENCRYPTION_KEY';

export const serializeRouteDraft = (draft: unknown) =>
  `${ROUTE_DRAFT_ENCRYPTED_PREFIX}${encrypt(JSON.stringify(draft), payoutKey())}`;

/** Drafts saved before the payout key existed were sealed with the MFA key, so that is tried next. */
const decryptDraft = (sealed: string) => {
  try {
    return decrypt(sealed, payoutKey());
  } catch (error) {
    if (payoutKey() === 'MFA_ENCRYPTION_KEY') throw error;
    return decrypt(sealed, 'MFA_ENCRYPTION_KEY');
  }
};

export const parseRouteDraft = (value: string) => {
  const serialized = value.startsWith(ROUTE_DRAFT_ENCRYPTED_PREFIX)
    ? decryptDraft(value.slice(ROUTE_DRAFT_ENCRYPTED_PREFIX.length))
    : value; // Legacy plaintext drafts are read for migration on the next save.
  return JSON.parse(serialized);
};

export const validateRouteKycFile = async (
  documentType: string,
  fileBuffer: Buffer,
  fileName: string,
  suppliedMimeType: string
) => {
  if (fileBuffer.length === 0) {
    throw new HttpError(400, 'Document file is empty');
  }

  const extension = extname(fileName).toLowerCase();
  const mimeType = suppliedMimeType.toLowerCase().split(';')[0].trim();
  const allowed = {
    '.jpg': {
      mimeTypes: ['image/jpeg', 'image/jpg'],
      canonicalMime: 'image/jpeg',
    },
    '.jpeg': {
      mimeTypes: ['image/jpeg', 'image/jpg'],
      canonicalMime: 'image/jpeg',
    },
    '.png': { mimeTypes: ['image/png'], canonicalMime: 'image/png' },
    '.pdf': {
      mimeTypes: ['application/pdf'],
      canonicalMime: 'application/pdf',
    },
  } as const;
  const expected = allowed[extension as keyof typeof allowed];
  if (!expected || !expected.mimeTypes.includes(mimeType as never)) {
    throw new HttpError(
      400,
      'Only matching JPG, JPEG, PNG, or PDF files are accepted'
    );
  }

  const isPdf = extension === '.pdf';
  const maxSize = isPdf ? 2 * 1024 * 1024 : 4 * 1024 * 1024;
  if (fileBuffer.length > maxSize) {
    throw new HttpError(
      413,
      isPdf
        ? 'PDF documents cannot exceed 2 MB'
        : 'Image documents cannot exceed 4 MB'
    );
  }

  if (isPdf) {
    if (!fileBuffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
      throw new HttpError(400, 'The uploaded file is not a valid PDF');
    }
    try {
      const pdf = await PDFDocument.load(fileBuffer, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
      const pageCount = pdf.getPageCount();
      if (pageCount < 1) throw new Error('PDF has no pages');
      // ID and cheque slots are one page (front and back are separate types in Razorpay);
      // business proof may run longer, capped at 25 pages to bound the work.
      const maxPages = new Set([
        'personal_pan',
        'aadhar_front',
        'aadhar_back',
        'passport_front',
        'passport_back',
        'voter_id_front',
        'voter_id_back',
        'cancelled_cheque',
      ]).has(documentType)
        ? 1
        : 25;
      if (pageCount > maxPages) {
        throw new HttpError(
          400,
          `This document type allows at most ${maxPages} PDF pages`
        );
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        400,
        'The uploaded PDF is corrupted, encrypted, or unreadable'
      );
    }
  } else {
    const isJpeg = extension === '.jpg' || extension === '.jpeg';
    const hasJpegMagic =
      fileBuffer.length >= 3 &&
      fileBuffer[0] === 0xff &&
      fileBuffer[1] === 0xd8 &&
      fileBuffer[2] === 0xff;
    const hasPngMagic = fileBuffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if ((isJpeg && !hasJpegMagic) || (!isJpeg && !hasPngMagic)) {
      throw new HttpError(
        400,
        'The file extension does not match the image contents'
      );
    }
    try {
      await sharp(fileBuffer, { failOn: 'error' }).stats();
    } catch {
      throw new HttpError(400, 'The uploaded image is corrupted or unreadable');
    }
  }

  return expected.canonicalMime;
};

export const getMissingRazorpayDocuments = (
  requirements: any[],
  documentTypes: string[]
) => {
  const uploaded = new Set(
    documentTypes.map((type) => normalizeRazorpayDocumentType(type) || type)
  );
  const missing: string[] = [];
  const addressGroups = [
    ['aadhar_front', 'aadhar_back'],
    ['passport_front', 'passport_back'],
    ['voter_id_front', 'voter_id_back'],
  ];
  const businessTypes = [
    'business_pan',
    'business_proof_url',
    'gst_certificate',
    'msme_certificate',
    'shop_establishment_certificate',
    'incorporation_certificate',
    'partnership_deed',
    'llp_agreement',
    'board_resolution',
    'power_of_attorney',
    'moa',
    'aoa',
    'business_address_proof',
    'business_identity_proof',
  ];
  const hasRequiredType = (type: string) => {
    if (uploaded.has(type)) return true;
    if (type === 'business_proof_url') {
      return businessTypes.some((businessType) => uploaded.has(businessType));
    }
    return false;
  };
  const hasAddressGroup = addressGroups.some((group) =>
    group.every((type) => uploaded.has(type))
  );

  for (const requirement of requirements) {
    if (requirement.status && requirement.status !== 'required') continue;
    const reference = String(requirement.field_reference || '').toLowerCase();
    if (!reference) continue;
    const parts = reference.split('.');
    const rawType = parts.length > 1 ? parts[parts.length - 1] : reference;

    if (reference === 'individual_proof_of_address') {
      if (!hasAddressGroup)
        missing.push('one complete stakeholder address proof pair');
      continue;
    }
    if (reference === 'individual_proof_of_identification') {
      if (!uploaded.has('personal_pan')) missing.push('personal PAN');
      continue;
    }
    if (reference === 'business_proof_of_identification') {
      if (!businessTypes.some((type) => uploaded.has(type))) {
        missing.push('a business proof requested by Razorpay');
      }
      continue;
    }

    // Exact document references may be dotted (for example,
    // settlements.cancelled_cheque) or returned as a top-level field.
    const canonical = normalizeRazorpayDocumentType(rawType);
    if (canonical && !hasRequiredType(canonical)) missing.push(rawType);
  }
  return [...new Set(missing)];
};

export const isRazorpayDocumentRequirementMatch = (
  documentType: string,
  requirement: any
) => {
  const reference = String(requirement?.field_reference || '')
    .trim()
    .toLowerCase();
  if (!reference) return false;
  const lastPart = reference.split('.').pop() || '';
  const requiredType = normalizeRazorpayDocumentType(lastPart);
  if (requiredType === documentType) return true;

  if (reference === 'individual_proof_of_address') {
    return [
      'aadhar_front',
      'aadhar_back',
      'passport_front',
      'passport_back',
      'voter_id_front',
      'voter_id_back',
    ].includes(documentType);
  }
  if (reference === 'individual_proof_of_identification') {
    return documentType === 'personal_pan';
  }
  if (reference === 'business_proof_of_identification') {
    return [
      'business_pan',
      'business_proof_url',
      'gst_certificate',
      'msme_certificate',
      'shop_establishment_certificate',
    ].includes(documentType);
  }
  return false;
};

export type RouteRejectionIssue = {
  fieldPath: string | null;
  documentType: string | null;
  message: string;
};

/** Razorpay's requirement text as UI guidance; with no stable field id, unknown ones stay general. */
export const getRouteRejectionIssues = (
  reason?: string | null
): RouteRejectionIssue[] => {
  if (!reason) return [];
  if (
    reason
      .toLowerCase()
      .includes('could not verify the settlement bank details')
  ) {
    return [
      {
        fieldPath: 'bankDetails.beneficiaryName',
        documentType: null,
        message: 'Confirm the account holder name matches the bank records.',
      },
      {
        fieldPath: 'bankDetails.accountNumber',
        documentType: null,
        message:
          'Check the bank account number and confirm it was entered correctly.',
      },
      {
        fieldPath: 'bankDetails.ifscCode',
        documentType: null,
        message: 'Check the IFSC code for the selected bank branch.',
      },
    ];
  }
  return reason
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf(':');
      const label = (separator >= 0 ? item.slice(0, separator) : item).trim();
      const message = (separator >= 0 ? item.slice(separator + 1) : '').trim();
      const normalized = label.toLowerCase();
      const documentMappings: Array<[string, string]> = [
        ['personal pan', 'personal_pan'],
        ['business pan', 'business_pan'],
        ['aadhaar front', 'aadhar_front'],
        ['aadhar front', 'aadhar_front'],
        ['aadhaar back', 'aadhar_back'],
        ['aadhar back', 'aadhar_back'],
        ['passport front', 'passport_front'],
        ['passport back', 'passport_back'],
        ['voter id front', 'voter_id_front'],
        ['voter id back', 'voter_id_back'],
        ['incorporation', 'incorporation_certificate'],
        ['partnership deed', 'partnership_deed'],
        ['llp agreement', 'llp_agreement'],
        ['board resolution', 'board_resolution'],
        ['gst certificate', 'gst_certificate'],
        ['cancelled cheque', 'cancelled_cheque'],
      ];
      const match = documentMappings.find(([needle]) =>
        normalized.includes(needle)
      );
      const fieldMappings: Array<[string, string]> = [
        ['legal business name', 'legalBusinessName'],
        ['business name', 'legalBusinessName'],
        ['business type', 'businessType'],
        ['stakeholder name', 'stakeholder.name'],
        ['stakeholder email', 'stakeholder.email'],
        ['stakeholder phone', 'stakeholder.phone'],
        ['stakeholder pan', 'stakeholder.pan'],
        ['gstin', 'gstin'],
        ['beneficiary', 'bankDetails.beneficiaryName'],
        ['account holder name', 'bankDetails.beneficiaryName'],
        ['account number', 'bankDetails.accountNumber'],
        ['ifsc', 'bankDetails.ifscCode'],
        ['account type', 'bankDetails.accountType'],
        ['city', 'address.city'],
        ['state', 'address.state'],
        ['street', 'address.street1'],
        ['postal code', 'address.postalCode'],
        ['registered address', 'address.street1'],
      ];
      const field = fieldMappings.find(([needle]) =>
        normalized.includes(needle)
      );
      return {
        fieldPath:
          field?.[1] ??
          (normalized.includes('business pan') &&
          !normalized.includes('document')
            ? 'businessPan'
            : null),
        documentType: match?.[1] ?? null,
        message: message || item || 'Please review the submitted details.',
      };
    });
};

export interface RequiredDocumentSpec {
  documentType: string;
  label: string;
  description: string;
  category: 'stakeholder' | 'business' | 'bank';
  required: boolean;
  maxPages: number;
}

export const getRequiredDocumentsForBusinessType = (
  businessType: string
): RequiredDocumentSpec[] => {
  const commonStakeholderDocs: RequiredDocumentSpec[] = [
    {
      documentType: 'personal_pan',
      label: 'Stakeholder Personal PAN Card',
      description:
        'Clear image or 1-page PDF of the authorized stakeholder’s personal PAN card',
      category: 'stakeholder',
      required: true,
      maxPages: 1,
    },
    {
      documentType: 'aadhar_front',
      label: 'Stakeholder Aadhaar Card (Front)',
      description:
        'Front side of stakeholder’s Aadhaar card showing photo and details',
      category: 'stakeholder',
      required: true,
      maxPages: 1,
    },
    {
      documentType: 'aadhar_back',
      label: 'Stakeholder Aadhaar Card (Back)',
      description:
        'Back side of stakeholder’s Aadhaar card showing registered address',
      category: 'stakeholder',
      required: true,
      maxPages: 1,
    },
  ];

  switch (businessType) {
    case 'individual':
      return commonStakeholderDocs;

    case 'proprietorship':
      return [
        ...commonStakeholderDocs,
        {
          documentType: 'gst_certificate',
          label: 'GST Certificate / Business Registration Proof',
          description:
            'GST Certificate, MSME Udyam, or Shop & Establishment certificate in clinic name',
          category: 'business',
          required: true,
          maxPages: 25,
        },
      ];

    case 'partnership':
      return [
        {
          documentType: 'business_pan',
          label: 'Partnership Firm PAN Card',
          description:
            'PAN card issued in the legal name of the partnership firm (4th character F)',
          category: 'business',
          required: true,
          maxPages: 1,
        },
        {
          documentType: 'partnership_deed',
          label: 'Registered Partnership Deed',
          description: 'Notarized or registered Partnership Deed document',
          category: 'business',
          required: true,
          maxPages: 25,
        },
        {
          documentType: 'board_resolution',
          label: 'Signatory Authority Letter / Resolution',
          description:
            'Letter of authority authorizing the managing partner to operate online settlements',
          category: 'business',
          required: true,
          maxPages: 5,
        },
        ...commonStakeholderDocs,
      ];

    case 'llp':
      return [
        {
          documentType: 'business_pan',
          label: 'LLP PAN Card',
          description:
            'PAN card issued in the legal name of the LLP (4th character F)',
          category: 'business',
          required: true,
          maxPages: 1,
        },
        {
          documentType: 'incorporation_certificate',
          label: 'LLP Certificate of Incorporation',
          description:
            'Certificate of Incorporation issued by the Ministry of Corporate Affairs',
          category: 'business',
          required: true,
          maxPages: 10,
        },
        {
          documentType: 'llp_agreement',
          label: 'LLP Agreement',
          description:
            'Executed and filed Limited Liability Partnership Agreement',
          category: 'business',
          required: true,
          maxPages: 25,
        },
        {
          documentType: 'board_resolution',
          label: 'Designated Partner Authority Letter',
          description:
            'Partner resolution authorizing designated partner to operate payment accounts',
          category: 'business',
          required: true,
          maxPages: 5,
        },
        ...commonStakeholderDocs,
      ];

    case 'private_limited':
    case 'public_limited':
      return [
        {
          documentType: 'business_pan',
          label: 'Company PAN Card',
          description: 'PAN card issued in the company name (4th character C)',
          category: 'business',
          required: true,
          maxPages: 1,
        },
        {
          documentType: 'incorporation_certificate',
          label: 'Certificate of Incorporation',
          description: 'MCA Certificate of Incorporation (COI)',
          category: 'business',
          required: true,
          maxPages: 10,
        },
        {
          documentType: 'moa',
          label: 'Memorandum of Association (MOA)',
          description: 'Copy of Memorandum of Association',
          category: 'business',
          required: true,
          maxPages: 25,
        },
        {
          documentType: 'aoa',
          label: 'Articles of Association (AOA)',
          description: 'Copy of Articles of Association',
          category: 'business',
          required: true,
          maxPages: 25,
        },
        {
          documentType: 'board_resolution',
          label: 'Board Resolution for Razorpay Route',
          description:
            'Board resolution certified by directors authorizing online settlements and route onboarding',
          category: 'business',
          required: true,
          maxPages: 5,
        },
        ...commonStakeholderDocs,
      ];

    default:
      return commonStakeholderDocs;
  }
};

export const CANCELLED_CHEQUE_DOCUMENT: RequiredDocumentSpec = {
  documentType: 'cancelled_cheque',
  label: 'Cancelled Cheque / Bank Passbook',
  description:
    'Personal or business cancelled cheque / passbook with printed account holder name and IFSC',
  category: 'bank',
  required: true,
  maxPages: 1,
};

/** Why Razorpay asks for a document, in the clinic owner's words. */
const ASKED_WHY: Record<string, string> = {
  personal_pan:
    "Razorpay couldn't confirm the owner's PAN from the details. Upload a clear photo of the PAN card.",
  aadhar_front:
    "Razorpay needs the owner's address proof. Upload the front of the Aadhaar card.",
  aadhar_back: 'Upload the back of the same Aadhaar card (the address side).',
  cancelled_cheque:
    "Razorpay couldn't confirm the bank account. Upload a cancelled cheque or passbook page showing the account name and IFSC.",
};

/** Only the documents Razorpay asked for on this account; a group ask ("any business proof") is optional each. */
export const razorpayAskedDocuments = (
  requirements: any[],
  businessType: string
): RequiredDocumentSpec[] => {
  const open = requirements.filter(
    (r) => !r?.status || r.status === 'required'
  );
  if (!open.length) return [];
  const exact = new Set(
    open.map((r) =>
      normalizeRazorpayDocumentType(
        String(r?.field_reference || '')
          .toLowerCase()
          .split('.')
          .pop() || ''
      )
    )
  );
  const proofPair = open.some(
    (r) =>
      String(r?.field_reference || '').toLowerCase() ===
      'individual_proof_of_address'
  );
  return [
    ...getRequiredDocumentsForBusinessType(businessType),
    CANCELLED_CHEQUE_DOCUMENT,
  ]
    .filter((d) =>
      open.some((r) => isRazorpayDocumentRequirementMatch(d.documentType, r))
    )
    .map((d) => ({
      ...d,
      required:
        exact.has(d.documentType) ||
        (proofPair && d.documentType.startsWith('aadhar_')) ||
        d.documentType === 'personal_pan',
      description: ASKED_WHY[d.documentType] ?? d.description,
    }));
};

/** Only the last 4 digits are ever stored or shown (Razorpay test mode returns the full number). */
export const maskAccountNumber = (value?: string | null): string | null => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? `XXXX${digits.slice(-4)}` : null;
};
