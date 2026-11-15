import { asc, eq } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';
import {
  ClinicAssignModel,
  ClinicModel,
} from '../main/clinic/models/clinic.model';
import { PharmacyAssignModel } from '../main/pharmacy/models/pharmacy.model';

export interface UserClinic {
  clinicId: string;
  status: string;
}

/** The clinic a user works in: pharmacists via pharmacy_assign, everyone else via clinic_assign.
 *  First assignment wins; multi-clinic switching is not supported yet. */
export async function findUserClinic(
  userId: string,
  userType: string
): Promise<UserClinic | null> {
  if (userType === 'Pharmacist') {
    const [row] = await database
      .select({
        clinicId: PharmacyAssignModel.clinicId,
        status: ClinicModel.status,
      })
      .from(PharmacyAssignModel)
      .innerJoin(ClinicModel, eq(ClinicModel.id, PharmacyAssignModel.clinicId))
      .where(eq(PharmacyAssignModel.userId, userId))
      .orderBy(asc(PharmacyAssignModel.createdAt))
      .limit(1);
    return row ?? null;
  }

  const [row] = await database
    .select({
      clinicId: ClinicAssignModel.clinicId,
      status: ClinicModel.status,
    })
    .from(ClinicAssignModel)
    .innerJoin(ClinicModel, eq(ClinicModel.id, ClinicAssignModel.clinicId))
    .where(eq(ClinicAssignModel.userId, userId))
    .orderBy(asc(ClinicAssignModel.createdAt))
    .limit(1);
  return row ?? null;
}
