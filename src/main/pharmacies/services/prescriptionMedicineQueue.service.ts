import { Job, Queue, Worker } from 'bullmq';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { UserModel } from '../../users/models/user.model';
import { PharmacyAssignModel } from '../../pharmacy/models/pharmacy.model';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import { HsnTaxMasterModel } from '../../pharmacy/models/inventoryMasters.model';
import { MedicineModel } from '../../medicine/models/medicine.model';
import {
  PharmacyMedicineTagsModel,
  PharmacyTagsMapModel,
} from '../models/pharmacyMedicineTags.model';
import logger from '../../../utils/logger';

interface PrescriptionItem {
  medicineId?: string | null;
  medicineName: string;
  composition?: string | null;
  manufacturer?: string | null;
}

interface PrescriptionMedicineJobData {
  appointmentId: string;
  prescriptions: PrescriptionItem[];
}

class PrescriptionMedicineQueue {
  private queue?: Queue;
  private disabled: boolean;

  constructor() {
    this.disabled = process.env.ENABLE_PRESCRIPTION_MEDICINE_QUEUE === 'false';

    if (this.disabled) {
      logger.info(
        'PrescriptionMedicineQueue is disabled via ENABLE_PRESCRIPTION_MEDICINE_QUEUE=false'
      );
      return;
    }

    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    };

