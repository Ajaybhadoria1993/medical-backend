// Swagger only: response shapes for apiDocs. Validation never runs on responses.
import { z } from 'zod';
import {
  tpPlanStatusEnum,
  tpPlanTypeEnum,
  tpPricingModeEnum,
  tpTemplateStatusEnum,
} from '../models/treatmentEnums.model';

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ success: z.boolean(), message: z.string(), data });
const paged = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    pageNumber: z.number().int(),
    pageSize: z.number().int(),
  });

const money = z.string().nullable();
const historyEntry = z.object({
  id: z.string().uuid(),
  action: z.string(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  reason: z.string().nullable(),
  notes: z.string().nullable(),
  stepId: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});
const planType = z.enum(tpPlanTypeEnum.enumValues);
const status = z.enum(tpTemplateStatusEnum.enumValues);
const pricingMode = z.enum(tpPricingModeEnum.enumValues);
const fieldDef = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  options: z.array(z.string()).optional(),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  required: z.boolean(),
});

const templateListItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  specialty: z.string(),
  planType,
  status,
  pricingMode,
  packagePrice: money,
  sessionCount: z.number().int().nullable(),
  intervalDays: z.number().int().nullable(),
  stepCount: z.number().int(),
  stepsUnpriced: z.number().int(),
  stepsFeeTotal: money,
  isOwnVersion: z.boolean(),
  checked: z.boolean(),
  sourceTemplateId: z.string().uuid().nullable(),
  updatedAt: z.string(),
});

const templateDetail = templateListItem
  .omit({
    stepCount: true,
    stepsUnpriced: true,
    stepsFeeTotal: true,
    isOwnVersion: true,
    checked: true,
  })
  .extend({
    code: z.string().nullable(),
    ownerDoctorId: z.string().uuid().nullable(),
    packageExpiryDays: z.number().int().nullable(),
    consentRequired: z.boolean(),
    taxable: z.boolean(),
    instalmentsAllowed: z.boolean(),
    recallAfterDays: z.number().int().nullable(),
    diagnosisKeywords: z.array(z.string()),
    checkedBy: z.string().uuid().nullable(),
    checkedAt: z.string().nullable(),
    createdBy: z.string().uuid().nullable(),
    createdAt: z.string(),
    newerLibraryVersion: z.boolean(),
    steps: z.array(
      z.object({
        id: z.string().uuid(),
        seq: z.number().int(),
        name: z.string(),
        gapDays: z.number().int(),
        maxGapDays: z.number().int().nullable(),
        durationMinutes: z.number().int().nullable(),
        fee: money,
        options: z.array(z.object({ label: z.string(), extraFee: z.string() })),
      })
    ),
  });

const activeTemplate = z.object({
  id: z.string().uuid(),
  name: z.string(),
  specialty: z.string(),
  planType,
  pricingMode,
  packagePrice: money,
  sessionCount: z.number().int().nullable(),
  ownerDoctorId: z.string().uuid().nullable(),
  sourceTemplateId: z.string().uuid().nullable(),
  diagnosisKeywords: z.array(z.string()),
  stepCount: z.number().int(),
  stepsFeeTotal: money,
});

const specialtyFields = z.object({
  specialty: z.string(),
  planFields: z.array(fieldDef),
  stepFields: z.array(fieldDef),
  widget: z.string().nullable(),
});

