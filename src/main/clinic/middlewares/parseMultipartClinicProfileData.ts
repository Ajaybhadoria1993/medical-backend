import { NextFunction, Request, Response } from 'express';

// Self-contained (not imported from v1): v1's `parseMultipartClinicData` is
// unexported and expects a different shape than this route's flat
// `Object.keys(setObj)`-style fields.
export function parseMultipartClinicProfileData(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (req.body && typeof req.body === 'object') {
    const newBody: Record<string, unknown> = {};

    for (const key in req.body) {
      let value = req.body[key];

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
          try {
            value = JSON.parse(trimmed);
          } catch {
            // ignore -> Zod will handle invalid JSON
          }
        }
      }

      if (key.includes('[') && key.includes(']')) {
        const [parent, child] = key.split(/\[|\]/).filter(Boolean);
        if (!newBody[parent]) newBody[parent] = {};

        if (child === 'ZipCode' && value) {
          const num = parseInt(value as string, 10);
          if (!isNaN(num)) value = num;
        }

        (newBody[parent] as Record<string, unknown>)[child] = value;
      } else {
        newBody[key] = value;
      }
    }

    if (req.files) {
      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };
      if (files.clinicLogo?.[0]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newBody.clinicLogo = (files.clinicLogo[0] as any).location;
      }
    }

    req.body = newBody;
  }

  next();
}
