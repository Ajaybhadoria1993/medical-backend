import { z } from 'zod';
import { compareVersions } from '../utils/version.utils';

const platformEnum = z.enum(['ios', 'android']);

// Same rule as the admin form: 1.0, 1.0.0.
const version = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+\.\d+(\.\d+)?$/, `${label} must look like 1.0.0 or 2.1`);

// Create and update take the same body; app + platform identify the row.
export const updateConfigBodySchema = z
  .object({
    app_name: z.string().trim().min(1, 'app_name is required'),
    platform: platformEnum,
    force_update: z.boolean(),
    store_url: z
      .string()
      .trim()
      .refine(
        (url) => url === '' || /^https:\/\/\S+\.\S+/.test(url),
        'Store URL must start with https://'
      )
      .default(''),
    latest_version: version('Latest version'),
    minimum_version: version('Minimum version').default('1.0.0'),
  })
  // A minimum above latest would force-block every user of the app.
  .refine((b) => compareVersions(b.minimum_version, b.latest_version) <= 0, {
    message: 'Minimum version cannot be higher than the latest version',
    path: ['minimum_version'],
  });

export const createUpdateConfigSchema = updateConfigBodySchema;
export const updateUpdateConfigSchema = updateConfigBodySchema;

export const getUpdateConfigSchema = z.object({
  app_name: z.string().min(1, 'app_name is required'),
  platform: platformEnum,
});

export type CreateUpdateConfigDto = z.infer<typeof createUpdateConfigSchema>;
export type UpdateUpdateConfigDto = z.infer<typeof updateUpdateConfigSchema>;
export type GetUpdateConfigDto = z.infer<typeof getUpdateConfigSchema>;
