import { eq, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { UserModel } from '../../users/models/user.model';
import { PatientFamilyLinksModel } from '../models/patientFamilyLinks.model';

// Dependents have mobile = NULL by design; fall back to the primary patient.
export async function resolvePatientMobile(
  patientId: string,
  ownMobile: string | null | undefined
): Promise<string | null> {
  if (ownMobile) return ownMobile;

  const [link] = await database
    .select({ primaryMobile: UserModel.mobile })
    .from(PatientFamilyLinksModel)
    .innerJoin(
      UserModel,
      eq(UserModel.id, PatientFamilyLinksModel.primaryPatientId)
    )
    .where(eq(PatientFamilyLinksModel.linkedPatientId, patientId))
    .limit(1);

  return link?.primaryMobile ?? null;
}

// Batched form for fan-outs (DirectoryPort.getUserMobiles).
export async function resolvePatientMobiles(
  ownMobiles: Map<string, string>,
  missingIds: string[]
): Promise<Map<string, string>> {
  const result = new Map(ownMobiles);
  if (!missingIds.length) return result;

  const links = await database
    .select({
      linkedPatientId: PatientFamilyLinksModel.linkedPatientId,
      primaryMobile: UserModel.mobile,
    })
    .from(PatientFamilyLinksModel)
    .innerJoin(
      UserModel,
      eq(UserModel.id, PatientFamilyLinksModel.primaryPatientId)
    )
    .where(inArray(PatientFamilyLinksModel.linkedPatientId, missingIds));

  for (const row of links) {
    if (row.primaryMobile) result.set(row.linkedPatientId, row.primaryMobile);
  }

  return result;
}
