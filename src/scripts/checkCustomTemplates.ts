/**
 * Read-only: renders every saved custom prescription template (scanner + manual) through the shared
 * preview render, and lists any that fail. Run before relying on the new preview in an environment.
 *
 * Run: `npx cross-env NODE_ENV=staging tsx src/scripts/checkCustomTemplates.ts` (or development / production).
 */
import { isNotNull } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';
import { doctorManualTemplateModel } from '../main/doctor/models/doctorManualTemplate.model';
import { doctorTemplateModel } from '../main/doctor/models/doctorTemplate.model';
import { PrescriptionPreviewService } from '../main/reports/services/prescriptionPreview.service';

async function main() {
  const [scanned, manual] = await Promise.all([
    database
      .select({
        doctorId: doctorTemplateModel.doctorId,
        html: doctorTemplateModel.templateHtml,
      })
      .from(doctorTemplateModel)
      .where(isNotNull(doctorTemplateModel.templateHtml)),
    database
      .select({
        doctorId: doctorManualTemplateModel.doctorId,
        html: doctorManualTemplateModel.templateHtml,
      })
      .from(doctorManualTemplateModel)
      .where(isNotNull(doctorManualTemplateModel.templateHtml)),
  ]);

  const rows = [
    ...scanned.map((r) => ({ ...r, kind: 'scanned' })),
    ...manual.map((r) => ({ ...r, kind: 'manual' })),
  ];
  const failures: { kind: string; doctorId: string; error: string }[] = [];
  for (const row of rows) {
    try {
      PrescriptionPreviewService.renderCustomTemplateStrict(row.html ?? '');
    } catch (error) {
      failures.push({
        kind: row.kind,
        doctorId: String(row.doctorId),
        error: (error as Error).message,
      });
    }
  }

  console.info(
    `Checked ${rows.length} templates (${scanned.length} scanned, ${manual.length} manual).`
  );
  if (failures.length) {
    console.info(`${failures.length} failed to render:`);
    for (const f of failures)
      console.info(`- ${f.kind} template of doctor ${f.doctorId}: ${f.error}`);
  } else {
    console.info('All templates render.');
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
