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
 * Currently the Play Store listing (the iOS listing is not published yet — the
 * FE footer's App Store link is still a placeholder). When both stores exist,
 * point `PRESCRIPTION_QR_URL` at a "get the app" landing page that offers both;
 * no template change is needed.
 */
const appDownloadUrl = () =>
  process.env.PRESCRIPTION_QR_URL ||
  'https://play.google.com/store/apps/details?id=com.infinity.medisetu';

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
