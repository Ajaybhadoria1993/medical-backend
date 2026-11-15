import type { z } from 'zod';
import type {
  costReportQuerySchema,
  creditChangeSchema,
  grantsQuerySchema,
  historyQuerySchema,
  packCreateSchema,
  packUpdateSchema,
  settingsChangeSchema,
} from '../schemas/credits.schema';

export type GrantsQuery = z.infer<typeof grantsQuerySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type CreditChangeBody = z.infer<typeof creditChangeSchema>;
export type SettingsChangeBody = z.infer<typeof settingsChangeSchema>;
export type PackCreateBody = z.infer<typeof packCreateSchema>;
export type PackUpdateBody = z.infer<typeof packUpdateSchema>;
export type CostReportQuery = z.infer<typeof costReportQuerySchema>;
