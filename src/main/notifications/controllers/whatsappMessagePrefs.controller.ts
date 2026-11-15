import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { WhatsAppMessagePrefsService } from '../services/whatsappMessagePrefs.service';
import type { SaveWhatsAppMessagesBody } from '../schemas/whatsappMessagePrefs.schema';

// The clinic comes from the token (requireClinic), never from the request.

export const getWhatsAppMessagesController = asyncHandler(
  async (req: Request, res: Response) => {
    const messages = await WhatsAppMessagePrefsService.listClinicMessages(
      req.clinicId!
    );
    return sendOk(res, 'WhatsApp messages fetched successfully', { messages });
  }
);

export const saveWhatsAppMessagesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { messages } = req.validatedBody as SaveWhatsAppMessagesBody;
    const saved = await WhatsAppMessagePrefsService.saveClinicMessages(
      req.clinicId!,
      messages,
      req.user!.id
    );
    return sendOk(res, 'WhatsApp messages saved successfully', {
      messages: saved,
    });
  }
);
