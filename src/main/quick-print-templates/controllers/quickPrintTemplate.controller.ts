import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import type {
  FooterNotesDto,
  TemplateUsageDto,
} from '../schemas/quickPrintTemplate.schemas';
import { QuickPrintTemplateService } from '../services/quickPrintTemplate.service';

/**
 * GET /api/v1/quick-print-templates/
 * Get the doctor's quick print template configuration.
 */
export const getQuickPrintTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user.id;
    const result =
      await QuickPrintTemplateService.getSelectedTemplate(doctorId);

    const config = result?.elementConfig;

    // A usage-only row holds no design, so it still reads as the default one.
    return sendOk(
      res,
      'Quick print template fetched successfully',
      result && !config?.usageOnly
        ? {
            selectedTemplate: result.selectedTemplate,
            fontFamily: result.fontFamily,
            accentColor: result.accentColor,
            elementConfig: {
              ...result.elementConfig,
              footerNotes: QuickPrintTemplateService.footerNotesOf(config),
            },
            updatedAt: result.updatedAt,
          }
        : {
            selectedTemplate: 'compact-medicine-slip',
            fontFamily: 'Inter, sans-serif',
            accentColor: '#0A6C74',
            elementConfig: {
              templateUsage: config?.templateUsage,
              footerNotes: QuickPrintTemplateService.footerNotesOf(config),
            },
            isDefault: true,
          }
    );
  }
);

/**
 * POST /api/v1/quick-print-templates/
 * Save the doctor's quick print template configuration.
 */
export const saveQuickPrintTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user.id;
    const data = req.validatedBody;

    const result = await QuickPrintTemplateService.saveSelectedTemplate(
      doctorId,
      data
    );

    res.status(200).json({
      success: true,
      message: 'Quick print template saved successfully',
      data: result,
    });
  }
);

/** PATCH /api/v1/quick-print-templates/usage — which design share and print use. */
export const setTemplateUsageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { templateUsage } = req.validatedBody as TemplateUsageDto;
    await QuickPrintTemplateService.setTemplateUsage(
      req.user.id,
      templateUsage
    );
    return sendOk(res, 'Template usage saved', { templateUsage });
  }
);

/** PATCH /api/v1/quick-print-templates/footer-notes — lines printed above every prescription's footer. */
export const setFooterNotesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { footerNotes } = req.validatedBody as FooterNotesDto;
    await QuickPrintTemplateService.setFooterNotes(req.user.id, footerNotes);
    return sendOk(res, 'Footer notes saved', { footerNotes });
  }
);

/**
 * POST /api/v1/quick-print-templates/preview
 * Render a live preview of the quick print template with sample data.
 * Returns HTML that the frontend displays in an iframe.
 */
export const previewQuickPrintTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const { selectedTemplate, fontFamily, accentColor, elementConfig } =
      req.body;

    // TODO: optionally fetch real doctor/clinic context like the main template preview does
    const html = QuickPrintTemplateService.renderPreview(
      selectedTemplate || 'compact-medicine-slip',
      {
        fontFamily: fontFamily || 'Inter, sans-serif',
        accentColor: accentColor || '#0A6C74',
        elementConfig: elementConfig || undefined,
      }
    );

    res.status(200).json({ success: true, html });
  }
);
