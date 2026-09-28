import handlebars from 'handlebars';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import '../../../utils/handlebarsHelpers';
import logger from '../../../utils/logger';
import { pagination } from '../../../utils/utils';
import { PrescriptionTranslationModel as Phrases } from '../models/reports.model';
import { DoctorPreferenceModel as Preferences } from '../../doctor/models/doctorPreference.model';
import type {
  PhraseMiss,
  PrescriptionI18n,
  PrescriptionLanguage,
  PrescriptionPrintStyle,
  TranslationLanguage,
  TranslationScope,
  TranslationStatus,
} from '../types/prescriptionTranslation.types';
import {
  PRESCRIPTION_DICTIONARIES,
  PRESCRIPTION_LANGUAGE_CODES,
  toPrintStyle,
  toTranslationLanguage,
} from '../utils/prescriptionLanguages.utils';
import {
  buildI18nHead,
  errorMessage,
  hashPhrase,
  lookupDictionary,
  needsTranslation,
  numbersMatch,
  toPhraseKey,
} from '../utils/prescriptionTranslation.utils';
import { TranslationProviderService } from './translationProvider.service';

export class PrescriptionTranslationService {
  /** The row shape the Translations tab reads and a saved correction returns. */
  private static readonly phraseColumns = {
    id: Phrases.id,
    sourceText: Phrases.sourceText,
    translatedText: Phrases.translatedText,
    status: Phrases.status,
    usageCount: Phrases.usageCount,
    lastUsedAt: Phrases.lastUsedAt,
  };

  /** Renders once to learn exactly what the template prints through `bi`, then resolves just those strings. */
  static async buildI18n(
    templateHtml: string,
    data: object,
    lang: TranslationLanguage,
    scope: TranslationScope,
    style: PrescriptionPrintStyle = 'regional'
  ): Promise<PrescriptionI18n> {
    const bilingual = style === 'bilingual';
    const collect = new Set<string>();
    handlebars.compile(templateHtml)({ ...data, i18n: { collect, bilingual } });

    const map = await PrescriptionTranslationService.resolve(
      [...collect],
      lang,
      scope
    );
    return { lang, map, head: buildI18nHead(lang), bilingual };
  }

  /** The doctor's saved language and print style; an unset language means English only. */
  static async doctorSettings(
    doctorId: string
  ): Promise<{ lang?: TranslationLanguage; style: PrescriptionPrintStyle }> {
    const [settings] = await database
      .select({
        language: Preferences.prescriptionLanguage,
        style: Preferences.prescriptionPrintStyle,
      })
      .from(Preferences)
      .where(eq(Preferences.doctorId, doctorId))
      .limit(1);

    return {
      lang: toTranslationLanguage(settings?.language),
      style: toPrintStyle(settings?.style),
    };
  }

  /** The settings as the Translations tab shows them: 'en' when no language is set. */
  static async getDoctorSettings(doctorId: string): Promise<{
    language: PrescriptionLanguage;
    printStyle: PrescriptionPrintStyle;
  }> {
    const { lang, style } =
      await PrescriptionTranslationService.doctorSettings(doctorId);
    return { language: lang ?? 'en', printStyle: style };
  }

  /** Saves the Translations tab choice; one row per doctor, English stored as no language. */
  static async saveDoctorSettings(
    doctorId: string,
    language: PrescriptionLanguage,
    printStyle: PrescriptionPrintStyle
  ) {
    const values = {
      prescriptionLanguage: language === 'en' ? null : language,
      prescriptionPrintStyle: printStyle,
      updatedAt: new Date(),
    };

    // A doctor may have no preferences row yet; every other column has a default.
    await database
      .insert(Preferences)
      .values({ doctorId, ...values })
      .onConflictDoUpdate({ target: Preferences.doctorId, set: values });

    return PrescriptionTranslationService.getDoctorSettings(doctorId);
  }

