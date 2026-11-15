import { HttpError } from '../../../../middlewear/errorHandler';
import { getClinicPort } from '../../ports';
import type { CreditChangeBody, GrantsQuery } from '../../types/requests.types';
import { GrantsService } from './grants.service';

/** Super Admin's view of one clinic's credits, and grant/remove for a clinic that exists. */
export class ClinicCreditsService {
  static async overview(clinicId: string, query: GrantsQuery) {
    const clinicName = await this.requireClinic(clinicId);
    const [balance, nextExpiring, history] = await Promise.all([
      GrantsService.balance(clinicId, query.creditType),
      GrantsService.nextExpiring(clinicId, query.creditType),
      GrantsService.list(
        clinicId,
        query.creditType,
        query.pageNumber,
        query.pageSize,
        true
      ),
    ]);
    return {
      clinicId,
      clinicName,
      creditType: query.creditType,
      balance,
      nextExpiring,
      history,
    };
  }

  static async grant(
    clinicId: string,
    body: CreditChangeBody,
    actorUserId: string
  ) {
    await this.requireClinic(clinicId);
    return GrantsService.grant({ clinicId, ...body, actorUserId });
  }

  static async remove(
    clinicId: string,
    body: CreditChangeBody,
    actorUserId: string
  ) {
    await this.requireClinic(clinicId);
    return GrantsService.remove({ clinicId, ...body, actorUserId });
  }

  private static async requireClinic(clinicId: string): Promise<string> {
    const name = (await getClinicPort().getClinicNames([clinicId])).get(
      clinicId
    );
    if (!name) throw new HttpError(404, 'Clinic not found');
    return name;
  }
}
