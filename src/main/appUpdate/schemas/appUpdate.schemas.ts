import { z } from 'zod';

const platformEnum = z.enum(['ios', 'android']);

export const createUpdateConfigSchema = z.object({
  app_name: z.string().min(1, 'app_name is required'),
  platform: platformEnum,
  force_update: z.boolean(),
  store_url: z.string().default(''),
  latest_version: z.string().min(1, 'latest_version is required'),
  minimum_version: z
    .string()
    .min(1, 'minimum_version is required')
    .default('1.0.0'),
});

export const updateUpdateConfigSchema = z.object({
  app_name: z.string().min(1, 'app_name is required'),
  platform: platformEnum,
  force_update: z.boolean(),
  store_url: z.string().default(''),
  latest_version: z.string().min(1, 'latest_version is required'),
  minimum_version: z
    .string()
    .min(1, 'minimum_version is required')
    .default('1.0.0'),
});

export const getUpdateConfigSchema = z.object({
  app_name: z.string().min(1, 'app_name is required'),
  platform: platformEnum,
});

export type CreateUpdateConfigDto = z.infer<typeof createUpdateConfigSchema>;
export type UpdateUpdateConfigDto = z.infer<typeof updateUpdateConfigSchema>;
export type GetUpdateConfigDto = z.infer<typeof getUpdateConfigSchema>;
