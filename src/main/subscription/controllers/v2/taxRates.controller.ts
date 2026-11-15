import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../../utils/response.utils';
import { TaxAdminService } from '../../services/billing/taxAdmin.service';

const userId = (req: Request) => {
  if (!req.user?.id) throw new HttpError(401, 'Sign in again to continue.');
  return req.user.id;
};

/** GET /api/v2/subscription/tax-rates — GST in force, the scheduled change and the history. */
export const getTaxRates = asyncHandler(async (_req: Request, res: Response) =>
  sendOk(res, 'GST settings fetched', await TaxAdminService.overview())
);

/** POST /api/v2/subscription/tax-rates/preview — what each plan costs today and under the proposed GST. */
export const previewTaxRate = asyncHandler(
  async (req: Request, res: Response) => {
    const { ratePercent, mode } = req.validatedBody;
    return sendOk(
      res,
      'GST preview',
      await TaxAdminService.preview({
        rateBp: Math.round(ratePercent * 100),
        mode,
      })
    );
  }
);

/** POST /api/v2/subscription/tax-rates — schedule a GST change, or apply it now without notice. */
export const scheduleTaxRate = asyncHandler(
  async (req: Request, res: Response) =>
    sendCreated(
      res,
      'GST change saved',
      await TaxAdminService.schedule(req.validatedBody, userId(req))
    )
);

/** DELETE /api/v2/subscription/tax-rates/:id — undo a change that has not started. */
export const undoTaxRate = asyncHandler(async (req: Request, res: Response) =>
  sendOk(
    res,
    'GST change undone',
    await TaxAdminService.undo(req.validatedParams.id, userId(req))
  )
);
