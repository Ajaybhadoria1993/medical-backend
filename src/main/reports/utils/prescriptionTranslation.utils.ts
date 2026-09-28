import { createHash } from 'crypto';
import type {
  PrescriptionDictionary,
  TranslationLanguage,
} from '../types/prescriptionTranslation.types';
import { LANGUAGE_META } from './prescriptionLanguages.utils';

/** A slow provider must never hold up a prescription PDF. */
export const PROVIDER_TIMEOUT_MS = 8000;

export const BHASHINI_CONFIG_URL =
  'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';
export const BHASHINI_PIPELINE_ID = '64392f96daac500b55c543cd';

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const withTimeout = <T>(work: Promise<T>): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('Translation provider timed out')),
        PROVIDER_TIMEOUT_MS
      ).unref();
    }),
  ]);

/** Lookup key: case, spacing and a trailing full stop or colon ("Next Visit:") don't change meaning. */
export const toPhraseKey = (text: string): string =>
  text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.:।]+$/, '')
    .toLowerCase();

export const hashPhrase = (key: string): string =>
  createHash('sha256').update(key).digest('hex');

/** Only text with Latin letters needs translating; "1-0-1", dates and numbers print as-is. */
export const needsTranslation = (text: string): boolean => /[a-z]/i.test(text);

const DURATION = /^(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months)$/;

// The editor's weekly text: "weekly", "weekly (mon, wed)", "weekly (mon, wed) for 5 weeks".
const WEEKLY = /^weekly(?:\s*\(([a-z,\s]+)\))?(?:\s+for\s+(\d+\s*weeks?))?$/;

/** Dictionary phrase, a "5 days" duration, a weekly schedule, or "•"-joined parts of those. */
export const lookupDictionary = (
  key: string,
  dictionary: PrescriptionDictionary
): string | undefined => {
  if (dictionary.phrases[key]) return dictionary.phrases[key];

  if (key.includes('•')) {
    const parts = key
      .split('•')
      .map((p) => lookupDictionary(p.trim(), dictionary));
    return parts.every(Boolean) ? parts.join(' • ') : undefined;
  }

  const weekly = WEEKLY.exec(key);
  if (weekly) {
    const label = dictionary.phrases.weekly;
    const days = weekly[1]?.split(',').map((d) => dictionary.phrases[d.trim()]);
    const span = weekly[2] && lookupDictionary(weekly[2], dictionary);
    if (!label || days?.some((d) => !d) || (weekly[2] && !span))
      return undefined;
    return [days ? `${label} (${days.join(', ')})` : label, span]
      .filter(Boolean)
      .join(' • ');
  }

  const duration = DURATION.exec(key);
  const unit = duration && dictionary.phrases[duration[2]];
  return unit ? `${duration[1]} ${unit}` : undefined;
};

/** A translation that changed a number (a dose, a duration) must never print. */
export const numbersMatch = (source: string, translated: string): boolean => {
  const numbers = (value: string) =>
    (value.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(',');
  return numbers(source) === numbers(translated);
};

/** Font link and `.tr` styles for the translated lines, dropped into each template's head. */
export const buildI18nHead = (lang: TranslationLanguage): string => {
  const { font } = LANGUAGE_META[lang];
  const family = font.replace(/ /g, '+');

  return (
    `<link href="https://fonts.googleapis.com/css2?family=${family}:wght@400;600&display=swap" rel="stylesheet">` +
    `<style>.tr{display:block;font-family:'${font}',sans-serif;font-size:.92em;` +
    `text-transform:none;letter-spacing:0;line-height:1.5}` +
    // line-height:1 keeps the taller Indic font from pushing its line below the English cells beside it.
    `.tr-only{font-family:'${font}',sans-serif;text-transform:none;letter-spacing:0;line-height:1}` +
    `.tr-note{padding:0 24px 6px;font-size:9px;color:var(--color4)}</style>`
  );
};
