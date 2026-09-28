import { z } from 'zod';

export const doctorPublicProfileParamsSchema = z.object({
  doctorId: z.string().uuid('Invalid doctor id'),
});

export type DoctorPublicProfileParamsDto = z.infer<
  typeof doctorPublicProfileParamsSchema
>;
