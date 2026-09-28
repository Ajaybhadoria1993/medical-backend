import { z } from 'zod';

export const updateClinicCancellationPolicySchema = z.object({
  allowPatientCancel: z.boolean().optional(),
  allowDoctorCancel: z.boolean().optional(),
  allowReceptionistCancel: z.boolean().optional(),
  allowClinicAdminCancel: z.boolean().optional(),
  windowOnlineHours: z.number().int().min(0).optional(),
  windowOfflineHours: z.number().int().min(0).optional(),
  dailyLimitPerPatient: z.number().int().min(0).optional(),
  weeklyLimitPerPatient: z.number().int().min(0).optional(),
  monthlyLimitPerPatient: z.number().int().min(0).optional(),
  cooldownSecondsBetweenCancellations: z.number().int().min(0).optional(),
  reasonMandatory: z.boolean().optional(),
  allowAdditionalComments: z.boolean().optional(),
  minCommentLength: z.number().int().min(0).optional(),
  maxCommentLength: z.number().int().min(0).optional(),
  allowReschedule: z.boolean().optional(),
  maxReschedules: z.number().int().min(0).optional(),
  rescheduleWindowHours: z.number().int().min(0).optional(),
  preservePaymentOnReschedule: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const requestCancellationSchema = z.object({
  reasonCode: z.string().min(1, 'Reason code is required'),
  comments: z.string().optional(),
});

export type UpdateClinicCancellationPolicyDto = z.infer<
  typeof updateClinicCancellationPolicySchema
>;
export type RequestCancellationDto = z.infer<typeof requestCancellationSchema>;
