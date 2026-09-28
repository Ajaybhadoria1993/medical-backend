import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { labReportTemplateSchema } from '../schemas/lab.schemas';
import { LabReportTemplateService } from '../services/labReportTemplate.service';

export const upsertLabReportTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const labId = req.labId;
    if (!labId) {
      throw new HttpError(
        400,
        'Lab context is required to save a template config'
      );
    }

    const validatedBody = labReportTemplateSchema.parse(req.body);
    const result = await LabReportTemplateService.upsertTemplate(
      labId,
      validatedBody
    );

    return sendOk(res, 'Lab report template saved successfully', result);
  }
);

export const getLabReportTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const labId = req.labId;
    if (!labId) {
      throw new HttpError(
        400,
        'Lab context is required to fetch a template config'
      );
    }

    const template = await LabReportTemplateService.getTemplate(labId);

    const data = template || {
      message: 'No custom template found, using default template1',
      defaultTemplate: 'template1',
      defaultColors: {
        color1: '#0F766E',
        color2: '#ECFDF5',
        color3: '#172033',
        color4: '#526078',
        color5: '#DBE3EA',
        color6: '#B22222',
        color7: '#F9F9F9',
        color8: '#FFFFFF',
        color9: '#000000',
        color10: '#856404',
      },
      defaultFontFamily: 'Inter, sans-serif',
    };

    return sendOk(res, 'Lab report template fetched successfully', data);
  }
);

export const listLabReportTemplatesController = asyncHandler(
  async (req: Request, res: Response) => {
    const templates = [
      {
        id: 'template1',
        displayName: 'Simple / Minimal',
        description:
          'A clean, basic design with a focus on core information, using simple rules and ample white space.',
        thumbnail: '',
      },
      {
        id: 'template2',
        displayName: 'Letterhead Pad',
        description:
          'A formal, traditional letterhead layout with structured dividers and bold typography.',
        thumbnail: '',
      },
      {
        id: 'template3',
        displayName: 'Handwritten Pad',
        description:
          'A personal touch layout printed on cream paper, utilizing handwritten Caveat values against clean Inter labels.',
        thumbnail: '',
      },
      {
        id: 'template4',
        displayName: 'Modern Banner',
        description:
          'A premium design featuring a full-width colored header band, colored table headers, and rounded info cards.',
        thumbnail: '',
      },
    ];

    return sendOk(res, 'Lab report templates fetched successfully', templates);
  }
);
