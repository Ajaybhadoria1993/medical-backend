import { HttpError } from '../../../middlewear/errorHandler';
import { findReferenceImages } from '../../../utils/referenceImages';
import { findSpecialtyGroup } from '../../../utils/specialtyCatalog';
import { listSpecialtyDefaults } from '../utils/specialtyDefaults.utils';
import { applySpecialtyOrder } from '../utils/specialtyOrder.utils';
import { SpecialtyOrderService } from './specialtyOrder.service';

/** Read-only per-speciality defaults for the Super Admin Speciality Defaults page. */
export class SpecialtyDefaultsService {
  /** Defaults per main speciality, in the Super Admin's saved display order. */
  static async list() {
    return applySpecialtyOrder(
      listSpecialtyDefaults(),
      await SpecialtyOrderService.savedOrder()
    );
  }

  static referenceImages(speciality: string) {
    const group = findSpecialtyGroup(speciality);
    if (!group) throw new HttpError(404, 'Speciality not found');
    return findReferenceImages(group.mainSpecialty);
  }
}
