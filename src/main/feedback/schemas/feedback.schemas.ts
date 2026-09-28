// schemas/feedback-zod-schemas.ts
// Separated, composable Zod schemas for the Feedback model.
// Drop this file into your project (or split into multiple files if you prefer).

import { z } from 'zod';

// -----------------------------
// 1) Status enumd
// -----------------------------
export const feedbackStatus = z.enum([
  'new',
  'reviewed',
  'resolved',
  'dismissed',
]);

// -----------------------------
// 3) Tags (accepts simple strings or small objects)
// -----------------------------
export const tagStringSchema = z.string().min(1).max(50);

export const tagObjectSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});
export const tagsSchema = z
  .array(z.union([tagStringSchema, tagObjectSchema]))
  .max(10)
  .nullable()
  .optional();

// -----------------------------
// 4) Core create (POST) schema
//    - appointmentId is optional/nullable (UUID expected by your model)
//    - rating required 1..5
// -----------------------------

export const createFeedbackSchema = z.object({
  appointmentId: z.uuid().nullable().optional(),
  doctorId: z.string().nullable().optional(),
  rating: z
    .number()
    .int({ message: 'rating must be an integer' })
    .min(1, { message: 'rating must be at least 1' })
    .max(5, { message: 'rating must be at most 5' }),

  comments: z.string().trim().max(2000).nullable().optional(),

  attachments: z.array(z.string()).max(10).nullable().optional(),

  isAnonymous: z.boolean().optional(),

  // tags small array of short strings or objects
  tags: tagsSchema,
});

// -----------------------------
// 6) Partial update schema (PATCH)
//    - allow partial updates but require at least one field
// -----------------------------

export const updateFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comments: z.string().trim().max(2000).optional(),
  attachments: z.array(z.string()).max(10).optional(),
  isAnonymous: z.boolean().optional(),
  status: feedbackStatus.optional(),
  tags: tagsSchema,
  // response: z.string().trim().max(2000).optional(),
  // responseAt: z.date().optional(),
});
export const respondFeedbackSchema = z.object({
  response: z.string().min(1).max(2000),
  status: feedbackStatus, // optionally change status when responding
});

export const feedbackQuerySchema = z.object({
  pageSize: z.string().min(1, 'pageSize is required').optional(),
  pageNumber: z.string().min(1, 'pageNumber is required').optional(),
  searchBy: z.string().min(1, 'searchBy is required').optional(),
});
export const feedbackParamsSchema = z.object({
  feedbackId: z.string().min(1, 'feedbackId is required'),
});

// -----------------------------
// 8) Type exports (inferred)
// -----------------------------
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
export type UpdateFeedbackInput = z.infer<typeof updateFeedbackSchema>;
export type RespondFeedbackInput = z.infer<typeof respondFeedbackSchema>;
export type FeedbackQueryInput = z.infer<typeof feedbackQuerySchema>;
export type FeedbackParamsInput = z.infer<typeof feedbackParamsSchema>;