  /** The saved PDF's language: the one picked in Preview, else the doctor's default; failures print English. */
  static async forDoctor(
    templateHtml: string,
    data: object,
    doctorId: string,
    clinicId: string,
    pickedLanguage?: PrescriptionLanguage
  ): Promise<PrescriptionI18n | undefined> {
    try {
      const settings =
        await PrescriptionTranslationService.doctorSettings(doctorId);
      // English picked in Preview is a real choice, so it overrides a regional default.
      const lang = pickedLanguage
        ? toTranslationLanguage(pickedLanguage)
        : settings.lang;
      const { style } = settings;
      return lang
        ? await PrescriptionTranslationService.buildI18n(
            templateHtml,
            data,
            lang,
            { clinicId, doctorId },
            style
          )
        : undefined;
    } catch (error) {
      logger.warn('Prescription translation skipped; printing English', {
        error: errorMessage(error),
      });
      return undefined;
    }
  }

  /** English → translation per string: dictionary, then the doctor's memory, then the provider. */
  static async resolve(
    strings: string[],
    lang: TranslationLanguage,
    scope: TranslationScope
  ): Promise<Record<string, string>> {
    const dictionary = PRESCRIPTION_DICTIONARIES[lang];
    const map: Record<string, string> = {};
    const misses: PhraseMiss[] = [];

    for (const text of new Set(strings)) {
      if (!needsTranslation(text)) continue;
      const key = toPhraseKey(text);
      const known = lookupDictionary(key, dictionary);
      if (known) map[text] = known;
      else misses.push({ text, hash: hashPhrase(key) });
    }
    if (misses.length === 0) return map;

    const rows = await database
      .select({
        id: Phrases.id,
        sourceHash: Phrases.sourceHash,
        translatedText: Phrases.translatedText,
      })
      .from(Phrases)
      .where(
        and(
          eq(Phrases.clinicId, scope.clinicId),
          eq(Phrases.doctorId, scope.doctorId),
          eq(Phrases.lang, lang),
          inArray(Phrases.sourceHash, [...new Set(misses.map((m) => m.hash))])
        )
      );
    PrescriptionTranslationService.recordUsage(rows.map((row) => row.id));

    const remembered = new Map(
      rows.map((row) => [row.sourceHash, row.translatedText])
    );
    const unresolved = new Map<string, PhraseMiss>();
    for (const miss of misses) {
      const translation = remembered.get(miss.hash);
      if (translation) map[miss.text] = translation;
      else if (!unresolved.has(miss.hash)) unresolved.set(miss.hash, miss);
    }
    if (unresolved.size === 0) return map;

    const pending = [...unresolved.values()];
    const translations = await PrescriptionTranslationService.translate(
      pending.map((miss) => miss.text),
      lang
    );
    await PrescriptionTranslationService.remember(
      pending,
      translations,
      lang,
      scope
    );

    const byHash = new Map(
      pending.map((miss, i) => [miss.hash, translations[i]])
    );
    for (const miss of misses) {
      const translation = byHash.get(miss.hash);
      if (translation) map[miss.text] = translation;
    }
    return map;
  }

  /** English, plus every language with a dictionary; once a provider is on, all of them can print. */
  static availableLanguages(): PrescriptionLanguage[] {
    const providerOn = TranslationProviderService.isEnabled();
    return PRESCRIPTION_LANGUAGE_CODES.filter(
      (code) =>
        code === 'en' ||
        providerOn ||
        Object.keys(PRESCRIPTION_DICTIONARIES[code].phrases).length > 0
    );
  }

  /** The Translations tab: one doctor's phrases for a language, pending first, then most used. */
  static async listForDoctor(
    scope: TranslationScope,
    lang: TranslationLanguage,
    status: TranslationStatus | undefined,
    pageNumber: number,
    pageSize: number
  ) {
    const { limit, offset } = pagination(pageNumber, pageSize);
    const where = and(
      eq(Phrases.clinicId, scope.clinicId),
      eq(Phrases.doctorId, scope.doctorId),
      eq(Phrases.lang, lang),
      status ? eq(Phrases.status, status) : undefined
    );

    const [items, [{ total }]] = await Promise.all([
      database
        .select(PrescriptionTranslationService.phraseColumns)
        .from(Phrases)
        .where(where)
        .orderBy(
          sql`(${Phrases.status} = 'pending') desc`,
          desc(Phrases.usageCount),
          desc(Phrases.lastUsedAt)
        )
        .limit(limit)
        .offset(offset),
      database.select({ total: count() }).from(Phrases).where(where),
    ]);

    return { items, total, pageNumber, pageSize: limit };
  }

