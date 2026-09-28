import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';

export const singleFileController = asyncHandler(
  async (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { doc } = req as any;
    res.status(201).json({ success: true, doc });
  }
);
