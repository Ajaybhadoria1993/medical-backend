import { eq, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { notificationsEnabled } from '../../../utils/envConfig';
import logger from '../../../utils/logger';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { UserModel } from '../../users/models/user.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { LabsModel } from '../../lab/models/lab.model';
import { enqueueWhatsAppTemplate } from '../queues/whatsappOutbox.queue';
import { normalizeWhatsAppNumber } from '../utils/whatsappTemplate.utils';
import { resolvePatientMobile } from '../../patient/services/patientMobile.service';

interface LabRecipient {
  patientMobile: string;
  patientName: string;
  labName: string;
}

async function resolveTestName(
  testId: string | null | undefined
): Promise<string> {
  if (!testId) return 'your test';
  const [row] = await database
    .select({ name: TestCatalogModel.name })
    .from(TestCatalogModel)
    .where(eq(TestCatalogModel.id, testId))
    .limit(1);
  return row?.name?.trim() || 'your test';
}

/**
 * Patient mobile + lab name + the WhatsApp toggle in one query, mirroring
 * `getNotificationContext` for appointments. The messages name the lab rather
 * than the clinic, since that is who the patient dealt with; the WhatsApp
 * toggle still lives on the owning clinic's settings.
 *
 * Returns null when notifications are disabled environment-wide, the clinic
 * has WhatsApp disabled, or the patient has no mobile on file.
 */
async function resolveRecipient(
  patientId: string | null | undefined,
  clinicId: string | null | undefined,
  labId: string | null | undefined
): Promise<LabRecipient | null> {
  if (!notificationsEnabled()) return null;
  if (!patientId || !clinicId) return null;

  const [row] = await database
    .select({
      patientMobile: UserModel.mobile,
      patientName: UserModel.name,
      labName: LabsModel.name,
      clinicName: ClinicModel.clinicName,
      whatsappEnabled: ClinicSettingsModel.whatsappEnabled,
    })
    .from(UserModel)
    .leftJoin(ClinicModel, eq(ClinicModel.id, clinicId))
    .leftJoin(ClinicSettingsModel, eq(ClinicSettingsModel.clinicId, clinicId))
    .leftJoin(LabsModel, labId ? eq(LabsModel.id, labId) : sql`false`)
    .where(eq(UserModel.id, patientId))
    .limit(1);

  if (!row?.whatsappEnabled) return null;

  const patientMobile = await resolvePatientMobile(
    patientId,
    row.patientMobile
  );
  if (!patientMobile) return null;

  // Fall back to the clinic name when the test isn't tied to a named lab.
  const labName = row.labName?.trim() || row.clinicName?.trim();
  if (!labName) return null;

  return {
    patientMobile,
    patientName: row.patientName?.trim() || 'there',
    labName,
  };
}

export class LabNotificationService {
  /**
   * Sent when a lab report PDF is attached to a completed test, so the patient
   * gets the download link rather than having to chase the clinic for it.
   */
  static async sendReportReady(params: {
    patientId: string | null | undefined;
    clinicId: string | null | undefined;
    labId: string | null | undefined;
    patientName: string;
    testName: string;
    reportUrl: string;
  }): Promise<void> {
    try {
      const recipient = await resolveRecipient(
        params.patientId,
        params.clinicId,
        params.labId
      );
      if (!recipient) return;

      await enqueueWhatsAppTemplate(
        normalizeWhatsAppNumber(recipient.patientMobile),
        {
          key: 'labReportReady',
          params: {
            patientName: params.patientName,
            testName: params.testName,
            labName: recipient.labName,
            reportUrl: params.reportUrl,
          },
        }
      );
    } catch (err) {
      logger.error(
        `Failed to queue lab report notification: ${(err as Error).message}`
      );
    }
  }

  /**
   * Receipt confirmation once a lab invoice is raised against a test. Names are
   * resolved here from ids, because the invoice call site holds neither.
   */
  static async sendPaymentReceived(params: {
    patientId: string | null | undefined;
    clinicId: string | null | undefined;
    labId: string | null | undefined;
    testId: string | null | undefined;
    amount: string;
    invoiceNumber: string;
  }): Promise<void> {
    try {
      const recipient = await resolveRecipient(
        params.patientId,
        params.clinicId,
        params.labId
      );
      if (!recipient) return;

      const testName = await resolveTestName(params.testId);

      await enqueueWhatsAppTemplate(
        normalizeWhatsAppNumber(recipient.patientMobile),
        {
          key: 'labPaymentReceived',
          params: {
            patientName: recipient.patientName,
            amount: params.amount,
            testName,
            labName: recipient.labName,
            invoiceNumber: params.invoiceNumber,
          },
        }
      );
    } catch (err) {
      logger.error(
        `Failed to queue lab payment notification: ${(err as Error).message}`
      );
    }
  }
}
