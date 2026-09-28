import { and, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  PharmacyAssignModel,
  PharmacyModel,
} from '../../pharmacy/models/pharmacy.model';

export class SettingService {
  static async noLoss(userId: string, pharmacyId: string) {
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id, noLoss: PharmacyModel.noLoss })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.id, pharmacyId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    const [assignment] = await database
      .select({
        userRole: PharmacyAssignModel.userRole,
      })
      .from(PharmacyAssignModel)
      .where(
        and(
          eq(PharmacyAssignModel.userId, userId),
          eq(PharmacyAssignModel.pharmacyId, pharmacyId)
        )
      )
      .limit(1);

    if (!assignment) {
      throw new HttpError(403, 'Pharmacy not assigned to this user');
    }

    const updatedNoLoss = pharmacy.noLoss === 'true' ? 'false' : 'true';

    const [updatedPharmacy] = await database
      .update(PharmacyModel)
      .set({
        noLoss: updatedNoLoss,
        updatedAt: new Date(),
      })
      .where(eq(PharmacyModel.id, pharmacyId))
      .returning({
        id: PharmacyModel.id,
        noLoss: PharmacyModel.noLoss,
      });

    return updatedPharmacy;
  }
}