  /** A doctor's own correction: marked manual, so neither the provider nor the fill job ever overwrites it. */
  static async saveManual(
    scope: TranslationScope,
    id: string,
    translatedText: string
  ) {
    const ownRow = and(
      eq(Phrases.id, id),
      eq(Phrases.clinicId, scope.clinicId),
      eq(Phrases.doctorId, scope.doctorId)
    );

    const [row] = await database
      .select({ sourceText: Phrases.sourceText })
      .from(Phrases)
      .where(ownRow)
      .limit(1);
    // Another doctor's phrase is indistinguishable from a missing one.
    if (!row) throw new HttpError(404, 'Translation not found');

    if (!numbersMatch(row.sourceText, translatedText)) {
      throw new HttpError(
        422,
        'The numbers in the translation must match the English exactly (use digits 0-9)'
      );
    }

    const [saved] = await database
      .update(Phrases)
      .set({ translatedText, status: 'manual', updatedAt: new Date() })
      .where(ownRow)
      .returning(PrescriptionTranslationService.phraseColumns);
    return saved;
  }

  /** Provider output, or null per phrase when it is off, fails, or changed a number. */
  private static async translate(
    sourceTexts: string[],
    lang: TranslationLanguage
  ): Promise<Array<string | null>> {
    if (!TranslationProviderService.isEnabled()) {
      return sourceTexts.map(() => null);
    }

    const texts = sourceTexts.map((text) => text.trim());
    try {
      const output = await TranslationProviderService.translateBatch(
        texts,
        lang
      );
      return output.map((value, i) => {
        const translated = value.trim();
        return translated && numbersMatch(texts[i], translated)
          ? translated
          : null;
      });
    } catch (error) {
      // Never log the text itself: free text can carry patient details.
      logger.warn('Prescription translation failed; printing English', {
        lang,
        count: texts.length,
        error: errorMessage(error),
      });
      return texts.map(() => null);
    }
  }

  /** Tracks every miss; a machine result fills a pending row but never overwrites a manual one. */
  private static async remember(
    misses: PhraseMiss[],
    translations: Array<string | null>,
    lang: TranslationLanguage,
    scope: TranslationScope
  ): Promise<void> {
    try {
      await database
        .insert(Phrases)
        .values(
          misses.map((miss, i) => ({
            clinicId: scope.clinicId,
            doctorId: scope.doctorId,
            lang,
            sourceHash: miss.hash,
            sourceText: miss.text.trim(),
            translatedText: translations[i],
            status: translations[i]
              ? ('machine' as const)
              : ('pending' as const),
          }))
        )
        .onConflictDoUpdate({
          target: [
            Phrases.clinicId,
            Phrases.doctorId,
            Phrases.lang,
            Phrases.sourceHash,
          ],
          set: {
            translatedText: sql`excluded.translated_text`,
            status: sql`excluded.status`,
            updatedAt: new Date(),
          },
          setWhere: sql`${Phrases.status} = 'pending' and excluded.status = 'machine'`,
        });
    } catch (error) {
      logger.warn('Could not record prescription phrases', {
        lang,
        count: misses.length,
        error: errorMessage(error),
      });
    }
  }

  /** Feeds the Translations tab's "most used first" order; a failed count never blocks a render. */
  private static recordUsage(ids: string[]): void {
    if (ids.length === 0) return;

    database
      .update(Phrases)
      .set({
        usageCount: sql`${Phrases.usageCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(inArray(Phrases.id, ids))
      .catch((error: unknown) => {
        logger.warn('Could not record prescription phrase usage', {
          error: errorMessage(error),
        });
      });
  }
}
