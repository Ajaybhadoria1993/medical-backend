import { signStoredFilesDeep } from '../main/files/services/fileUrl.service';
import fs from 'fs-extra';
import path from 'path';
import handlebars from 'handlebars';
import { deleteFromS3, uploadBufferToS3 } from '../configurations/s3';
import { buildObjectKey } from '../configurations/s3/keys';
import logger from './logger';
import { htmlToPdfBuffer } from './browserPdf';
import './handlebarsHelpers';

type PdfTemplateData = Record<string, unknown> & {
  invoice?: { id?: string };
  labResult?: { id?: string };
  reportId?: string;
};

/**
 * Interface for Invoice Data
 */
export interface InvoicePdfData {
  pharmacy: {
    name: string;
    address: string;
    contactNumber: string;
  };
  clinic: {
    clinicName: string;
    clinicAddress: string;
    clinicPhone: string;
    clinicLogo?: string;
    City: string;
    State: string;
    ZipCode: string;
  };
  doctor?: {
    name: string;
    email: string;
    speciality: string;
    qualification: string;
    licenseNumber: string;
  } | null;
  invoice: {
    id: string;
    customerName: string;
    address: string;
    mobile: string;
    createdAt: string;
  };
  billing: {
    paymentMethod: string;
    price: string | number;
    discount: string | number;
    tax: string | number;
    totalPrice: string | number;
  };
  medicines: Array<{
    medicineName: string;
    strength: string;
    quantity: string | number;
    expiryDate: string;
    rowTotal: string | number;
  }>;
}

/** Compiles a template with its data (plus the shared background asset) into a PDF buffer. */
export async function renderTemplateToPdf(
  templateHtml: string,
  data: PdfTemplateData
): Promise<Buffer> {
  // Inject assets path for CSS background images
  const assetsDir = path.join(__dirname, '..', 'htmltamplates', 'assets');

  // Convert background image to base64 to ensure it works in all environments
  let backgroundBase64 = '';
  try {
    const bgPath = path.join(assetsDir, 'background.png');
    if (await fs.pathExists(bgPath)) {
      const bgBuffer = await fs.readFile(bgPath);
      backgroundBase64 = `data:image/png;base64,${bgBuffer.toString('base64')}`;
      logger.info(
        `Background image loaded, base64 length: ${backgroundBase64.length}`
      );
    } else {
      logger.warn(`Background image not found at ${bgPath}`);
    }
  } catch (err) {
    logger.error('Failed to read background image for base64 conversion:', err);
  }

  const assetsPath = `file:///${assetsDir.replace(/\\/g, '/')}/`;

  // Chromium fetches clinic logos over the network, so they must be signed
  // before the template renders or a private bucket silently 403s them.
  const signedData = await signStoredFilesDeep(data);
  const enrichedData = {
    ...(signedData as PdfTemplateData),
    assetsPath,
    backgroundBase64,
  };

  const template = handlebars.compile(templateHtml);
  const html = template(enrichedData);

  return htmlToPdfBuffer(html);
}

/**
 * Generate PDF from HTML template string and upload to AWS S3
 * @param templateHtml - The HTML content as a string
 * @param data - Data to inject into the template
 * @param folder - S3 folder to upload the PDF to
 * @param clinicId - Tenant the PDF belongs to; without it the key is unscoped
 * @returns - URL of the uploaded PDF
 */
export async function generateAndUploadPdf(
  templateHtml: string,
  data: PdfTemplateData,
  folder: string = 'invoices',
  oldFileUrl?: string | null,
  clinicId?: string | null
): Promise<string> {
  try {
    const pdfBuffer = await renderTemplateToPdf(templateHtml, data);

    // Same shape as uploaded files: tenant, category, date, opaque name.
    // The old name embedded the report id, which the key must not carry.
    const s3Key = buildObjectKey(
      { clinicId: clinicId ?? undefined },
      folder,
      'document.pdf'
    );
    const uploadedUrl = await uploadBufferToS3(
      Buffer.from(pdfBuffer),
      s3Key,
      'application/pdf'
    );

    if (oldFileUrl) {
      try {
        await deleteFromS3(oldFileUrl);
        logger.info(`Old PDF deleted after successful upload: ${oldFileUrl}`);
      } catch (error) {
        logger.error('Failed to delete old PDF:', error);
      }
    }

    return uploadedUrl;
  } catch (error) {
    logger.error('PDF Generation/Upload Error:', error);
    throw error;
  }
}
