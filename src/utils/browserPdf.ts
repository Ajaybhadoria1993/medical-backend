import puppeteerCore, { Browser } from 'puppeteer-core';
import logger from './logger';

/**
 * Lightweight PDF generation using @sparticuz/chromium (production/Linux)
 * or locally installed Chrome (development/Windows/macOS).
 *
 * - In production (Docker): uses @sparticuz/chromium's stripped-down binary (~50MB)
 * - In development (Windows/macOS): uses your locally installed Chrome
 */

let browserInstance: Browser | null = null;

/**
 * Detect the Chrome/Chromium executable path based on environment.
 */
async function getExecutablePath(): Promise<string> {
  const isDockerDeploy =
    process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

  if (isDockerDeploy) {
    // In Docker/Linux (staging or production), use @sparticuz/chromium
    const chromium = await import('@sparticuz/chromium');
    return await chromium.default.executablePath();
  }

  // In local development, find installed Chrome
  const platform = process.platform;

  if (platform === 'win32') {
    // Common Chrome install paths on Windows
    const paths = [
      process.env.CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    ].filter(Boolean) as string[];

    const fs = await import('fs');
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else {
    // Linux dev
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];
    const fs = await import('fs');
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  }

  throw new Error(
    'Chrome/Chromium not found. Set CHROME_PATH environment variable or install Chrome.'
  );
}

/**
 * Get browser launch args based on environment.
 */
async function getLaunchArgs(): Promise<string[]> {
  const isDockerDeploy =
    process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

  if (isDockerDeploy) {
    const chromium = await import('@sparticuz/chromium');
    return chromium.default.args;
  }

  // Minimal args for local development
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ];
}

/**
 * Get or create a reusable browser instance.
 * Reusing the browser avoids cold-start overhead on each PDF generation.
 */
async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  const executablePath = await getExecutablePath();
  const args = await getLaunchArgs();

  logger.info(`Launching browser from: ${executablePath}`);

  browserInstance = await puppeteerCore.launch({
    args,
    executablePath,
    headless: true,
  });

  // Clean up reference if browser disconnects
  browserInstance.on('disconnected', () => {
    browserInstance = null;
  });

  return browserInstance;
}

/**
 * Convert an HTML string to a PDF buffer.
 *
 * @param html - Full HTML document string
 * @param options - Optional PDF options
 * @returns PDF as a Buffer
 */
export async function htmlToPdfBuffer(
  html: string,
  options?: {
    format?: 'A4' | 'Letter' | 'A3';
    printBackground?: boolean;
    margin?: {
      top?: string;
      right?: string;
      bottom?: string;
      left?: string;
    };
  }
): Promise<Buffer> {
  const {
    format = 'A4',
    printBackground = true,
    margin = { top: '0px', right: '0px', bottom: '0px', left: '0px' },
  } = options || {};

  let page: Awaited<ReturnType<Browser['newPage']>> | null = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Wait for fonts and images to load
    await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
    // Network idle can pass before a large script font (Nastaliq) finishes loading.
    await page.evaluate('document.fonts.ready').catch(() => {});

    const pdfBuffer = await page.pdf({
      format,
      printBackground,
      margin,
    });

    return Buffer.from(pdfBuffer);
  } catch (error) {
    logger.error('Browser PDF generation error:', error);
    // If browser crashed, reset the instance
    browserInstance = null;
    throw error;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Gracefully close the browser instance (call on app shutdown).
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}
