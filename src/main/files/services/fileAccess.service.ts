import { and, eq, inArray } from 'drizzle-orm';
import { extname } from 'path';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentClinicalModel } from '../../appointments/models/appointmentClinical.model';
import { doctorManualPrescriptionModel } from '../../appointments/models/doctorManualPrescription.model';
import { ReportCardModel } from '../../reports/models/reports.model';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { PharmacyStockModel } from '../../pharmacies/models/pharmacyStock.model';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { PatientFamilyLinksModel } from '../../patient/models/patientFamilyLinks.model';
import { DOCUMENT_TTL_SECONDS } from '../utils/s3Ref.utils';
import { readS3Object, signS3Url } from './fileUrl.service';
import type { DownloadableDocument } from '../types/files.types';
import type {
  DownloadDocumentQuery,
  SignDocumentQuery,
  SignPatientDocumentQuery,
} from '../schemas/files.schema';

/** Reads one document's stored location, scoped to the caller's clinic. */
type StoredLocationLookup = (
  id: string,
  clinicId: string
) => Promise<string | null>;

const LOOKUPS: Record<SignDocumentQuery['type'], StoredLocationLookup> = {
  labReport: async (id, clinicId) => {
    const [row] = await database
      .select({ location: LabOrderModel.reportPdf })
      .from(LabOrderModel)
      .where(
        and(eq(LabOrderModel.id, id), eq(LabOrderModel.clinicId, clinicId))
      )
      .limit(1);
    return row?.location ?? null;
  },

  // Report cards carry no clinic of their own; the appointment is the tenant.
  prescription: async (id, clinicId) => {
    const [row] = await database
      .select({ location: ReportCardModel.prescriptionPdf })
      .from(ReportCardModel)
      .innerJoin(
        AppointmentModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(eq(ReportCardModel.id, id), eq(AppointmentModel.clinicId, clinicId))
      )
      .limit(1);
    return row?.location ?? null;
  },

  // Prescription history hands back appointment ids, and the PDF may sit in
  // either table — whichever the history endpoint would have preferred.
  appointmentPrescription: async (id, clinicId) => {
    const [row] = await database
      .select({
        reportCard: ReportCardModel.prescriptionPdf,
        manual: doctorManualPrescriptionModel.doctorManualPrescription,
      })
      .from(AppointmentModel)
      .leftJoin(
        ReportCardModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        doctorManualPrescriptionModel,
        eq(doctorManualPrescriptionModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(AppointmentModel.id, id),
          eq(AppointmentModel.clinicId, clinicId)
        )
      )
      .limit(1);
    return row?.reportCard ?? row?.manual ?? null;
  },

  manualPrescription: async (id, clinicId) => {
    const [row] = await database
      .select({
        location: doctorManualPrescriptionModel.doctorManualPrescription,
      })
      .from(doctorManualPrescriptionModel)
      .innerJoin(
        AppointmentModel,
        eq(doctorManualPrescriptionModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(doctorManualPrescriptionModel.appointmentId, id),
          eq(AppointmentModel.clinicId, clinicId)
        )
      )
      .limit(1);
    return row?.location ?? null;
  },

  stockInvoice: async (id, clinicId) => {
    const [row] = await database
      .select({ location: PharmacyStockModel.invoice })
      .from(PharmacyStockModel)
      .innerJoin(
        PharmacyModel,
        eq(PharmacyStockModel.pharmacyId, PharmacyModel.id)
      )
      .where(
        and(eq(PharmacyStockModel.id, id), eq(PharmacyModel.clinicId, clinicId))
      )
      .limit(1);
    return row?.location ?? null;
  },

  // Keyed by appointment id, which is what the appointment screen already holds.
  consent: async (id, clinicId) => {
    const [row] = await database
      .select({ location: AppointmentClinicalModel.consentFile })
      .from(AppointmentClinicalModel)
      .innerJoin(
        AppointmentModel,
        eq(AppointmentClinicalModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(AppointmentClinicalModel.appointmentId, id),
          eq(AppointmentModel.clinicId, clinicId)
        )
      )
      .limit(1);
    return row?.location ?? null;
  },
};

/** Debug-level, so it prints only in development. The signature is cut off: a live link is a credential. */
function logSignedDocument(type: string, id: string, url: string) {
  logger.debug('[files] signed document', {
    type,
    id,
    path: url.split('?')[0],
    expiresIn: /[?&]X-Amz-Expires=(\d+)/.exec(url)?.[1] ?? null,
  });
}

/**
 * Signs a document the caller's clinic owns, for a few minutes.
 * The key never comes from the client — it is read from the owning record.
 */
