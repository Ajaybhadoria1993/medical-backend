import { eq } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import type { DoctorPort } from '../../main/treatmentPlan';
import { UserProfessionalModel } from '../../main/users/models/userProfessional.model';

export const doctorAdapter: DoctorPort = {
  async getSpecialties(doctorId) {
    const [row] = await database
      .select({
        speciality: UserProfessionalModel.speciality,
        specialization: UserProfessionalModel.specialization,
      })
      .from(UserProfessionalModel)
      .where(eq(UserProfessionalModel.userId, doctorId))
      .limit(1);
    if (!row) return [];
    return [row.speciality, ...(row.specialization ?? [])].filter(
      (s): s is string => !!s?.trim()
    );
  },
};
