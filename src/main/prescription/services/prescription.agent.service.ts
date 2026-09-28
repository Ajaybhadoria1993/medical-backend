import { GoogleGenAI } from '@google/genai';
import { ZodError } from 'zod';
import {
  buildPrescriptionRepairPrompt,
  PRESCRIPTION_EXTRACTION_SYSTEM_PROMPT,
  PRESCRIPTION_EXTRACTION_USER_PROMPT,
} from '../prompts/prescription.prompts';
import {
  ScanOutputSchema,
  type ScanInput,
  type ScanOutput,
} from '../types/prescription.types';
import {
  getTestingScanOutput,
  isTestingModeEnabled,
} from './prescription.testing';
import {
  PRESCRIPTION_TEMPLATE_VALIDATION_ERROR_CODE,
  validateGeneratedPrescriptionTemplate,
} from '../validators/prescription.template.validator';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';

type ImagePart =
  | {
      inlineData: {
        mimeType: string;
        data: string;
      };
    }
  | {
      fileData: {
        mimeType: string;
        fileUri: string;
      };
    };

type TextPart = {
  text: string;
};

type GenerationAttemptResult =
  | {
      ok: true;
      output: ScanOutput;
      rawResponseText: string;
    }
  | {
      ok: false;
      issues: string[];
      rawResponseText: string;
    };

const apiKey = process.env.GEMINI_API_KEY!;
const modelName = process.env.MODEL_NAME || 'gemini-2.5-flash';
const ai = new GoogleGenAI({ vertexai: true, apiKey: apiKey });

const getImagePart = (input: ScanInput): ImagePart =>
  input.imageBase64
    ? {
        inlineData: {
          mimeType: 'image/jpeg',
          data: input.imageBase64,
        },
      }
    : {
        fileData: {
          mimeType: 'image/jpeg',
          fileUri: input.imageUrl!,
        },
      };

const getGenerateContentText = (response: unknown) => {
  const responseObject = response as {
    text?: string;
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  if (typeof responseObject.text === 'string' && responseObject.text.trim()) {
    return responseObject.text.trim();
  }

  return (
    responseObject.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('\n')
      .trim() ?? ''
  );
};

const formatZodIssues = (error: ZodError) =>
  error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });

const dedupeIssues = (issues: string[]) => [...new Set(issues)];

const parseAndValidateModelOutput = (
  rawResponseText: string
): GenerationAttemptResult => {
  if (!rawResponseText.trim()) {
    return {
      ok: false,
      issues: ['Model returned an empty response'],
      rawResponseText,
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawResponseText);
  } catch (error) {
    return {
      ok: false,
      issues: [
        `Failed to parse model JSON response: ${
          error instanceof Error ? error.message : 'Unknown JSON parse error'
        }`,
      ],
      rawResponseText,
    };
  }

  try {
    const output = ScanOutputSchema.parse(parsed);
    const validation = validateGeneratedPrescriptionTemplate(output.template);

    if (!validation.valid) {
      return {
        ok: false,
        issues: validation.issues,
        rawResponseText,
      };
    }

    return {
      ok: true,
      output: {
        template: validation.normalizedTemplate,
      },
      rawResponseText,
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        issues: formatZodIssues(error),
        rawResponseText,
      };
    }

    return {
      ok: false,
      issues: [
        error instanceof Error
          ? error.message
          : 'Unknown output validation error',
      ],
      rawResponseText,
    };
  }
};

const requestTemplateFromModel = async (
  input: ScanInput,
  userPrompt: string
): Promise<GenerationAttemptResult> => {
  const response = await ai.models.generateContent({
    model: modelName,
    contents: [
      {
        role: 'user',
        parts: [getImagePart(input), { text: userPrompt } satisfies TextPart],
      },
    ],
    config: {
      systemInstruction: PRESCRIPTION_EXTRACTION_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  });
  const rawResponseText = getGenerateContentText(response);

  return parseAndValidateModelOutput(rawResponseText);
};

export const scanPrescriptionWithAgent = async (
  input: ScanInput
): Promise<ScanOutput> => {
  if (isTestingModeEnabled()) {
    return getTestingScanOutput();
  }

  const firstAttempt = await requestTemplateFromModel(
    input,
    PRESCRIPTION_EXTRACTION_USER_PROMPT
  );

  if (firstAttempt.ok) {
    return firstAttempt.output;
  }

  logger.warn(
    'Prescription template generation failed validation on first pass',
    {
      issues: firstAttempt.issues,
    }
  );

  const secondAttempt = await requestTemplateFromModel(
    input,
    buildPrescriptionRepairPrompt(
      firstAttempt.issues,
      firstAttempt.rawResponseText || '<empty response>'
    )
  );

  if (secondAttempt.ok) {
    logger.info(
      'Prescription template generation succeeded after repair retry'
    );
    return secondAttempt.output;
  }

  const validationIssues = dedupeIssues(secondAttempt.issues);

  logger.error('Prescription template generation failed after retry', {
    firstPassIssues: firstAttempt.issues,
    secondPassIssues: secondAttempt.issues,
  });

  throw new HttpError(502, 'Generated template failed validation', {
    code: PRESCRIPTION_TEMPLATE_VALIDATION_ERROR_CODE,
    validationIssues,
  });
};
