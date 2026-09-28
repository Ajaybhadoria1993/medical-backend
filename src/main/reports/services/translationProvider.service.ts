import { GoogleGenAI, Type } from '@google/genai';
import { envConfig } from '../../../utils/envConfig';
import logger from '../../../utils/logger';
import type {
  BhashiniComputeResponse,
  BhashiniConfigResponse,
  BhashiniService,
  TranslationLanguage,
  TranslationProviderName,
} from '../types/prescriptionTranslation.types';
import { LANGUAGE_META } from '../utils/prescriptionLanguages.utils';
import {
  BHASHINI_CONFIG_URL,
  BHASHINI_PIPELINE_ID,
  errorMessage,
  PROVIDER_TIMEOUT_MS,
  withTimeout,
} from '../utils/prescriptionTranslation.utils';

export class TranslationProviderService {
  private static gemini: GoogleGenAI | null = null;
  private static readonly bhashiniServices = new Map<
    TranslationLanguage,
    BhashiniService
  >();

  static isEnabled(): boolean {
    return envConfig.TRANSLATION_PROVIDER !== 'none';
  }

  /** One batched call, same length and order as `strings`; throws when both providers fail. */
  static async translateBatch(
    strings: string[],
    lang: TranslationLanguage
  ): Promise<string[]> {
    const primary = envConfig.TRANSLATION_PROVIDER;
    if (primary === 'none') throw new Error('No translation provider set');

    try {
      return await TranslationProviderService.run(primary, strings, lang);
    } catch (error) {
      const fallback = envConfig.TRANSLATION_FALLBACK;
      if (fallback === 'none' || fallback === primary) throw error;

      logger.warn(
        `Translation provider ${primary} failed; trying ${fallback}`,
        {
          lang,
          error: errorMessage(error),
        }
      );
      return TranslationProviderService.run(fallback, strings, lang);
    }
  }

  private static async run(
    provider: Exclude<TranslationProviderName, 'none'>,
    strings: string[],
    lang: TranslationLanguage
  ): Promise<string[]> {
    const output = await withTimeout(
      provider === 'gemini'
        ? TranslationProviderService.translateWithGemini(strings, lang)
        : TranslationProviderService.translateWithBhashini(strings, lang)
    );

    if (
      !Array.isArray(output) ||
      output.length !== strings.length ||
      output.some((value) => typeof value !== 'string')
    ) {
      throw new Error(`${provider} returned a malformed translation batch`);
    }
    return output as string[];
  }

  /** Vertex with a service account when a project is set, else a key from a billed project. */
  private static getGemini(): GoogleGenAI {
    TranslationProviderService.gemini ??= envConfig.GOOGLE_CLOUD_PROJECT
      ? new GoogleGenAI({
          vertexai: true,
          project: envConfig.GOOGLE_CLOUD_PROJECT,
          location: envConfig.GOOGLE_CLOUD_LOCATION,
        })
      : new GoogleGenAI({ apiKey: envConfig.GEMINI_API_KEY });
    return TranslationProviderService.gemini;
  }

  private static async translateWithGemini(
    strings: string[],
    lang: TranslationLanguage
  ): Promise<unknown> {
    const response =
      await TranslationProviderService.getGemini().models.generateContent({
        model: envConfig.TRANSLATION_MODEL_NAME,
        contents: JSON.stringify(strings),
        config: {
          temperature: 0,
          systemInstruction:
            `Translate each English prescription instruction in the JSON array into ` +
            `${LANGUAGE_META[lang].english} for a patient. Return a JSON array of the same ` +
            `length and order. Keep digits as Latin 0-9, and keep units and medicine names unchanged.`,
          responseMimeType: 'application/json',
          responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      });
    return JSON.parse(response.text ?? '[]');
  }

  // ponytail: written from the ULCA pipeline docs, not yet run against a live key.
  private static async getBhashiniService(
    lang: TranslationLanguage
  ): Promise<BhashiniService> {
    const cached = TranslationProviderService.bhashiniServices.get(lang);
    if (cached) return cached;

    const response = await fetch(BHASHINI_CONFIG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        userID: envConfig.BHASHINI_USER_ID ?? '',
        ulcaApiKey: envConfig.BHASHINI_API_KEY ?? '',
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'translation',
            config: {
              language: { sourceLanguage: 'en', targetLanguage: lang },
            },
          },
        ],
        pipelineRequestConfig: { pipelineId: BHASHINI_PIPELINE_ID },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Bhashini config failed with ${response.status}`);
    }

    const body = (await response.json()) as BhashiniConfigResponse;
    const service = {
      url: body.pipelineInferenceAPIEndPoint.callbackUrl,
      authName: body.pipelineInferenceAPIEndPoint.inferenceApiKey.name,
      authValue: body.pipelineInferenceAPIEndPoint.inferenceApiKey.value,
      serviceId: body.pipelineResponseConfig[0].config[0].serviceId,
    };
    TranslationProviderService.bhashiniServices.set(lang, service);
    return service;
  }

  private static async translateWithBhashini(
    strings: string[],
    lang: TranslationLanguage
  ): Promise<unknown> {
    const service = await TranslationProviderService.getBhashiniService(lang);
    const response = await fetch(service.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [service.authName]: service.authValue,
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'translation',
            config: {
              language: { sourceLanguage: 'en', targetLanguage: lang },
              serviceId: service.serviceId,
            },
          },
        ],
        inputData: { input: strings.map((source) => ({ source })) },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Bhashini translation failed with ${response.status}`);
    }

    const body = (await response.json()) as BhashiniComputeResponse;
    return body.pipelineResponse[0]?.output.map((item) => item.target);
  }
}
