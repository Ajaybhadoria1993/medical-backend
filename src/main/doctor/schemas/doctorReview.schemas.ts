import { z } from 'zod';

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

export const doctorReviewParamsSchema = z.object({
  reviewId: z.string().uuid({ message: 'Invalid review ID' }),
});

export const doctorReviewDoctorParamsSchema = z.object({
  doctorId: z.string().uuid({ message: 'Invalid doctor ID' }),
});

export type CreateDoctorReviewInput = z.infer<typeof createDoctorReviewSchema>;
export type UpdateDoctorReviewInput = z.infer<typeof updateDoctorReviewSchema>;
export type DoctorReplyInput = z.infer<typeof doctorReplySchema>;
export type DoctorReviewQueryInput = z.infer<typeof doctorReviewQuerySchema>;
