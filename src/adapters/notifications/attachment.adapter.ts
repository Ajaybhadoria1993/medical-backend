import type { AttachmentPort } from '../../main/notifications/ports';
import { InvoiceService } from '../../main/subscription';

/** Invoices come from the subscription module; pdfFor checks the invoice belongs to that clinic. */
export const attachmentAdapter: AttachmentPort = {
  async resolve(ref) {
    if (ref.kind !== 'invoice') return null;
    const { pdf, fileName } = await InvoiceService.pdfFor(ref.ownerId, ref.id);
    return { filename: fileName, content: pdf, contentType: 'application/pdf' };
  },
};
