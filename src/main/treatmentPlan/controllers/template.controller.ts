import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { TemplateQueryService } from '../services/templates/templateQuery.service';
import { TemplateWriteService } from '../services/templates/templateWrite.service';
import { toActor } from '../utils/actor.utils';

// The clinic comes from the token (requireClinic), never from the request.
const scopeOf = (req: Request) => ({ clinicId: req.clinicId! });

export const listTemplatesController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateQueryService.list(
      scopeOf(req),
      toActor(req.user!),
      req.validatedQuery
    );
    return sendOk(res, 'Templates fetched', data);
  }
);

export const availableTemplatesController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateQueryService.pickerForDoctor(
      req.clinicId!,
      req.user!.id
    );
    return sendOk(res, 'Templates fetched', data);
  }
);

export const listLibraryController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateQueryService.libraryForClinic(
      req.validatedQuery,
      req.user!.id
    );
    return sendOk(res, 'Ready-made templates fetched', data);
  }
);

export const getLibraryTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateQueryService.libraryTemplateForClinic(
      req.validatedParams.id
    );
    return sendOk(res, 'Ready-made template fetched', data);
  }
);

export const previewTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = TemplateQueryService.preview(req.validatedBody);
    return sendOk(res, 'Preview ready', data);
  }
);

export const getTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateQueryService.get(
      scopeOf(req),
      toActor(req.user!),
      req.validatedParams.id
    );
    return sendOk(res, 'Template fetched', data);
  }
);

export const createTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateWriteService.create(
      scopeOf(req),
      toActor(req.user!),
      req.validatedBody
    );
    return sendCreated(res, 'Template saved as a draft', data);
  }
);

export const updateTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateWriteService.update(
      scopeOf(req),
      toActor(req.user!),
      req.validatedParams.id,
      req.validatedBody
    );
    return sendOk(res, 'Template saved', data);
  }
);

export const copyTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateWriteService.copy(
      req.clinicId!,
      toActor(req.user!),
      req.validatedParams.id,
      req.validatedBody.target
    );
    return sendCreated(res, 'Template copied as a draft', data);
  }
);

export const checkTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TemplateWriteService.check(
      scopeOf(req),
      toActor(req.user!),
      req.validatedParams.id
    );
    return sendOk(res, 'Template marked as checked', data);
  }
);

/** One handler per target status, so each route stays a single controller call. */
const statusController = (
  to: 'active' | 'inactive' | 'archived',
  message: string
) =>
  asyncHandler(async (req: Request, res: Response) => {
    const data = await TemplateWriteService.setStatus(
      scopeOf(req),
      toActor(req.user!),
      req.validatedParams.id,
      to
    );
    return sendOk(res, message, data);
  });

export const activateTemplateController = statusController(
  'active',
  'Template activated'
);
export const deactivateTemplateController = statusController(
  'inactive',
  'Template deactivated'
);
export const archiveTemplateController = statusController(
  'archived',
  'Template archived'
);
