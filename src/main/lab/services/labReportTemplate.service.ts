import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { LabReportTemplateModel } from '../models/lab.model';
import { LabReportTemplateDto } from '../schemas/lab.schemas';

export class LabReportTemplateService {
  static async upsertTemplate(labId: string, data: LabReportTemplateDto) {
    try {
      const existingTemplate = await database
        .select()
        .from(LabReportTemplateModel)
        .where(eq(LabReportTemplateModel.labId, labId))
        .limit(1);

      let result;

      if (existingTemplate && existingTemplate.length > 0) {
        const updated = await database
          .update(LabReportTemplateModel)
          .set({
            templateName: data.templateName,
            fontFamily: data.fontFamily,
            color1: data.color1,
            color2: data.color2,
            color3: data.color3,
            color4: data.color4,
            color5: data.color5,
            color6: data.color6,
            color7: data.color7,
            color8: data.color8,
            color9: data.color9,
            color10: data.color10,
            updatedAt: new Date(),
          })
          .where(eq(LabReportTemplateModel.labId, labId))
          .returning();

        result = {
          action: 'updated' as const,
          template: updated[0],
        };
      } else {
        const inserted = await database
          .insert(LabReportTemplateModel)
          .values({
            labId,
            templateName: data.templateName,
            fontFamily: data.fontFamily,
            color1: data.color1,
            color2: data.color2,
            color3: data.color3,
            color4: data.color4,
            color5: data.color5,
            color6: data.color6,
            color7: data.color7,
            color8: data.color8,
            color9: data.color9,
            color10: data.color10,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        result = {
          action: 'created' as const,
          template: inserted[0],
        };
      }

      return result;
    } catch {
      throw new HttpError(500, 'Failed to save lab report template');
    }
  }

  static async getTemplate(labId: string) {
    try {
      const [template] = await database
        .select()
        .from(LabReportTemplateModel)
        .where(eq(LabReportTemplateModel.labId, labId))
        .limit(1);

      return template || null;
    } catch {
      throw new HttpError(500, 'Failed to fetch lab report template');
    }
  }
}
