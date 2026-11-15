import { z } from 'zod';

/** English plus the 22 scheduled languages of India, as ISO 639 codes (they never change).
 *  Shared by prescription translation and the doctor's "languages spoken". */
export const INDIAN_LANGUAGE_CODES = [
  'en',
  'as',
  'bn',
  'brx',
  'doi',
  'gu',
  'hi',
  'kn',
  'ks',
  'kok',
  'mai',
  'ml',
  'mni',
  'mr',
  'ne',
  'or',
  'pa',
  'sa',
  'sat',
  'sd',
  'ta',
  'te',
  'ur',
] as const;

export const MAX_SPOKEN_LANGUAGES = 8;

/** A doctor's languages as codes ("en", "hi"), duplicates dropped; [] clears them. */
export const languagesSpokenSchema = z
  .array(z.enum(INDIAN_LANGUAGE_CODES))
  .transform((codes) => [...new Set(codes)])
  .refine((codes) => codes.length <= MAX_SPOKEN_LANGUAGES, {
    message: `Choose at most ${MAX_SPOKEN_LANGUAGES} languages`,
  });
