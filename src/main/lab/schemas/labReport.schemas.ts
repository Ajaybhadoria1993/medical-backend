import { z } from 'zod';

const colorSchema = z.string().trim().min(1).max(20);

export const upsertLabUpdatedReportSchema = z
  .object({
    templateName: z
      .enum(['labReportTemplate1', 'labReportTemplate2'])
      .optional(),
    color1: colorSchema.optional(),
    color2: colorSchema.optional(),
    color3: colorSchema.optional(),
    color4: colorSchema.optional(),
    color5: colorSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one report template field must be provided',
  });

export type UpsertLabUpdatedReportInput = z.infer<
  typeof upsertLabUpdatedReportSchema
>;

export const previewLabReportSchema = z.object({
  templateName: z.string().trim().min(1).max(100),
  color1: colorSchema.optional(),
  color2: colorSchema.optional(),
  color3: colorSchema.optional(),
  color4: colorSchema.optional(),
  color5: colorSchema.optional(),
});

export type PreviewLabReportInput = z.infer<typeof previewLabReportSchema>;
