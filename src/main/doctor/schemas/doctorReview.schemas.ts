import { z } from 'zod';
import { MY_REVIEWS_MAX_PAGE_SIZE } from '../utils/doctorReview.utils';

export const createDoctorReviewSchema = z.object({
  appointmentId: z.string().uuid({ message: 'Invalid appointment ID' }),
  doctorId: z.string().uuid({ message: 'Invalid doctor ID' }),
  rating: z
    .number()
    .int()
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating must be at most 5'),
  reviewText: z
    .string()
    .trim()
    .max(1000, 'Review cannot exceed 1000 characters')
    .optional(),
});

export const updateDoctorReviewSchema = z.object({
  rating: z
    .number()
    .int()
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating must be at most 5')
    .optional(),
  reviewText: z
    .string()
    .trim()
    .max(1000, 'Review cannot exceed 1000 characters')
    .optional(),
});

export const doctorReplySchema = z.object({
  replyText: z
    .string()
    .trim()
    .min(1, 'Reply content cannot be empty')
    .max(1000, 'Reply cannot exceed 1000 characters'),
});

export const doctorReviewQuerySchema = z.object({
  pageSize: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 10)),
  pageNumber: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1)),
});

export const doctorMyReviewsQuerySchema = z.object({
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MY_REVIEWS_MAX_PAGE_SIZE)
    .default(10),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

export const doctorReviewParamsSchema = z.object({
  reviewId: z.string().uuid({ message: 'Invalid review ID' }),
});

export const patientReviewsQuerySchema = doctorMyReviewsQuerySchema.omit({
  rating: true,
});

export const doctorReviewAppointmentParamsSchema = z.object({
  appointmentId: z.string().uuid({ message: 'Invalid appointment ID' }),
});

export const doctorReviewDoctorParamsSchema = z.object({
  doctorId: z.string().uuid({ message: 'Invalid doctor ID' }),
});

export type CreateDoctorReviewInput = z.infer<typeof createDoctorReviewSchema>;
export type UpdateDoctorReviewInput = z.infer<typeof updateDoctorReviewSchema>;
export type DoctorReplyInput = z.infer<typeof doctorReplySchema>;
export type DoctorReviewQueryInput = z.infer<typeof doctorReviewQuerySchema>;
export type DoctorMyReviewsQueryInput = z.infer<
  typeof doctorMyReviewsQuerySchema
>;
export type PatientReviewsQueryInput = z.infer<
  typeof patientReviewsQuerySchema
>;