export async function signClinicDocument(
  query: SignDocumentQuery,
  clinicId: string
): Promise<{ url: string; expiresIn: number }> {
  const location = await LOOKUPS[query.type](query.id, clinicId);

  // Absent and belonging-to-another-clinic are the same 404, so the endpoint
  // cannot be used to confirm that an id exists.
  if (!location) throw new HttpError(404, 'Document not found');

  const url = await signS3Url(location, { expiresIn: DOCUMENT_TTL_SECONDS });
  if (!url) throw new HttpError(404, 'Document not found');

  logSignedDocument(query.type, query.id, url);
  return { url, expiresIn: DOCUMENT_TTL_SECONDS };
}

/** Reads a clinic-owned document to send as a download from our own origin.
 * The private bucket allows no cross-origin reads, so a signed link can't be saved. */
export async function readClinicDocument(
  query: DownloadDocumentQuery,
  clinicId: string
): Promise<DownloadableDocument> {
  const location = await LOOKUPS[query.type](query.id, clinicId);
  if (!location) throw new HttpError(404, 'Document not found');

  const file = await readS3Object(location);
  if (!file) throw new HttpError(404, 'Document not found');

  return {
    bytes: file.bytes,
    contentType: file.contentType,
    fileName: `${query.downloadAs}${extname(file.key)}`,
  };
}

/** The patient plus the family members they manage: the same set their document lists show. */
async function familyPatientIds(userId: string): Promise<string[]> {
  const links = await database
    .select({ id: PatientFamilyLinksModel.linkedPatientId })
    .from(PatientFamilyLinksModel)
    .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));
  return [userId, ...links.map((link) => link.id)];
}

/** Reads one document's stored location, scoped to the patient and their family. */
const PATIENT_LOOKUPS: Record<
  SignPatientDocumentQuery['type'],
  (id: string, patientIds: string[]) => Promise<string | null>
> = {
  prescription: async (id, patientIds) => {
    const [row] = await database
      .select({ location: ReportCardModel.prescriptionPdf })
      .from(ReportCardModel)
      .where(
        and(
          eq(ReportCardModel.id, id),
          inArray(ReportCardModel.petientId, patientIds)
        )
      )
      .limit(1);
    return row?.location ?? null;
  },

  // Rows of GET /patient/prescriptions: the digital PDF, else the doctor's scan.
  appointmentPrescription: async (id, patientIds) => {
    const [row] = await database
      .select({
        reportCard: ReportCardModel.prescriptionPdf,
        manual: doctorManualPrescriptionModel.doctorManualPrescription,
      })
      .from(AppointmentModel)
      .leftJoin(
        ReportCardModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        doctorManualPrescriptionModel,
        eq(doctorManualPrescriptionModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(AppointmentModel.id, id),
          inArray(AppointmentModel.patientId, patientIds)
        )
      )
      .limit(1);
    return row?.reportCard ?? row?.manual ?? null;
  },

  manualPrescription: async (id, patientIds) => {
    const [row] = await database
      .select({
        location: doctorManualPrescriptionModel.doctorManualPrescription,
      })
      .from(doctorManualPrescriptionModel)
      .innerJoin(
        AppointmentModel,
        eq(doctorManualPrescriptionModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(doctorManualPrescriptionModel.appointmentId, id),
          inArray(AppointmentModel.patientId, patientIds)
        )
      )
      .limit(1);
    return row?.location ?? null;
  },

  consent: async (id, patientIds) => {
    const [row] = await database
      .select({ location: AppointmentClinicalModel.consentFile })
      .from(AppointmentClinicalModel)
      .innerJoin(
        AppointmentModel,
        eq(AppointmentClinicalModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          eq(AppointmentClinicalModel.appointmentId, id),
          inArray(AppointmentModel.patientId, patientIds)
        )
      )
      .limit(1);
    return row?.location ?? null;
  },

  labReport: async (id, patientIds) => {
    const [row] = await database
      .select({ location: LabOrderModel.reportPdf })
      .from(LabOrderModel)
      .where(
        and(
          eq(LabOrderModel.id, id),
          inArray(LabOrderModel.patientId, patientIds)
        )
      )
      .limit(1);
    return row?.location ?? null;
  },
};

/**
 * Signs a document the patient themselves owns. A patient has no clinic
 * assignment, so the clinic-scoped endpoint would refuse them outright.
 */
export async function signPatientDocument(
  query: SignPatientDocumentQuery,
  patientId: string
): Promise<{ url: string; expiresIn: number }> {
  const patientIds = await familyPatientIds(patientId);
  const location = await PATIENT_LOOKUPS[query.type](query.id, patientIds);
  if (!location) throw new HttpError(404, 'Document not found');

  const url = await signS3Url(location, { expiresIn: DOCUMENT_TTL_SECONDS });
  if (!url) throw new HttpError(404, 'Document not found');

  logSignedDocument(query.type, query.id, url);
  return { url, expiresIn: DOCUMENT_TTL_SECONDS };
}
