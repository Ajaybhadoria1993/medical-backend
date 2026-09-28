import type {
  PRESCRIPTION_LANGUAGE_CODES,
  PRESCRIPTION_PRINT_STYLES,
} from '../utils/prescriptionLanguages.utils';

export type PrescriptionLanguage = (typeof PRESCRIPTION_LANGUAGE_CODES)[number];

/** Every language except English, which is the source and never translated. */
export type TranslationLanguage = Exclude<PrescriptionLanguage, 'en'>;

export type TranslationStatus = 'pending' | 'machine' | 'manual';

/** bilingual: English with the translation under it; regional: the translation alone. */
export type PrescriptionPrintStyle = (typeof PRESCRIPTION_PRINT_STYLES)[number];

export type TranslationProviderName = 'none' | 'gemini' | 'bhashini';

/** Whose translation memory a phrase lives in: one doctor, inside one clinic. */
export interface TranslationScope {
  clinicId: string;
  doctorId: string;
}

/** A phrase no dictionary knew, keyed by the hash of its normalised text. */
export interface PhraseMiss {
  text: string;
  hash: string;
}

/** Bhashini's per-language inference endpoint, cached after the config call. */
export interface BhashiniService {
  url: string;
  authName: string;
  authValue: string;
  serviceId: string;
}

export interface PrescriptionDictionary {
  /** Flipped by a native speaker; until then the FE labels the language "(beta)". */
  reviewed: boolean;
  /** Keyed by `toPhraseKey` of the English text. */
  phrases: Record<string, string>;
}

export interface LanguageMeta {
  native: string;
  english: string;
  /** Google Fonts family that covers the script. */
  font: string;
  dir: 'ltr' | 'rtl';
}

/** What templates read as `i18n`: `collect` on the first render, `map` on the real one. */
export interface PrescriptionI18n {
  lang?: TranslationLanguage;
  collect?: Set<string>;
  map?: Record<string, string>;
  head?: string;
  bilingual?: boolean;
}

export interface BhashiniConfigResponse {
  pipelineInferenceAPIEndPoint: {
    callbackUrl: string;
    inferenceApiKey: { name: string; value: string };
  };
  pipelineResponseConfig: Array<{ config: Array<{ serviceId: string }> }>;
}

export interface BhashiniComputeResponse {
  pipelineResponse: Array<{
    output: Array<{ source: string; target: string }>;
  }>;
}
