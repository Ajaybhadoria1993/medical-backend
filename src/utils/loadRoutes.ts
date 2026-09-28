// src/utils/loadRoutes.ts
import { Application } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { convertToKebabCase } from './caseConverter';
import { docsRegistry } from './docsRegistry';
import logger from './logger';

/**
 * Cleans a filename to create a consistent kebab-case API endpoint segment.
 */
function cleanFileName(fileName: string): string {
  const cleanedFileName = fileName
    .replace(/\d+/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/And/g, '-')
    .replace(/Or/g, '-')
    .replace(/\s+/g, '');
  return convertToKebabCase(cleanedFileName);
}

/**
 * Validates and registers API documentation for a route.
 */
function registerApiDocs(
  routeModule: Record<string, unknown>,
  apiEndpoint: string,
  routeFile: string
) {
  if (!routeModule.apiDocs) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (routeModule.apiDocs as any[]).forEach((doc: any) => {
    const suffix = doc.path
      ? doc.path.startsWith('/')
        ? doc.path
        : '/' + doc.path
      : '';
    doc.path = `${apiEndpoint}${suffix}`;
    doc.registeredAt = new Date().toISOString();

    // Validate schemas silently but log errors if critical
    ['params', 'query', 'requestSchema', 'responseSchema'].forEach(
      (schemaKey) => {
        if (
          doc[schemaKey] &&
          (!doc[schemaKey]._def || typeof doc[schemaKey] !== 'object')
        ) {
          logger.debug(
            `[loadRoutes] Invalid ${schemaKey} schema in ${routeFile} for ${doc.method} ${doc.path}`
          );
        }
      }
    );

    docsRegistry.addEndpoint(doc);
  });
}

/**
 * Processes a single route file and mounts it to the express application.
 */
async function processRouteFile(
  app: Application,
  feature: string,
  version: string,
  routeFile: string,
  featureVersionRoutes: string
) {
  if (routeFile.includes('.d.ts') || routeFile.includes('.map')) return;

  try {
    const fullPath = path.join(featureVersionRoutes, routeFile);
    let routeModule;

    try {
      // Try loading directly. Works on Linux (ESM/CJS) and Windows (CJS).
      routeModule = await import(fullPath);
    } catch (importError: any) {
      // On Windows with ESM loader (like tsx), absolute paths must be file:// URLs.
      if (importError.code === 'ERR_UNSUPPORTED_ESM_URL_SCHEME') {
        routeModule = await import(pathToFileURL(fullPath).href);
      } else {
        throw importError;
      }
    }
    const route = routeModule.default || routeModule;

    if (route) {
      if (typeof route !== 'function') {
        logger.error(
          `[loadRoutes] Route in ${routeFile} is not a function/router. Type: ${typeof route}`
        );
        return;
      }
      const cleanedFeature = cleanFileName(feature);
      const fileBaseName = routeFile.split('.')[0];
      let apiEndpoint = `/api/${version}/${cleanedFeature}`;

      if (fileBaseName !== feature) {
        const cleanedFileName = cleanFileName(fileBaseName);
        apiEndpoint = `/api/${version}/${cleanedFeature}/${cleanedFileName}`;
      }

      // "Animation-like" logging effect
      const padding = '.'.repeat(Math.max(2, 50 - apiEndpoint.length));
      logger.info(`Mounting ${apiEndpoint} ${padding} [OK]`);

      app.use(apiEndpoint, route);
      registerApiDocs(routeModule, apiEndpoint, routeFile);
    }
  } catch (routeError) {
    logger.error(
      `[loadRoutes] Failed to load route file ${routeFile}:`,
      routeError
    );
    throw routeError; // Rethrow to trigger process exit in loadRoutes
  }
}

/**
 * Automatically scans and loads routes from the features directory.
 * Routes are expected to be in: src/main/{feature}/routes/{version}/{routeFile}.ts
 */
export async function loadRoutes(app: Application) {
  try {
    const featuresPath = path.join(__dirname, '../main');
    const features = await fs.readdir(featuresPath);

    logger.info('🚀 Initializing Router...');

    await Promise.all(
      features.map(async (feature) => {
        const featureRoutesPath = path.join(featuresPath, feature, 'routes');

        try {
          await fs.access(featureRoutesPath);
        } catch {
          // Skip features without a routes directory
          return;
        }

        const versions = await fs.readdir(featureRoutesPath);

        await Promise.all(
          versions.map(async (version) => {
            const featureVersionRoutes = path.join(featureRoutesPath, version);
            const stats = await fs.stat(featureVersionRoutes);

            if (!stats.isDirectory()) return;

            const routeFiles = await fs.readdir(featureVersionRoutes);

            await Promise.all(
              routeFiles.map((routeFile) =>
                processRouteFile(
                  app,
                  feature,
                  version,
                  routeFile,
                  featureVersionRoutes
                )
              )
            );
          })
        );
      })
    );

    logger.info('✅ All routes mounted successfully');
  } catch (err) {
    logger.error('[loadRoutes] Critical error loading routes:', err);
    process.exit(1); // Ensure server goes down if any route fails to load
  }
}