const specialtyConfig = specialtyFields.extend({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const templateListResponse = envelope(paged(templateListItem));
export const templateDetailResponse = envelope(templateDetail);
export const activeTemplatesResponse = envelope(z.array(activeTemplate));
export const templatePreviewResponse = envelope(
  z.object({
    dates: z.array(
      z.object({
        seq: z.number().int(),
        name: z.string().nullable(),
        date: z.string(),
      })
    ),
    totalAmount: money,
    feesMissing: z.number().int(),
    durationDays: z.number().int(),
  })
);
export const specialtyFieldsResponse = envelope(specialtyFields.nullable());
export const specialtyConfigResponse = envelope(specialtyConfig);
export const specialtyConfigListResponse = envelope(paged(specialtyConfig));

const planStatus = z.enum(tpPlanStatusEnum.enumValues);
const planStep = z.object({
  id: z.string().uuid(),
  seq: z.number().int(),
  name: z.string(),
  gapDays: z.number().int(),
  durationMinutes: z.number().int().nullable(),
  fee: z.string(),
  selectedOption: z
    .object({ label: z.string(), extraFee: z.string() })
    .nullable(),
  specialtyData: z.record(z.string(), z.unknown()),
  status: z.string(),
  earliestDate: z.string().nullable(),
  gapOverrideReason: z.string().nullable(),
  notes: z.string().nullable(),
  doneAt: z.string().nullable(),
  booking: z
    .object({
      appointmentId: z.string().uuid(),
      date: z.string(),
      time: z.string().nullable(),
      tokenNo: z.number().int().nullable(),
      status: z.string(),
    })
    .nullable(),
  needsRebooking: z.boolean(),
  maxGapDays: z.number().int().nullable(),
  lateAfterDate: z.string().nullable(),
  lateness: z.enum(['late', 'overdue']).nullable(),
});

const planDetail = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  templateId: z.string().uuid().nullable(),
  consultationAppointmentId: z.string().uuid().nullable(),
  consultationPaid: z.string().nullable(),
  proposalGroupId: z.string().uuid(),
  optionLabel: z.string().nullable(),
  title: z.string(),
  diagnosis: z.string(),
  planType,
  status: planStatus,
  discountAmount: z.string(),
  totalAmount: z.string(),
  advanceAmount: z.string(),
  consentRequired: z.boolean(),
  instalmentsAllowed: z.boolean(),
  recallAfterDays: z.number().int().nullable(),
  packageExpiryDays: z.number().int().nullable(),
  billingMode: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  followUpDate: z.string().nullable(),
  endReason: z.string().nullable(),
  endReasonSensitive: z.boolean(),
  recallDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  packageExpiresOn: z.string().nullable(),
  /** The file itself comes from GET /:planId/consent-file. */
  hasConsentFile: z.boolean(),
  nextVisit: z
    .object({ stepId: z.string().uuid(), fee: z.string() })
    .nullable(),
  doctor: z.object({ id: z.string().uuid(), name: z.string() }),
  version: z
    .object({
      version: z.number().int(),
      needsPatientApproval: z.boolean(),
      patientApprovedAt: z.string().nullable(),
    })
    .nullable(),
  advance: z
    .object({
      amount: z.string(),
      paymentMode: z.string().nullable(),
      receiptNo: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
  money: z.object({
    charged: z.string(),
    paid: z.string(),
    due: z.string(),
    toCome: z.string(),
    leftToPay: z.string(),
    writtenOff: z.string(),
    refunded: z.string(),
    entries: z.array(
      z.object({
        id: z.string().uuid(),
        type: z.string(),
        amount: z.string(),
        paymentMode: z.string().nullable(),
        reason: z.string().nullable(),
        stepId: z.string().uuid().nullable(),
        receiptNo: z.string().nullable(),
        createdAt: z.string(),
      })
    ),
    instalments: z.array(
      z.object({
        id: z.string().uuid(),
        seq: z.number().int(),
        amount: z.string(),
        dueDate: z.string(),
        paidAt: z.string().nullable(),
      })
    ),
  }),
  history: z.array(historyEntry),
  historyTotal: z.number().int(),
  calls: z.array(
    z.object({
      id: z.string().uuid(),
      outcome: z.string().nullable(),
      notes: z.string().nullable(),
      nextFollowUpDate: z.string().nullable(),
      actorId: z.string().uuid().nullable(),
      createdAt: z.string(),
    })
  ),
  specialtyData: z.record(z.string(), z.unknown()),
  updatedAt: z.string(),
  steps: z.array(planStep),
  patient: z.object({
    id: z.string().uuid(),
    name: z.string(),
    allergies: z.array(z.string()),
  }),
  options: z.array(
    z.object({
      id: z.string().uuid(),
      optionLabel: z.string().nullable(),
      status: planStatus,
      totalAmount: z.string(),
    })
  ),
});

const planListItem = z.object({
  id: z.string().uuid(),
  title: z.string(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  patientMobile: z.string().nullable(),
  doctorId: z.string().uuid(),
  status: planStatus,
  planType,
  optionLabel: z.string().nullable(),
  totalAmount: z.string(),
  stepsTotal: z.number().int(),
  stepsDone: z.number().int(),
  followUpDate: z.string().nullable(),
  createdAt: z.string(),
});

export const planDetailResponse = envelope(planDetail);
export const patientContextResponse = envelope(
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    allergies: z.array(z.string()),
  })
);
export const planHistoryResponse = envelope(paged(historyEntry));
export const planListResponse = envelope(
  // counts: plans per status the caller may see, for the list tabs (6.6).
  paged(planListItem).extend({
    counts: z.record(z.string(), z.number().int()),
  })
);
export const consentFileResponse = envelope(
  z.object({ url: z.string().url() })
);
export const planSuggestionsResponse = envelope(
  z.array(
    z.object({
      templateId: z.string().uuid(),
      name: z.string(),
      planType,
      matchedKeyword: z.string(),
      isOwnVersion: z.boolean(),
      stepCount: z.number().int(),
      price: money,
    })
  )
);

const planAppointment = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  doctorId: z.string().uuid().nullable(),
  date: z.string(),
  time: z.string().nullable(),
  tokenNo: z.number().int().nullable(),
  status: z.string(),
});
const bookingOption = z.object({
  time: z.string().nullable(),
  sessionIndex: z.number().int().nullable(),
  label: z.string(),
});

