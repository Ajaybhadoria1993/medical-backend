import { z } from 'zod';

const visitingRequestStatusValues = z.enum([
  'Pending',
  'Scheduled',
  'Cancelled',
]);

export const getAllVisitingRequestQuerySchema = z.object({
  pageSize: z.string().regex(/^\d+$/, 'pageSize must be a number').optional(),
  pageNumber: z
    .string()
    .regex(/^\d+$/, 'pageNumber must be a number')
    .optional(),
  doctorId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  status: z
    .union([z.array(visitingRequestStatusValues), visitingRequestStatusValues])
    .optional(),
});
export type GetAllVisitingRequestQueryDto = z.infer<
  typeof getAllVisitingRequestQuerySchema
>;

export const getRelatedAppointmentParamsSchema = z.object({
  appointmentId: z.string().min(1, 'appointmentId is required'),
});
export type GetRelatedAppointmentParamsDto = z.infer<
  typeof getRelatedAppointmentParamsSchema
>;

export const cancelVisitingRequestParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
});
export type CancelVisitingRequestParamsDto = z.infer<
  typeof cancelVisitingRequestParamsSchema
>;

export const findVisitingRequestQuerySchema = z.object({
  doctorId: z.string().min(1, 'doctorId is required'),
  patientId: z.string().min(1, 'patientId is required'),
  requestedDate: z.string().min(1, 'requestedDate is required'),
});
export type FindVisitingRequestQueryDto = z.infer<
  typeof findVisitingRequestQuerySchema
>;
