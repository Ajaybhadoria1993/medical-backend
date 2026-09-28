import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';

type GeminiRequestPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GeminiSdkError = {
  status?: number;
  message?: string;
};

type GeminiGenerateRequestBody = {
  requestParts?: GeminiRequestPart[];
};

const geminiAutoAlignRouter = Router();

const isModelNotFoundError = (error: unknown) => {
  const sdkError = error as GeminiSdkError;
  const statusCode =
    typeof sdkError?.status === 'number' ? sdkError.status : undefined;
  const message = typeof sdkError?.message === 'string' ? sdkError.message : '';

  return (
    statusCode === 404 ||
    /\b404\b/i.test(message) ||
    /model.+not\s*found/i.test(message)
  );
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

const getGeminiModelsForAttempt = () => {
  const configuredModels =
    process.env.MODEL_NAME ?? process.env.VITE_MODEL_NAME ?? '';
  const splitModels = configuredModels
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (splitModels.length > 0) {
    return splitModels;
  }

  return ['gemini-2.5-flash'];
};

geminiAutoAlignRouter.post('/gemini', async (req, res) => {
  const apiKey = (
    process.env.GEMINI_API_KEY ??
    process.env.VITE_GEMINI_API_KEY ??
    ''
  ).trim();

  if (!apiKey) {
    res.status(503).json({
      message: 'Gemini API key is not configured on the backend.',
    });

    return;
  }

  const body = req.body as GeminiGenerateRequestBody;
  const requestParts = body?.requestParts;

  if (!Array.isArray(requestParts) || requestParts.length === 0) {
    res.status(400).json({
      message: 'requestParts must be a non-empty array.',
    });

    return;
  }

  const ai = new GoogleGenAI({ vertexai: true, apiKey: apiKey });
  const modelNamesToTry = getGeminiModelsForAttempt();
  let lastModelNotFoundError: unknown = null;

  for (const modelName of modelNamesToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: requestParts,
          },
        ],
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      });

      const text = getGenerateContentText(response);

      res.status(200).json({ text, model: modelName });

      return;
    } catch (error) {
      if (isModelNotFoundError(error)) {
        lastModelNotFoundError = error;
        continue;
      }

      const sdkError = error as GeminiSdkError;

      res.status(502).json({
        message:
          (typeof sdkError?.message === 'string' && sdkError.message.trim()) ||
          'Gemini request failed in backend auto-align API.',
      });

      return;
    }
  }

  if (lastModelNotFoundError) {
    res.status(404).json({
      message: `Gemini model not found. Tried: ${modelNamesToTry.join(', ')}.`,
    });

    return;
  }

  res.status(502).json({
    message: 'Gemini request failed in backend auto-align API.',
  });
});

export default geminiAutoAlignRouter;
