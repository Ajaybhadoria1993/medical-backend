import fs from 'fs-extra';
import path from 'path';
import handlebars from 'handlebars';
import { uploadBufferToS3 } from '../configurations/s3';
import logger from './logger';
import { htmlToPdfBuffer } from './browserPdf';

export async function generateAndUploadSaleInvoicePdf(
  templateHtml: string,
  data: any,
  saleId: string
): Promise<string> {
  try {
    const assetsDir = path.join(__dirname, '..', 'htmltamplates', 'assets');

    const assetsPath = `file:///${assetsDir.replace(/\\/g, '/')}/`;

    let backgroundBase64 = '';

    try {
      const bgPath = path.join(assetsDir, 'background.png');

      if (await fs.pathExists(bgPath)) {
        const bgBuffer = await fs.readFile(bgPath);

        backgroundBase64 = `data:image/png;base64,${bgBuffer.toString(
          'base64'
        )}`;
      }
    } catch (err) {
      logger.error('Background image load failed', err);
    }

    const template = handlebars.compile(templateHtml);

    const html = template({
      ...data,
      assetsPath,
      backgroundBase64,
    });

    // Generate PDF using Gotenberg (lightweight microservice)
    const pdfBuffer = await htmlToPdfBuffer(html);

    const s3Key = `pharmacy-sales-invoices/${saleId}.pdf`;

    return await uploadBufferToS3(
      Buffer.from(pdfBuffer),
      s3Key,
      'application/pdf'
    );
  } catch (error) {
    logger.error('Sale Invoice PDF Upload Error:', error);
    throw error;
  }
}
