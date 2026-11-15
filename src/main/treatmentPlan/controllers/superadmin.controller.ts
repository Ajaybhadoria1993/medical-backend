import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { SpecialtyConfigService } from '../services/specialtyConfig.service';
import { TemplateQueryService } from '../services/templates/templateQuery.service';
import { TemplateWriteService } from '../services/templates/templateWrite.service';
import { toActor } from '../utils/actor.utils';

// The ready-made library: clinic_id is null on every row these handlers touch.
const LIBRARY = { clinicId: null };

export const listLibraryTemplatesController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateQueryService.list(
      LIBRARY,
      null,
      req.validatedQuery
    );
    return sendOk(res, 'Ready-made templates fetched', data);
  }
);

export const getLibraryTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateQueryService.get(
      LIBRARY,
      null,
      req.validatedParams.id
    );
    return sendOk(res, 'Ready-made template fetched', data);
  }
);

export const createLibraryTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateWriteService.create(
      LIBRARY,
      toActor(req.user!),
      req.validatedBody
    );
    return sendCreated(res, 'Ready-made template saved as a draft', data);
  }
);

export const updateLibraryTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateWriteService.update(
      LIBRARY,
      toActor(req.user!),
      req.validatedParams.id,
      req.validatedBody
    );
    return sendOk(res, 'Ready-made template saved', data);
  }
);

export const checkLibraryTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateWriteService.check(
      LIBRARY,
      toActor(req.user!),
      req.validatedParams.id
    );
    return sendOk(res, 'Ready-made template marked as checked', data);
  }
);

const statusController = (
  to: 'active' | 'inactive' | 'archived',
  message: string
) =>
  asyncHandler(async (req: Request, res: Response) => {
    const data = await TemplateWriteService.setStatus(
      LIBRARY,
      toActor(req.user!),
      req.validatedParams.id,
      to
    );
    return sendOk(res, message, data);
  });

export const activateLibraryTemplateController = statusController(
  'active',
  'Ready-made template published'
);
export const deactivateLibraryTemplateController = statusController(
  'inactive',
  'Ready-made template unpublished'
);
export const archiveLibraryTemplateController = statusController(
  'archived',
  'Ready-made template archived'
);

export const listSpecialtyConfigsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pageNumber, pageSize } = req.validatedQuery;
    const data = await SpecialtyConfigService.listPlatform(
      pageNumber,
      pageSize
    );
    return sendOk(res, 'Specialty fields fetched', data);
  }
);

export const createSpecialtyConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await SpecialtyConfigService.create(req.validatedBody);
    return sendCreated(res, 'Specialty fields saved', data);
  }
);

export const updateSpecialtyConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await SpecialtyConfigService.update(
      req.validatedParams.id,
      req.validatedBody
    );
    return sendOk(res, 'Specialty fields saved', data);
  }
);
