import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
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

    res.status(200).json({
      success: true,
      data: result
        ? {
            selectedTemplate: result.selectedTemplate,
            fontFamily: result.fontFamily,
            accentColor: result.accentColor,
            elementConfig: result.elementConfig,
            updatedAt: result.updatedAt,
          }
        : {
            selectedTemplate: 'compact-medicine-slip',
            fontFamily: 'Inter, sans-serif',
            accentColor: '#0A6C74',
            elementConfig: null,
            isDefault: true,
          },
    });
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
