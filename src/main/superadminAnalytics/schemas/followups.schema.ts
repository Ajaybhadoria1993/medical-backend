import { z } from 'zod';
import {
  FOLLOWUP_OUTCOMES,
  FOLLOWUP_PRIORITIES,
  FOLLOWUP_STATUSES,
  FOLLOWUP_TYPES,
} from '../types/followup.types';

export const followupListQuerySchema = z.object({
  status: z.enum(FOLLOWUP_STATUSES).default('open'),
  type: z.enum(FOLLOWUP_TYPES).optional(),
  priority: z.enum(FOLLOWUP_PRIORITIES).optional(),
  /** 'me', 'unassigned', or a Super Admin user id. */
  owner: z.union([z.enum(['me', 'unassigned']), z.string().uuid()]).optional(),
  clinicId: z.string().uuid().optional(),
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const followupParamSchema = z.object({
  taskId: z.string().uuid('Invalid task ID'),
});

const noteBody = z.string().trim().min(1, 'Write a note').max(2000);
const optionalBody = z.string().trim().max(2000).optional();

/** Counts-only rule: notes are about the business relationship, never patients. */
export const followupActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('assign'),
    ownerAdminId: z.string().uuid().nullable(),
  }),
  z.object({ action: z.literal('note'), body: noteBody }),
  z.object({ action: z.literal('contacted'), body: optionalBody }),
  z.object({
    action: z.literal('snooze'),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    body: optionalBody,
  }),
  z.object({
    action: z.literal('resolve'),
    // auto_cleared is reserved for the nightly rules.
    outcome: z.enum(FOLLOWUP_OUTCOMES).exclude(['auto_cleared']),
    body: optionalBody,
  }),
  z.object({ action: z.literal('reopen') }),
  // Sent to the clinic owner as an in-app + push notification.
  z.object({
    action: z.literal('message'),
    title: z.string().trim().min(1, 'Add a title').max(80),
    body: z.string().trim().min(1, 'Write a message').max(300),
  }),
]);

export type FollowupListQueryDto = z.infer<typeof followupListQuerySchema>;
export type FollowupActionDto = z.infer<typeof followupActionSchema>;