export const bookingOptionsResponse = envelope(
  z.object({
    earliestDate: z.string(),
    mode: z.enum(['slot', 'token']),
    options: z.array(bookingOption),
    /** The patient's visit with this doctor that day, to use instead of booking a second one. */
    existingVisit: planAppointment.nullable(),
    /** A visit that holds the day but can't serve this step (done, or another step's); the day can't be booked. */
    blockingVisit: planAppointment
      .extend({
        usedBy: z
          .object({ seq: z.number().int(), name: z.string() })
          .nullable(),
      })
      .nullable(),
    /** No free time that day: the next day (within 14) that has one; else null. */
    nextFreeDate: z.string().nullable(),
  })
);
export const dayOptionsResponse = envelope(
  z.object({ mode: z.enum(['slot', 'token']), options: z.array(bookingOption) })
);
export const bookAllPreviewResponse = envelope(
  z.array(
    bookingOption.extend({
      stepId: z.string().uuid(),
      seq: z.number().int(),
      name: z.string(),
      gapDays: z.number().int(),
      earliestDate: z.string(),
      date: z.string(),
    })
  )
);
export const linkableAppointmentsResponse = envelope(z.array(planAppointment));
export const visitStepsResponse = envelope(
  z.object({
    steps: z.array(
      z.object({
        planId: z.string().uuid(),
        planTitle: z.string(),
        stepId: z.string().uuid(),
        seq: z.number().int(),
        name: z.string(),
        status: z.string(),
        isPlanDoctor: z.boolean(),
      })
    ),
    /** A plan proposed from this visit, not answered yet; only when the visit is on no plan. */
    pendingPlan: z
      .object({ id: z.string().uuid(), title: z.string() })
      .nullable(),
    /** A cancelled or missed plan visit: the step it was for (now free, not charged). */
    releasedStep: z
      .object({
        planId: z.string().uuid(),
        planTitle: z.string(),
        name: z.string(),
        seq: z.number().int(),
        stepsTotal: z.number().int(),
        visitStatus: z.string(),
      })
      .nullable(),
  })
);
