import { z } from 'zod';

// Also sizes the DB column; mirrored by the FE share dialog. Change all together.
export const SHARE_NOTE_MAX_LENGTH = 100;

export const galleryShareAppointmentParamsSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment ID'),
});
export type GalleryShareAppointmentParamsDto = z.infer<
  typeof galleryShareAppointmentParamsSchema
>;

export const galleryShareParamsSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment ID'),
  shareId: z.string().uuid('Invalid share ID'),
});
export type GalleryShareParamsDto = z.infer<typeof galleryShareParamsSchema>;

// Exactly one source: a My Uploads image, or a system Suggested image URL.
export const createGalleryShareSchema = z
  .object({
    galleryImageId: z.string().uuid('Invalid gallery image ID').optional(),
    suggestedImageUrl: z.string().url('Invalid image URL').optional(),
    note: z
      .string()
      .trim()
      .max(
        SHARE_NOTE_MAX_LENGTH,
        `Keep the note under ${SHARE_NOTE_MAX_LENGTH} characters`
      )
      .optional(),
  })
  .refine((v) => !!v.galleryImageId !== !!v.suggestedImageUrl, {
    message: 'Send either galleryImageId or suggestedImageUrl',
  });
export type CreateGalleryShareDto = z.infer<typeof createGalleryShareSchema>;
