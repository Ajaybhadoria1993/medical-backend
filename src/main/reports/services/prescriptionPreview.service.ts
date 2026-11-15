import handlebars from 'handlebars';
import '../../../utils/handlebarsHelpers';
import logger from '../../../utils/logger';
import { QuickPrintTemplateService } from '../../quick-print-templates/services/quickPrintTemplate.service';
import {
  buildPrescriptionSample,
  DEFAULT_TEMPLATE_CONFIG,
} from '../utils/prescriptionSample.utils';
import { PrescriptionSectionService } from './prescriptionSection.service';

export class PrescriptionPreviewService {
  /**
   * A doctor's custom (HTML) template filled with the sample visit, through the same Handlebars, helpers,
   * colours and section switches the real PDF uses, so the preview shows what will print.
   */
  static renderCustomTemplate(templateHtml: string): string {
    try {
      return PrescriptionPreviewService.renderCustomTemplateStrict(
        templateHtml
      );
    } catch (error) {
      // A template the real print can't render either: show it unfilled rather than fail the page.
      logger.warn(
        'Custom prescription template failed to render for preview',
        error
      );
      return templateHtml;
    }
  }

  /** Same render, but throws on a broken template; the template check script uses it. */
  static renderCustomTemplateStrict(templateHtml: string): string {
    const sample = buildPrescriptionSample();
    const data = {
      templateConfig: DEFAULT_TEMPLATE_CONFIG,
      config: {
        fontFamily: DEFAULT_TEMPLATE_CONFIG.fontFamily,
        primaryFont: DEFAULT_TEMPLATE_CONFIG.primaryFont,
        accentColor: '#333333',
        elements: {
          ...QuickPrintTemplateService.DEFAULT_ELEMENTS,
          ...PrescriptionSectionService.derive(null),
        },
      },
      watermarkLogo: sample.clinic.logo,
      ...sample,
      visitDate: sample.appointmentDate,
      patient: { ...sample.patient, uhid: 'A7060', mobile: '9876543210' },
    };
    return handlebars.compile(templateHtml)(data);
  }
}
