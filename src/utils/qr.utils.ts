import QRCode from 'qrcode';
import logger from './logger';

/**
 * Where the prescription QR sends a patient: the app listing, not the
 * prescription itself.
 *
 * A printed prescription can be photographed by anyone, so encoding a per-report
 * link would put a document URL on paper the patient carries around. The app
 * listing is public by nature and the same for every prescription, and the
 * patient signs in there to reach their own records.
 *
 * Defaults to the MediArogya download page (www.mediarogya.in/app/m/download; the
 * FE footer's App Store link is still a placeholder). When both stores exist,
 * point `PRESCRIPTION_QR_URL` at a "get the app" landing page that offers both;
 * no template change is needed.
 */
const appDownloadUrl = () =>
  process.env.PRESCRIPTION_QR_URL ||
  'https://www.mediarogya.in/app/m/download';

export const buildAppDownloadUrl = (): string => appDownloadUrl();

/**
 * Cached because the encoded URL is now constant — regenerating the same PNG on
 * every prescription PDF would be pure waste. Keyed by URL so an env change
 * during a process's life is still picked up.
 */
let cachedQr: { url: string; dataUrl: string } | null = null;

/**
 * PNG data URI for the app QR, embedded straight into the template so the PDF
 * renderer never has to fetch a remote image.
 *
 * Returns an empty string on any failure — a missing QR must never take down
 * prescription PDF generation, and every template guards it with `{{#if}}`.
 *
 * Render it with a TRIPLE-stache (`{{{qrCode}}}`): Handlebars escapes `=`, which
 * would corrupt the base64 payload — the same trap as `templateConfig.fontUrl`.
 */
export const buildAppQrDataUrl = async (): Promise<string> => {
  const url = appDownloadUrl();
  if (cachedQr?.url === url) return cachedQr.dataUrl;

  try {
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 240,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    cachedQr = { url, dataUrl };

    return dataUrl;
  } catch (error) {
    logger.warn('Prescription QR generation failed', error);
    return '';
  }
};

/**
 * Builds an embedded QR for a concrete document URL. A report template uses
 * this only after its final object URL is known, so the code never points at a
 * temporary or deleted PDF.
 */
export const buildReportQrDataUrl = async (
  reportUrl: string
): Promise<string> => {
  if (!reportUrl.trim()) return '';

  try {
    return await QRCode.toDataURL(reportUrl, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 240,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch (error) {
    logger.warn('Lab report QR generation failed', error);
    return '';
  }
};
