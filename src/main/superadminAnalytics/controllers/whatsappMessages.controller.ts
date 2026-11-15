import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { WhatsAppMessagesService } from '../services/whatsappMessages.service';
import type { SetWhatsAppMessageBody } from '../schemas/whatsappMessages.schema';

export const listWhatsAppMessagesController = asyncHandler(
  async (_req: Request, res: Response) => {
    const messages = await WhatsAppMessagesService.list();
    return sendOk(res, 'WhatsApp messages fetched successfully', { messages });
  }
);

export const setWhatsAppMessageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { enabled } = req.validatedBody as SetWhatsAppMessageBody;
    const messages = await WhatsAppMessagesService.setEnabled(
      req.validatedParams.key,
      enabled,
      req.user!.id
    );
    return sendOk(res, 'WhatsApp message updated successfully', { messages });
  }
);