    this.queue = new Queue('prescription-medicines', { connection });
    this.startWorker();
  }

  private startWorker() {
    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    };

    const worker = new Worker(
      'prescription-medicines',
      async (job: Job<PrescriptionMedicineJobData>) => {
        await this.processPrescriptions(job.data);
      },
      { connection }
    );

    worker.on('completed', (job) => {
      logger.info(`✅ Prescription medicine sync job completed: ${job.id}`);
    });

    worker.on('failed', (job, err) => {
      logger.error(`❌ Prescription medicine sync job failed: ${job?.id}`, err);
    });

    worker.on('error', (err) => {
      logger.error('Prescription medicine worker error', err);
    });
  }

  private async processPrescriptions(data: PrescriptionMedicineJobData) {
    const { appointmentId, prescriptions } = data;

    if (!appointmentId || !prescriptions || prescriptions.length === 0) {
      return;
    }

    try {
      // 1. Get Appointment info to identify doctor and clinic
      const [appointment] = await database
        .select({
          doctorId: AppointmentModel.doctorId,
          clinicId: AppointmentModel.clinicId,
        })
        .from(AppointmentModel)
        .where(eq(AppointmentModel.id, appointmentId))
        .limit(1);

      if (!appointment || !appointment.doctorId || !appointment.clinicId) {
        logger.warn(
          `[PrescriptionSync] Appointment ${appointmentId} not found or missing doctor/clinic information`
        );
        return;
      }

      // 2. Fetch Doctor's name
      const [doctor] = await database
        .select({
          name: UserModel.name,
        })
        .from(UserModel)
        .where(eq(UserModel.id, appointment.doctorId))
        .limit(1);

      const doctorName = doctor?.name || 'Unknown';

      // 3. Find if pharmacy is present for this doctor's clinic in pharmacy_assign
      const assignedPharmacies = await database
        .select({
          pharmacyId: PharmacyAssignModel.pharmacyId,
        })
        .from(PharmacyAssignModel)
        .where(eq(PharmacyAssignModel.clinicId, appointment.clinicId));

      if (assignedPharmacies.length === 0) {
        logger.info(
          `[PrescriptionSync] No assigned pharmacies found for clinicId: ${appointment.clinicId}`
        );
        return;
      }

      // 4. Fetch or create HSN record for 98041000
      let hsnRecord = await database
        .select({
          id: HsnTaxMasterModel.id,
          hsnCode: HsnTaxMasterModel.hsnCode,
        })
        .from(HsnTaxMasterModel)
        .where(eq(HsnTaxMasterModel.hsnCode, '98041000'))
        .limit(1)
        .then((res) => res[0]);

      if (!hsnRecord) {
        const [newHsn] = await database
          .insert(HsnTaxMasterModel)
          .values({
            hsnCode: '98041000',
            gstPercentage: '5',
            description: 'Drugs & medicines (personal import)',
            effectiveFrom: '2024-01-01',
          })
          .returning({
            id: HsnTaxMasterModel.id,
            hsnCode: HsnTaxMasterModel.hsnCode,
          });
        hsnRecord = newHsn;
      }

      const hsnId = hsnRecord.id;
      const hsnCode = hsnRecord.hsnCode;

      // Tag formatting: prescribedByDr{DoctorName} without spaces
      const cleanDrName = doctorName.replace(/\s+/g, '');
      const tagStr = `prescribedByDr${cleanDrName}`;

      // 5. Pre-fetch medicine details from master MedicineModel in a single batch query
      const medicineIdsToCheck = prescriptions
        .map((p) => p.medicineId)
        .filter(Boolean) as string[];

      const medicineRecordList = medicineIdsToCheck.length
        ? await database
            .select({
              id: MedicineModel.id,
              form: MedicineModel.form,
              manufacturer: MedicineModel.manufacturer,
              composition: MedicineModel.composition,
            })
            .from(MedicineModel)
            .where(inArray(MedicineModel.id, medicineIdsToCheck))
        : [];

      const medicineRecordMap = new Map(
        medicineRecordList.map((m) => [m.id, m])
      );

      // Process each pharmacy
      for (const pharmacy of assignedPharmacies) {
        const pharmacyId = pharmacy.pharmacyId;

        // Check which medicines already exist in this pharmacy in one query
        const existingPharmacyMedicines = await database
          .select({
            medicineName: pharmacyMedicineModel.medicineName,
          })
          .from(pharmacyMedicineModel)
          .where(
            and(
              eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
              inArray(
                sql`LOWER(${pharmacyMedicineModel.medicineName})`,
                prescriptions.map((p) => p.medicineName.toLowerCase())
              )
            )
          );

        const existingPharmacyMedicineNames = new Set(
          existingPharmacyMedicines.map((m) => m.medicineName.toLowerCase())
        );

        // Filter prescriptions that need to be created
        const itemsToCreate = prescriptions.filter(
          (p) =>
            !existingPharmacyMedicineNames.has(p.medicineName.toLowerCase())
        );

        if (itemsToCreate.length === 0) {
          continue;
        }

        // Perform inserts atomically for this pharmacy in a single transaction
        await database.transaction(async (tx) => {
          const newMedicinesData = [];
          for (const item of itemsToCreate) {
            const medicineRecord = item.medicineId
              ? medicineRecordMap.get(item.medicineId)
              : null;
            const form = medicineRecord?.form || null;
            const manufacturer = medicineRecord?.manufacturer || null;
            const composition = medicineRecord?.composition || null;
            const sku = this.generateSku(item.medicineName, form, hsnCode);

            newMedicinesData.push({
              pharmacyId,
              sku,
              medicineName: item.medicineName,
              form,
              brandName: manufacturer,
              composition,
              hsnId,
              status: 'active' as const,
            });
          }

          const insertedMedicines = await tx
            .insert(pharmacyMedicineModel)
            .values(newMedicinesData)
            .returning({
              id: pharmacyMedicineModel.id,
              medicineName: pharmacyMedicineModel.medicineName,
            });

          // Fetch or create tag
          let tagRecord = await tx
            .select({ id: PharmacyMedicineTagsModel.id })
            .from(PharmacyMedicineTagsModel)
            .where(
              and(
                eq(PharmacyMedicineTagsModel.pharmacyId, pharmacyId),
                eq(PharmacyMedicineTagsModel.tag, tagStr)
              )
            )
            .limit(1)
            .then((res) => res[0]);

          if (!tagRecord) {
            const [newTag] = await tx
              .insert(PharmacyMedicineTagsModel)
              .values({
                pharmacyId,
                tag: tagStr,
              })
              .returning({ id: PharmacyMedicineTagsModel.id });
            tagRecord = newTag;
          }

          // Create tag map entries in batch
          await tx.insert(PharmacyTagsMapModel).values(
            insertedMedicines.map((m) => ({
              medicineId: m.id,
              tagId: tagRecord.id,
            }))
          );

          for (const m of insertedMedicines) {
            logger.info(
              `[PrescriptionSync] Added medicine ${m.medicineName} to pharmacy ${pharmacyId} with tag ${tagStr}`
            );
          }
        });
      }
    } catch (error) {
      logger.error('[PrescriptionSync] Error processing job:', error);
      throw error; // Re-throw to trigger BullMQ failure handling
    }
  }

  private generateSku(
    medicineName: string,
    form?: string | null,
    hsnCode?: string | null
  ): string {
    const cleanName = medicineName.toUpperCase().replace(/[^A-Z0-9 ]/g, '');

    const namePart = cleanName
      .replace(/\d+/g, '')
      .replace(/\s+/g, '')
      .slice(0, 4);

    const numberPart = (medicineName.match(/\d+/g) || []).join('');

    const formPart = form
      ? form
          .replace(/[^A-Z]/gi, '')
          .toUpperCase()
          .slice(0, 3)
      : '';

    let sku = `${namePart}${numberPart}${formPart}`;

    if (sku.length < 6 && hsnCode) {
      sku += hsnCode.replace(/\D/g, '');
    }

    return sku;
  }

  async addPrescriptionMedicinesJob(data: PrescriptionMedicineJobData) {
    if (this.disabled || !this.queue) return;
    try {
      await this.queue.add('sync-prescription-medicines', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      });
    } catch (error) {
      logger.error('Failed to queue prescription medicines sync job:', error);
    }
  }
}

export const prescriptionMedicineQueue = new PrescriptionMedicineQueue();
