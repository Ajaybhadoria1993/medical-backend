import { z } from 'zod';
import { CALL_OUTCOMES } from '../../treatmentPlan';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

export const followUpKindValues = z.enum([
  'doctor_followup',
  'plan_step',
  'plan_callback',
  'plan_checkup',
]);

export const getFollowUpsQuerySchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  type: followUpKindValues.optional(),
  due: z.enum(['overdue', 'today', 'upcoming']).optional(),
  q: z.string().trim().max(100).optional(),
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type GetFollowUpsQueryDto = z.infer<typeof getFollowUpsQuerySchema>;

// A row is named by its kind and refId; plan rows also carry planId, where plan calls are kept.
const followUpRef = {
  kind: followUpKindValues,
  refId: z.string().uuid('Invalid follow-up'),
  planId: z.string().uuid('Invalid plan').optional(),
};
const planIdForPlanRows = (v: { kind: string; planId?: string }) =>
  v.kind === 'doctor_followup' || !!v.planId;
const planIdMessage = {
  message: 'planId is required for plan follow-ups',
  path: ['planId'],
};

// Plain object for the OpenAPI registry, which needs a ZodObject for query params.
export const followUpRefDocsSchema = z.object(followUpRef);
export const followUpRefQuerySchema = followUpRefDocsSchema.refine(
  planIdForPlanRows,
  planIdMessage
);
export type FollowUpRefDto = z.infer<typeof followUpRefQuerySchema>;

export const logFollowUpCallSchema = z
  .object({
    ...followUpRef,
    outcome: z.enum(CALL_OUTCOMES),
    notes: z.string().trim().max(500).optional(),
    nextCallDate: ymd.optional(),
  })
  .strict()
  .refine(planIdForPlanRows, planIdMessage);
export type LogFollowUpCallDto = z.infer<typeof logFollowUpCallSchema>;

export const dismissFollowUpSchema = z
  .object({
    ...followUpRef,
    reason: z.string().trim().min(3, 'Say why in a few words').max(255),
  })
  .strict()
  .refine(planIdForPlanRows, planIdMessage);
export type DismissFollowUpDto = z.infer<typeof dismissFollowUpSchema>;

export const followUpCheckDateQuerySchema = z.object({
  doctorId: z.string().uuid('Invalid doctor'),
  date: ymd,
  patientId: z.string().uuid('Invalid patient').optional(),
});
export type FollowUpCheckDateQueryDto = z.infer<
  typeof followUpCheckDateQuerySchema
>;
