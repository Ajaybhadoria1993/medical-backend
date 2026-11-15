import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { PayoutAccountsService } from '../services/payoutAccounts.service';
import type { PayoutAccountsQueryDto } from '../schemas/payoutAccounts.schema';

/** One page of clinics' payout status, with counts per state for the same search. */
export const listPayoutAccountsController = asyncHandler(
  async (req: Request, res: Response) =>
    sendOk(
      res,
      'Payout accounts',
      await PayoutAccountsService.list(
        req.validatedQuery as PayoutAccountsQueryDto
      )
    )
);
