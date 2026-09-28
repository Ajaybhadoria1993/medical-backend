import type {
  LanguageMeta,
  PrescriptionDictionary,
  PrescriptionLanguage,
  PrescriptionPrintStyle,
  TranslationLanguage,
} from '../types/prescriptionTranslation.types';
import { as } from './translations/as';
import { bn } from './translations/bn';
import { gu } from './translations/gu';
import { hi } from './translations/hi';
import { kn } from './translations/kn';
import { mai } from './translations/mai';
import { ml } from './translations/ml';
import { mr } from './translations/mr';
import { ne } from './translations/ne';
import { or } from './translations/or';
import { pa } from './translations/pa';
import { sa } from './translations/sa';
import { ta } from './translations/ta';
import { te } from './translations/te';
import { ur } from './translations/ur';

/** English plus the 22 scheduled languages of India. */
export const PRESCRIPTION_LANGUAGE_CODES = [
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

export const LANGUAGE_META: Record<TranslationLanguage, LanguageMeta> = {
  as: {
    native: 'অসমীয়া',
    english: 'Assamese',
    font: 'Noto Sans Bengali',
    dir: 'ltr',
  },
  bn: {
    native: 'বাংলা',
    english: 'Bengali',
    font: 'Noto Sans Bengali',
    dir: 'ltr',
  },
  brx: {
    native: 'बड़ो',
    english: 'Bodo',
    font: 'Noto Sans Devanagari',
    dir: 'ltr',
  },
  doi: {
    native: 'डोगरी',
    english: 'Dogri',
    font: 'Noto Sans Devanagari',
    dir: 'ltr',
  },
  gu: {
    native: 'ગુજરાતી',
    english: 'Gujarati',
    font: 'Noto Sans Gujarati',
    dir: 'ltr',
  },
  hi: {
    native: 'हिन्दी',
    english: 'Hindi',
    font: 'Noto Sans Devanagari',
    dir: 'ltr',
  },
  kn: {
    native: 'ಕನ್ನಡ',
    english: 'Kannada',
    font: 'Noto Sans Kannada',
    dir: 'ltr',
  },
  ks: {
    native: 'کٲشُر',
    english: 'Kashmiri',
    font: 'Noto Nastaliq Urdu',
    dir: 'rtl',
  },
  kok: {
    native: 'कोंकणी',
    english: 'Konkani',
    font: 'Noto Sans Devanagari',
    dir: 'ltr',
  },
  mai: {
    native: 'मैथिली',
    english: 'Maithili',
    font: 'Noto Sans Devanagari',
    dir: 'ltr',
  },
  ml: {
    native: 'മലയാളം',
    english: 'Malayalam',
    font: 'Noto Sans Malayalam',
    dir: 'ltr',
  },
  mni: {
    native: 'ꯃꯤꯇꯩꯂꯣꯟ',
    english: 'Manipuri (Meetei Mayek script)',
    font: 'Noto Sans Meetei Mayek',
    dir: 'ltr',
  },
  mr: {
    native: 'मराठी',
    english: 'Marathi',
    font: 'Noto Sans Devanagari',
    dir: 'ltr',
  },
  ne: {
    native: 'नेपाली',
    english: 'Nepali',
    font: 'Noto Sans Devanagari',
    dir: 'ltr',
  },
  or: { native: 'ଓଡ଼ିଆ', english: 'Odia', font: 'Noto Sans Oriya', dir: 'ltr' },
  pa: {
    native: 'ਪੰਜਾਬੀ',
    english: 'Punjabi (Gurmukhi script)',
    font: 'Noto Sans Gurmukhi',
    dir: 'ltr',
  },
  sa: {
    native: 'संस्कृतम्',
    english: 'Sanskrit',
    font: 'Noto Sans Devanagari',
    dir: 'ltr',
  },
  sat: {
    native: 'ᱥᱟᱱᱛᱟᱲᱤ',
    english: 'Santali (Ol Chiki script)',
    font: 'Noto Sans Ol Chiki',
    dir: 'ltr',
  },
  sd: {
    native: 'سنڌي',
    english: 'Sindhi (Arabic script)',
    font: 'Noto Naskh Arabic',
    dir: 'rtl',
  },
  ta: {
    native: 'தமிழ்',
    english: 'Tamil',
    font: 'Noto Sans Tamil',
    dir: 'ltr',
  },
  te: {
    native: 'తెలుగు',
    english: 'Telugu',
    font: 'Noto Sans Telugu',
    dir: 'ltr',
  },
  ur: {
    native: 'اردو',
    english: 'Urdu',
    font: 'Noto Nastaliq Urdu',
    dir: 'rtl',
  },
};

// ponytail: no handwritten dictionary where our phrasing would be unreliable; these fall through to memory/provider.
const EMPTY: PrescriptionDictionary = { reviewed: false, phrases: {} };

export const PRESCRIPTION_DICTIONARIES: Record<
  TranslationLanguage,
  PrescriptionDictionary
> = {
  as,
  bn,
  brx: EMPTY,
  doi: EMPTY,
  gu,
  hi,
  kn,
  ks: EMPTY,
  kok: EMPTY,
  mai,
  ml,
  mni: EMPTY,
  mr,
  ne,
  or,
  pa,
  sa,
  sat: EMPTY,
  sd: EMPTY,
  ta,
  te,
  ur,
};

export const PRESCRIPTION_PRINT_STYLES = ['bilingual', 'regional'] as const;

/** Regional-only unless the doctor explicitly asked for the English under each line. */
export const toPrintStyle = (value: unknown): PrescriptionPrintStyle =>
  value === 'bilingual' ? 'bilingual' : 'regional';

/** A stored or requested code narrowed to one we can translate into; English and junk become undefined. */
export const toTranslationLanguage = (
  value: unknown
): TranslationLanguage | undefined =>
  typeof value === 'string' && value in LANGUAGE_META
    ? (value as TranslationLanguage)
    : undefined;

/** Like `toTranslationLanguage`, but keeps an explicit English choice instead of dropping it. */
export const toPrescriptionLanguage = (
  value: unknown
): PrescriptionLanguage | undefined =>
  value === 'en' ? 'en' : toTranslationLanguage(value);
