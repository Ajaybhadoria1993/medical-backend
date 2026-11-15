import { z } from 'zod';
import { specialitySchema } from '../../../utils/specialtyCatalog';

const fieldDefSchema = z
  .object({
    key: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]{0,39}$/,
        'Key: lowercase letters, digits and _, starting with a letter'
      ),
    label: z.string().trim().min(1).max(80),
    type: z.enum([
      'text',
      'number',
      'select',
      'multiselect',
      'date',
      'boolean',
    ]),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    unit: z.string().trim().max(20).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    required: z.boolean(),
  })
  .strict()
  .superRefine((f, ctx) => {
    const hasOptions = f.type === 'select' || f.type === 'multiselect';
    if (hasOptions && !f.options?.length)
      ctx.addIssue({ code: 'custom', message: `${f.label}: add the options` });
    if (hasOptions && new Set(f.options).size !== f.options?.length)
      ctx.addIssue({ code: 'custom', message: `${f.label}: options repeat` });
    if (!hasOptions && f.options)
      ctx.addIssue({
        code: 'custom',
        message: `${f.label}: options are only for select fields`,
      });
    if (f.type !== 'number' && (f.min !== undefined || f.max !== undefined))
      ctx.addIssue({
        code: 'custom',
        message: `${f.label}: min and max are only for number fields`,
      });
    if (f.min !== undefined && f.max !== undefined && f.min > f.max)
      ctx.addIssue({
        code: 'custom',
        message: `${f.label}: min is above max`,
      });
  });

const fieldListSchema = z
  .array(fieldDefSchema)
  .max(30)
  .refine(
    (list) => new Set(list.map((f) => f.key)).size === list.length,
    'Two fields share a key'
  );

export const specialtyConfigCreateSchema = z
  .object({
    specialty: specialitySchema.pipe(z.string().min(1, 'Choose a speciality')),
    planFields: fieldListSchema,
    stepFields: fieldListSchema,
    // Only widgets the app can draw; a typo would silently hide the picker.
    widget: z
      .enum(['tooth_chart'], { error: 'Choose a picker from the list' })
      .nullable()
      .optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

export const specialtyConfigUpdateSchema = specialtyConfigCreateSchema
  .omit({ specialty: true })
  .partial()
  .strict();

export const specialtyConfigIdParamSchema = z.object({
  id: z.string().uuid('Invalid specialty config ID'),
});

export const pageQuerySchema = z.object({
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const specialtyParamSchema = z.object({
  specialty: specialitySchema.pipe(z.string().min(1)),
});

export type SpecialtyConfigCreate = z.infer<typeof specialtyConfigCreateSchema>;
export type SpecialtyConfigUpdate = z.infer<typeof specialtyConfigUpdateSchema>;
