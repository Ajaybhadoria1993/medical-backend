import { z } from 'zod';

/**
 * A section id is opaque to this module — it is whatever `src/realtime/sections.ts`
 * built. It is validated only for shape and length, not against a whitelist of
 * known sections, so a new feature can start signalling without this schema
 * needing to know about it.
 */
const sectionId = z
  .string()
  .min(1, 'section must not be empty')
  .max(200, 'section is too long')
  .regex(
    /^[A-Za-z0-9:_-]+$/,
    'section may only contain letters, numbers, colon, underscore and hyphen'
  );

/**
 * GET /api/v1/realtime/versions?sections=a,b,c
 *
 * Accepts a comma-separated list so a screen watching several sections
 * resolves them all in one request rather than one per section.
 */
export const getVersionsQuerySchema = z.object({
  sections: z
    .string()
    .min(1, 'sections is required')
    .transform((raw) =>
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
    .pipe(
      z
        .array(sectionId)
        .min(1, 'at least one section is required')
        // Capped so a single request cannot fan out into an unbounded number
        // of Redis reads.
        .max(20, 'a maximum of 20 sections may be requested at once')
    ),
});

export type GetVersionsQuery = z.infer<typeof getVersionsQuerySchema>;
